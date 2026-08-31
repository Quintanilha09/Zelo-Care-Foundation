import { getAuth } from "../lib/auth-types.ts";
import { apagarMidiasDaFamilia } from "../lib/media-cleanup.ts";
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
import { getPlanTier, PLAN_LIMITS, PLAN_LABELS } from "../lib/plan-limits.ts";
import { verifyPassword } from "../lib/password";
import { verifyPasswordLimiter } from "../lib/rate-limit";

const router = Router();

// ── Dados da conta ────────────────────────────────────────────────────────

router.get("/account/me", requireAuth, async (req, res): Promise<void> => {
  // `email` é dado do PRÓPRIO usuário autenticado (não de terceiro), e o
  // cliente já declarava depender dele — mas a consulta nunca o selecionava,
  // então `user.email` chegava `undefined` no frontend e qualquer código que
  // dependesse dele falhava em silêncio (foi exatamente o que travou a saída
  // do modo idoso). Tipo e resposta agora batem de verdade.
  const [user] = await db
    .select({ id: usersTable.id, name: usersTable.name, email: usersTable.email, emailVerified: usersTable.emailVerified, status: usersTable.status, createdAt: usersTable.createdAt })
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

  // ZELO-38: "estado do plano visível no perfil, sem ficar martelando no
  // dia a dia" — só o suficiente pra tela de Ajustes mostrar "Grátis" ou
  // "Família" e os limites em vigor, sem banner nem lembrete recorrente.
  // ZELO-56: com mais de um tier pago, `isPaid` deixou de bastar pra tela
  // saber o que mostrar — `tier` e `label` vão junto. `isPaid` continua
  // no payload porque telas antigas dependem dele.
  const planTier = caregiver ? await getPlanTier(caregiver.familyId) : null;
  const plan = caregiver && planTier
    ? {
        tier: planTier,
        label: PLAN_LABELS[planTier],
        isPaid: planTier !== "free",
        limits: PLAN_LIMITS[planTier],
      }
    : null;

  res.json({ ...user, caregiver, family, plan });
});

// ── Confirmar a senha do próprio usuário autenticado ─────────────────────
// Existe para "confirme que é você" ANTES de uma ação sensível (sair do modo
// idoso é a primeira), sem os efeitos colaterais de reusar POST /auth/login
// pra isso: login rotaciona o par de tokens, recarrega a sessão e passa pelo
// rate limiter de login (5 tentativas/15min por IP) — reaproveitar ali
// derrubava a sessão do aparelho e travava o cuidador por tentativa errada.
// Aqui a sessão fica intocada: só responde "a senha confere?".
//
// Nunca revela se a conta existe/tem senha — quem chega aqui já está
// autenticado, então a única resposta possível é sobre a senha em si.

const VerifyPasswordBody = z.object({ password: z.string().min(1).max(128) });

router.post("/account/verify-password", requireAuth, verifyPasswordLimiter, async (req, res): Promise<void> => {
  const body = VerifyPasswordBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: "Informe a senha." }); return; }

  const [user] = await db
    .select({ passwordHash: usersTable.passwordHash })
    .from(usersTable)
    .where(eq(usersTable.id, getAuth(req).userId))
    .limit(1);

  // Conta criada só por Google não tem senha local — dizer "senha incorreta"
  // seria mentira e deixaria a pessoa tentando pra sempre.
  if (!user?.passwordHash) {
    res.status(400).json({ error: "Esta conta entra pelo Google e não tem senha.", code: "NO_PASSWORD_SET" });
    return;
  }

  if (!(await verifyPassword(user.passwordHash, body.data.password))) {
    res.status(401).json({ error: "Senha incorreta.", code: "INVALID_PASSWORD" });
    return;
  }

  res.json({ verified: true });
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

// ── Estado do pedido de exclusão ──────────────────────────────────────────
//
// QUI-17: as três rotas de exclusão existiam e eram testadas, mas **nenhuma
// tela as chamava** — e não dava para construir a tela sem esta: sem saber se
// já há pedido pendente, a página não teria como escolher entre oferecer
// "solicitar", "cancelar" ou "excluir agora".
//
// `requireAuth`, e não `requirePrimaryCaregiver`: qualquer cuidador da
// família tem o direito de SABER que a conta está marcada para exclusão em
// sete dias. Só o principal é que pode pedir, cancelar e executar.

router.get("/account/deletion", requireAuth, async (req, res): Promise<void> => {
  const [pendente] = await db
    .select({
      id: deletionRequestsTable.id,
      scheduledDeletionAt: deletionRequestsTable.scheduledDeletionAt,
      requestedAt: deletionRequestsTable.requestedAt,
    })
    .from(deletionRequestsTable)
    .where(
      and(
        eq(deletionRequestsTable.familyId, getAuth(req).familyId),
        eq(deletionRequestsTable.status, "pending")
      )
    )
    .limit(1);

  if (!pendente) { res.json({ pending: null }); return; }

  res.json({
    pending: {
      scheduledDeletionAt: pendente.scheduledDeletionAt,
      requestedAt: pendente.requestedAt,
      // Quem decide se a janela fechou é o relógio do SERVIDOR — o mesmo que
      // a rota de execução vai consultar. Deixar a tela calcular pelo relógio
      // do aparelho ofereceria o botão cedo demais num celular adiantado.
      canExecuteNow: pendente.scheduledDeletionAt <= Clock.now(),
    },
  });
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

  // QUI-11 — REQ-006 passa a incluir MÍDIA.
  //
  // O cascade da tabela derruba as linhas de media_assets quando a família
  // some, mas NÃO toca no balde. Sem esta chamada, apagar a conta deixaria
  // as fotos da pessoa no armazenamento para sempre, sem nada apontando
  // para elas — exclusão que não exclui.
  //
  // Fora da transação de propósito: apagar objeto é I/O de rede, e uma
  // falha lá não pode segurar a transação do banco aberta. Se sobrar
  // objeto, o log registra e a exclusão do banco segue — porque o direito
  // do titular de sumir do sistema não pode ficar refém do bucket.
  const limpezaDeMidia = await apagarMidiasDaFamilia(familyId);
  if (limpezaDeMidia.falhas > 0) {
    safeLog.error(
      { action: "family_media_purge_incomplete", count: limpezaDeMidia.falhas },
      "Exclusao do titular: nem toda a midia foi apagada do armazenamento"
    );
  }

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
