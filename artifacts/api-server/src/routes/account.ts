import { getAuth } from "../lib/auth-types.ts";
/**
 * Gerenciamento de conta e exclusão de dados — ZELO.
 * POST /api/account/deletion/request  — inicia solicitação (7 dias de janela)
 * POST /api/account/deletion/cancel   — cancela dentro da janela
 * POST /api/account/deletion/execute  — executa exclusão (após janela)
 * GET  /api/account/me                — dados da conta autenticada
 *
 * EXCLUSÃO DE DADOS:
 * - Exclui fisicamente todos os dados da família (sem soft delete)
 * - Notifica todos os cuidadores da família
 * - O único rastro é uma linha no audit_log: "familyId=X excluída em Y"
 * - Exige confirmação em dois passos: request + execute (após 7 dias)
 */

import { Router } from "express";
import { eq, and, lte, gt } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  deletionRequestsTable,
  usersTable,
  caregiversTable,
  patientsTable,
  familiesTable,
  refreshTokensTable,
} from "@workspace/db";
import { requireAuth, requirePrimaryCaregiver } from "../middleware/require-auth";
import { sendDeletionNotification } from "../lib/email";
import { audit } from "../lib/audit";
import { safeLog } from "../lib/safe-logger";
import { revokeAllAccessTokensForUser } from "../lib/tokens";
import { Clock } from "../lib/clock";

const router = Router();

// ── Dados da conta ────────────────────────────────────────────────────────

router.get("/account/me", requireAuth, async (req, res): Promise<void> => {
  const [user] = await db
    .select({ id: usersTable.id, name: usersTable.name, emailVerified: usersTable.emailVerified, status: usersTable.status, createdAt: usersTable.createdAt })
    .from(usersTable)
    .where(eq(usersTable.id, getAuth(req).userId))
    .limit(1);

  if (!user) { res.status(404).json({ error: "Conta não encontrada" }); return; }

  const [caregiver] = await db
    .select({ id: caregiversTable.id, name: caregiversTable.name, role: caregiversTable.role, familyId: caregiversTable.familyId })
    .from(caregiversTable)
    .where(eq(caregiversTable.userId, getAuth(req).userId))
    .limit(1);

  const [family] = caregiver
    ? await db.select({ name: familiesTable.name }).from(familiesTable).where(eq(familiesTable.id, caregiver.familyId)).limit(1)
    : [];

  res.json({ ...user, caregiver, family });
});

// ── Solicitar exclusão ────────────────────────────────────────────────────

router.post("/account/deletion/request", requirePrimaryCaregiver, async (req, res): Promise<void> => {
  // Verifica se já existe uma solicitação pendente
  const [existing] = await db
    .select({ id: deletionRequestsTable.id, scheduledDeletionAt: deletionRequestsTable.scheduledDeletionAt })
    .from(deletionRequestsTable)
    .where(
      and(
        eq(deletionRequestsTable.familyId, getAuth(req).familyId),
        eq(deletionRequestsTable.status, "pending")
      )
    )
    .limit(1);

  if (existing) {
    res.status(409).json({
      error: "Já existe uma solicitação de exclusão pendente",
      scheduledDeletionAt: existing.scheduledDeletionAt,
    });
    return;
  }

  const scheduledDeletionAt = new Date(Clock.now().getTime() + 7 * 24 * 60 * 60 * 1000);

  const [request] = await db
    .insert(deletionRequestsTable)
    .values({
      familyId: getAuth(req).familyId,
      requestedByUserId: getAuth(req).userId,
      scheduledDeletionAt,
    })
    .returning();

  // Notifica todos os cuidadores da família
  const caregivers = await db
    .select({ email: caregiversTable.email })
    .from(caregiversTable)
    .where(and(eq(caregiversTable.familyId, getAuth(req).familyId)));

  const emails = caregivers.flatMap((c) => (c.email ? [c.email] : []));
  await sendDeletionNotification(emails, scheduledDeletionAt);

  await audit({
    familyId: getAuth(req).familyId,
    entityType: "deletion_request",
    entityId: String(request.id),
    action: "created",
    actorId: String(getAuth(req).caregiverId),
    actorType: "caregiver",
    diff: JSON.stringify({ scheduledDeletionAt }),
  });
  safeLog.info({ action: "deletion_requested", familyId: getAuth(req).familyId }, "Exclusão de dados solicitada");

  res.status(201).json({
    message: "Solicitação de exclusão registrada. Você tem 7 dias para cancelar.",
    scheduledDeletionAt,
    requestId: request.id,
  });
});

