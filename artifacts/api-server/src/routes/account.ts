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
import { eq, and, lte, gt, inArray } from "drizzle-orm";
import { z } from "zod";
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
import { revokeAllAccessTokensForUser, generateAccessToken, generateRefreshToken } from "../lib/tokens";
import { Clock } from "../lib/clock";
import { listCaregiverLinks, switchActiveFamily } from "../lib/active-family.ts";

const router = Router();

// ── Dados da conta ────────────────────────────────────────────────────────

router.get("/account/me", requireAuth, async (req, res): Promise<void> => {
  const [user] = await db
    .select({ id: usersTable.id, name: usersTable.name, emailVerified: usersTable.emailVerified, status: usersTable.status, createdAt: usersTable.createdAt })
    .from(usersTable)
    .where(eq(usersTable.id, getAuth(req).userId))
    .limit(1);

  if (!user) { res.status(404).json({ error: "Conta não encontrada" }); return; }

  // Pelo caregiverId do TOKEN, nunca por userId: quem é cuidador em mais de
  // uma família tem várias linhas, e buscar por userId devolvia uma
  // arbitrária — a tela mostrava o nome de uma família e o token abria
  // outra. O token é a autoridade sobre qual sessão está aberta.
  const [caregiver] = await db
    .select({
      id: caregiversTable.id, name: caregiversTable.name, role: caregiversTable.role,
      familyId: caregiversTable.familyId, selectedPatientId: caregiversTable.selectedPatientId,
    })
    .from(caregiversTable)
    .where(eq(caregiversTable.id, getAuth(req).caregiverId))
    .limit(1);

  const [family] = caregiver
    ? await db
        .select({
          name: familiesTable.name,
          retroactiveWindowHours: familiesTable.retroactiveWindowHours,
          showMedicationInPush: familiesTable.showMedicationInPush,
          quietHoursEnabled: familiesTable.quietHoursEnabled,
          quietHoursStart: familiesTable.quietHoursStart,
          quietHoursEnd: familiesTable.quietHoursEnd,
        })
        .from(familiesTable)
        .where(eq(familiesTable.id, caregiver.familyId))
        .limit(1)
    : [];

  res.json({ ...user, caregiver, family });
});

// ── Paciente ativo (ZELO-22) ────────────────────────────────────────────
// Por cuidador, não por família — persiste entre sessões e dispositivos do
// mesmo cuidador, mas dois cuidadores podem estar vendo pacientes diferentes.

const SelectedPatientBody = z.object({ patientId: z.number().int().positive() });

router.patch("/account/selected-patient", requireAuth, async (req, res): Promise<void> => {
  const body = SelectedPatientBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }

  const [patient] = await db
    .select({ id: patientsTable.id })
    .from(patientsTable)
    .where(and(eq(patientsTable.id, body.data.patientId), eq(patientsTable.familyId, getAuth(req).familyId)))
    .limit(1);
  if (!patient) { res.status(404).json({ error: "Paciente não encontrado" }); return; }

  const [updated] = await db
    .update(caregiversTable)
    .set({ selectedPatientId: body.data.patientId, updatedAt: Clock.now() })
    .where(eq(caregiversTable.id, getAuth(req).caregiverId))
    .returning({ id: caregiversTable.id, selectedPatientId: caregiversTable.selectedPatientId });

  res.json(updated);
});

// ── Famílias do usuário e troca de família ───────────────────────────────
// Um usuário pode ser cuidador em várias famílias (cuidar da própria mãe E
// ser cuidadora contratada de outra). O JWT carrega uma só, então trocar
// exige emitir um par de tokens novo — não dá pra "mudar de família" sem
// mudar o token, que é justamente onde familyId/caregiverId/role vivem.

router.get("/account/families", requireAuth, async (req, res): Promise<void> => {
  const links = await listCaregiverLinks(getAuth(req).userId);
  if (links.length === 0) { res.json([]); return; }

  const families = await db
    .select({ id: familiesTable.id, name: familiesTable.name })
    .from(familiesTable)
    .where(inArray(familiesTable.id, links.map((l) => l.familyId)));

  const nameById = new Map(families.map((f) => [f.id, f.name]));
  res.json(
    links.map((l) => ({
      familyId: l.familyId,
      name: nameById.get(l.familyId) ?? "Família",
      role: l.role,
      isActive: l.familyId === getAuth(req).familyId,
    }))
  );
});