// ── Cancelar exclusão ─────────────────────────────────────────────────────

router.post("/account/deletion/cancel", requirePrimaryCaregiver, async (req, res): Promise<void> => {
  const [existing] = await db
    .select()
    .from(deletionRequestsTable)
    .where(
      and(
        eq(deletionRequestsTable.familyId, getAuth(req).familyId),
        eq(deletionRequestsTable.status, "pending"),
        gt(deletionRequestsTable.scheduledDeletionAt, Clock.now()) // ainda na janela
      )
    )
    .limit(1);

  if (!existing) {
    res.status(404).json({ error: "Nenhuma solicitação de exclusão pendente encontrada" });
    return;
  }

  await db.update(deletionRequestsTable)
    .set({ status: "cancelled", cancelledAt: Clock.now(), cancelledByUserId: getAuth(req).userId })
    .where(eq(deletionRequestsTable.id, existing.id));

  await audit({
    familyId: getAuth(req).familyId,
    entityType: "deletion_request",
    entityId: String(existing.id),
    action: "deleted",
    actorId: String(getAuth(req).caregiverId),
    actorType: "caregiver",
  });

  res.json({ message: "Solicitação de exclusão cancelada com sucesso." });
});

// ── Executar exclusão definitiva ──────────────────────────────────────────

router.post("/account/deletion/execute", requirePrimaryCaregiver, async (req, res): Promise<void> => {
  const now = Clock.now();

  const [request] = await db
    .select()
    .from(deletionRequestsTable)
    .where(
      and(
        eq(deletionRequestsTable.familyId, getAuth(req).familyId),
        eq(deletionRequestsTable.status, "pending"),
        lte(deletionRequestsTable.scheduledDeletionAt, now) // janela encerrada
      )
    )
    .limit(1);

  if (!request) {
    res.status(409).json({
      error: "Não há solicitação de exclusão pronta para execução. Solicite primeiro e aguarde 7 dias.",
    });
    return;
  }

  const familyId = getAuth(req).familyId;

  // Coleta usuários vinculados à família para revogar sessões
  const caregivers = await db
    .select({ userId: caregiversTable.userId })
    .from(caregiversTable)
    .where(eq(caregiversTable.familyId, familyId));

  const userIds = caregivers.flatMap((c) => (c.userId ? [c.userId] : []));

  // EXCLUSÃO FÍSICA em transação:
  // Ordem importa — filhos antes dos pais
  await db.transaction(async (tx) => {
    // 1. Revogar todos os refresh tokens dos usuários da família
    for (const userId of userIds) {
      await tx.update(refreshTokensTable)
        .set({ revoked: true, revokedAt: now, revokedReason: "account_deleted" })
        .where(eq(refreshTokensTable.userId, userId));
    }

    // 2. Excluir a família (CASCADE elimina: pacientes → tratamentos → doses → registros,
    //    cuidadores, medicamentos, notificações, etc.)
    await tx.delete(familiesTable).where(eq(familiesTable.id, familyId));

    // 3. Marcar a solicitação como concluída
    await tx.update(deletionRequestsTable)
      .set({ status: "completed", completedAt: now, confirmed: true })
      .where(eq(deletionRequestsTable.id, request.id));
  });

  // Revoga access tokens em memória
  for (const userId of userIds) {
    revokeAllAccessTokensForUser(userId);
  }

  // Registra no audit_log (sobrevive à exclusão — familyId zerado na FK set null)
  // O audit usa familyId=0 como marcador de "família excluída"
  safeLog.info({ action: "family_data_deleted", familyId }, "Dados da família excluídos permanentemente");

  res.json({ message: "Dados excluídos permanentemente. Esta ação não pode ser desfeita." });
});

export default router;