const SwitchFamilyBody = z.object({ familyId: z.number().int().positive() });

router.post("/account/switch-family", requireAuth, async (req, res): Promise<void> => {
  const body = SwitchFamilyBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }

  const caregiver = await switchActiveFamily(getAuth(req).userId, body.data.familyId);
  if (!caregiver) { res.status(404).json({ error: "Você não é cuidador nesta família" }); return; }

  const accessToken = generateAccessToken(getAuth(req).userId, caregiver.familyId, caregiver.id, caregiver.role);
  const { raw: refreshRaw, hash: refreshHash } = generateRefreshToken(getAuth(req).userId);
  const REFRESH_TTL_DAYS = 30;
  await db.insert(refreshTokensTable).values({
    userId: getAuth(req).userId,
    tokenHash: refreshHash,
    userAgent: req.headers["user-agent"] ?? null,
    ipAddress: req.ip ?? null,
    expiresAt: new Date(Clock.now().getTime() + REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000),
  });

  await audit({
    familyId: caregiver.familyId,
    entityType: "session",
    entityId: String(caregiver.id),
    action: "updated",
    actorId: String(caregiver.id),
    actorType: "caregiver",
    ipAddress: req.ip,
  });

  res.json({ accessToken, refreshToken: refreshRaw, expiresIn: 15 * 60, userId: getAuth(req).userId });
});

// ── Ajustes da família (ZELO-24) ─────────────────────────────────────────
// Só o cuidador principal muda — é uma decisão de família, não individual.
// Vive aqui (não em routes/families.ts) porque é sempre a família do
// próprio token — o mesmo padrão de "/account/selected-patient" acima.

const QuietHour = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "horário deve ser HH:mm");

const FamilySettingsBody = z.object({
  retroactiveWindowHours: z.number().int().min(1).max(24 * 30).optional(),
  // ZELO-28: desligado por padrão no banco — este campo só existe pra
  // ligar explicitamente, nunca é obrigatório no corpo.
  showMedicationInPush: z.boolean().optional(),
  // ZELO-30: janela de silêncio noturno — usada pelo nível 2 (T+30) da
  // cascata de escalonamento (ver isQuietHoursNow em dose-reminders.ts).
  quietHoursEnabled: z.boolean().optional(),
  quietHoursStart: QuietHour.optional(),
  quietHoursEnd: QuietHour.optional(),
}).refine(
  (b) =>
    b.retroactiveWindowHours !== undefined ||
    b.showMedicationInPush !== undefined ||
    b.quietHoursEnabled !== undefined ||
    b.quietHoursStart !== undefined ||
    b.quietHoursEnd !== undefined,
  { message: "Envie ao menos um ajuste pra alterar" }
);

router.patch("/families/me/settings", requireAuth, requirePrimaryCaregiver, async (req, res): Promise<void> => {
  const body = FamilySettingsBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }

  const [updated] = await db
    .update(familiesTable)
    .set({
      ...(body.data.retroactiveWindowHours !== undefined ? { retroactiveWindowHours: body.data.retroactiveWindowHours } : {}),
      ...(body.data.showMedicationInPush !== undefined ? { showMedicationInPush: body.data.showMedicationInPush } : {}),
      ...(body.data.quietHoursEnabled !== undefined ? { quietHoursEnabled: body.data.quietHoursEnabled } : {}),
      ...(body.data.quietHoursStart !== undefined ? { quietHoursStart: body.data.quietHoursStart } : {}),
      ...(body.data.quietHoursEnd !== undefined ? { quietHoursEnd: body.data.quietHoursEnd } : {}),
      updatedAt: Clock.now(),
    })
    .where(eq(familiesTable.id, getAuth(req).familyId))
    .returning({
      id: familiesTable.id,
      retroactiveWindowHours: familiesTable.retroactiveWindowHours,
      showMedicationInPush: familiesTable.showMedicationInPush,
      quietHoursEnabled: familiesTable.quietHoursEnabled,
      quietHoursStart: familiesTable.quietHoursStart,
      quietHoursEnd: familiesTable.quietHoursEnd,
    });

  await audit({
    familyId: getAuth(req).familyId,
    entityType: "family",
    entityId: String(getAuth(req).familyId),
    action: "updated",
    actorId: String(getAuth(req).caregiverId),
    actorType: "caregiver",
    diff: JSON.stringify(body.data),
  });

  res.json(updated);
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
