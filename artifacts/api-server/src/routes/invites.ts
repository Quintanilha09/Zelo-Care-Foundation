import { getAuth } from "../lib/auth-types.ts";
/**
 * Rotas de convite de cuidadores — ZELO.
 * POST /api/invites         — cria convite (primary_caregiver)
 * POST /api/invites/accept  — aceita convite com token
 * GET  /api/invites         — lista convites da família
 * DELETE /api/invites/:id   — revoga convite (primary_caregiver)
 */

import { Router } from "express";
import { z } from "zod";
import { eq, and, gt } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  caregiverInvitesTable,
  caregiversTable,
  usersTable,
  patientsTable,
  refreshTokensTable,
} from "@workspace/db";
import { generateOneTimeToken, hashToken, generateAccessToken, generateRefreshToken } from "../lib/tokens";
import { sendCaregiverInviteEmail } from "../lib/email";
import { requireAuth, requirePrimaryCaregiver } from "../middleware/require-auth";
import { audit } from "../lib/audit";
import { safeLog } from "../lib/safe-logger";
import { Clock } from "../lib/clock";
import { publishPatientEvent } from "../lib/realtime.ts";
import { switchActiveFamily } from "../lib/active-family.ts";
import { checkCaregiverLimit } from "../lib/plan-limits.ts";

const router = Router();

// ── Criar convite ─────────────────────────────────────────────────────────

const CreateInviteBody = z.object({
  invitedEmail: z.string().email().optional(),
  role: z.enum(["caregiver", "hired_caregiver", "observer"]).default("caregiver"),
});

router.post("/invites", requirePrimaryCaregiver, async (req, res): Promise<void> => {
  const body = CreateInviteBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  // ZELO-38: o momento do paywall É este — convidar o segundo cuidador no
  // gratuito não gera convite nenhum, nunca (nem um que fique pendente
  // sem poder ser aceito depois — bloqueia aqui, na criação).
  const caregiverLimit = await checkCaregiverLimit(getAuth(req).familyId);
  if (!caregiverLimit.allowed) {
    res.status(403).json({ error: caregiverLimit.message, code: "PLAN_LIMIT" });
    return;
  }

  const { raw, hash } = generateOneTimeToken();
  const expiresAt = new Date(Clock.now().getTime() + 7 * 24 * 60 * 60 * 1000); // 7 dias

  const [invite] = await db
    .insert(caregiverInvitesTable)
    .values({
      familyId: getAuth(req).familyId,
      tokenHash: hash,
      invitedEmail: body.data.invitedEmail ?? null,
      role: body.data.role,
      expiresAt,
      createdByUserId: getAuth(req).userId,
    })
    .returning({ id: caregiverInvitesTable.id, expiresAt: caregiverInvitesTable.expiresAt });

  if (body.data.invitedEmail) {
    await sendCaregiverInviteEmail(body.data.invitedEmail, raw);
  }

  await audit({
    familyId: getAuth(req).familyId,
    entityType: "caregiver_invite",
    entityId: String(invite.id),
    action: "created",
    actorId: String(getAuth(req).caregiverId),
    actorType: "caregiver",
  });

  // Retorna o token cru apenas uma vez — quem criar o convite deve compartilhá-lo
  res.status(201).json({
    inviteToken: raw,
    expiresAt: invite.expiresAt,
    role: body.data.role,
    // Link de convite pronto para compartilhar
    inviteLink: `/convite?token=${raw}`,
  });
});

// ── Aceitar convite ───────────────────────────────────────────────────────

const AcceptInviteBody = z.object({
  token: z.string().min(1),
  name: z.string().min(2).max(100).optional(),
});

router.post("/invites/accept", requireAuth, async (req, res): Promise<void> => {
  const body = AcceptInviteBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const tokenHash = hashToken(body.data.token);

  const [invite] = await db
    .select()
    .from(caregiverInvitesTable)
    .where(
      and(
        eq(caregiverInvitesTable.tokenHash, tokenHash),
        eq(caregiverInvitesTable.used, false),
        eq(caregiverInvitesTable.status, "pending"),
        gt(caregiverInvitesTable.expiresAt, Clock.now())
      )
    )
    .limit(1);

  if (!invite) {
    res.status(404).json({ error: "Convite não encontrado, já usado ou expirado" });
    return;
  }

  // Verifica se o usuário já é cuidador nesta família
  const [existing] = await db
    .select({ id: caregiversTable.id })
    .from(caregiversTable)
    .where(
      and(
        eq(caregiversTable.userId, getAuth(req).userId),
        eq(caregiversTable.familyId, invite.familyId)
      )
    )
    .limit(1);

  if (existing) {
    res.status(409).json({ error: "Você já é cuidador nesta família" });
    return;
  }

  // Busca nome do usuário para o cuidador
  const [user] = await db
    .select({ name: usersTable.name, email: usersTable.email })
    .from(usersTable)
    .where(eq(usersTable.id, getAuth(req).userId))
    .limit(1);

  const [newCaregiver] = await db.transaction(async (tx) => {
    // Marca convite como usado
    await tx.update(caregiverInvitesTable)
      .set({ used: true, usedAt: Clock.now(), usedByUserId: getAuth(req).userId, status: "accepted" })
      .where(eq(caregiverInvitesTable.id, invite.id));

    // Cria entrada de cuidador
    return tx
      .insert(caregiversTable)
      .values({
        familyId: invite.familyId,
        userId: getAuth(req).userId,
        name: body.data.name ?? user?.name ?? "Cuidador",
        email: user?.email ?? null,
        role: invite.role,
      })
      .returning();
  });

  safeLog.info({ action: "invite_accepted", caregiverId: newCaregiver.id, familyId: invite.familyId }, "Convite aceito");
  await audit({
    familyId: invite.familyId,
    entityType: "caregiver",
    entityId: String(newCaregiver.id),
    action: "created",
    actorId: String(newCaregiver.id),
    actorType: "caregiver",
    diff: JSON.stringify({ role: newCaregiver.role }),
  });

  // ZELO-25: "cuidador entrou" é notícia de família, não de um paciente só
  // — o canal é por paciente, então avisa em todos os pacientes da família.
  const familyPatients = await db.select({ id: patientsTable.id }).from(patientsTable).where(eq(patientsTable.familyId, invite.familyId));
  for (const p of familyPatients) {
    publishPatientEvent(p.id, { type: "caregiver_joined", caregiverName: newCaregiver.name });
  }

  // BUG corrigido (18/08/2026): esta rota só criava o vínculo em
  // `caregivers`, mas nunca trocava a família ATIVA da sessão — quem já
  // tinha uma conta (ex: própria família fantasma criada no cadastro) e
  // aceitava um convite via /convite continuava vendo a família antiga
  // depois do "Convite aceito", porque o token da sessão corrente nunca
  // mudava. Mesmo sintoma do bug de multi-família já corrigido em
  // auth.ts/active-family.ts, só que num caminho diferente (aceitar
  // convite estando LOGADO, não durante o cadastro) — esquecido na
  // correção original porque foi implementado por uma sessão paralela.
  // Entrar numa família nova via convite sempre torna ela a ativa —
  // mesmo padrão de switchActiveFamily (POST /account/switch-family).
  await switchActiveFamily(getAuth(req).userId, invite.familyId);
  const accessToken = generateAccessToken(getAuth(req).userId, invite.familyId, newCaregiver.id, newCaregiver.role);
  const { raw: refreshRaw, hash: refreshHash } = generateRefreshToken(getAuth(req).userId);
  const REFRESH_TTL_DAYS = 30;
  await db.insert(refreshTokensTable).values({
    userId: getAuth(req).userId,
    tokenHash: refreshHash,
    userAgent: req.headers["user-agent"] ?? null,
    ipAddress: req.ip ?? null,
    expiresAt: new Date(Clock.now().getTime() + REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000),
  });

  res.status(201).json({
    message: "Convite aceito. Você agora é cuidador nesta família.",
    caregiver: newCaregiver,
    accessToken, refreshToken: refreshRaw, expiresIn: 15 * 60,
  });
});

// ── Listar convites ───────────────────────────────────────────────────────

router.get("/invites", requirePrimaryCaregiver, async (req, res): Promise<void> => {
  const invites = await db
    .select({
      id: caregiverInvitesTable.id,
      invitedEmail: caregiverInvitesTable.invitedEmail,
      role: caregiverInvitesTable.role,
      status: caregiverInvitesTable.status,
      expiresAt: caregiverInvitesTable.expiresAt,
      createdAt: caregiverInvitesTable.createdAt,
    })
    .from(caregiverInvitesTable)
    .where(eq(caregiverInvitesTable.familyId, getAuth(req).familyId));

  res.json(invites);
});

// ── Revogar convite ───────────────────────────────────────────────────────

router.delete("/invites/:inviteId", requirePrimaryCaregiver, async (req, res): Promise<void> => {
  const inviteId = Number(req.params.inviteId);
  if (isNaN(inviteId)) { res.status(400).json({ error: "ID inválido" }); return; }

  const [updated] = await db
    .update(caregiverInvitesTable)
    .set({ status: "revoked" })
    .where(
      and(
        eq(caregiverInvitesTable.id, inviteId),
        eq(caregiverInvitesTable.familyId, getAuth(req).familyId),
        eq(caregiverInvitesTable.used, false)
      )
    )
    .returning({ id: caregiverInvitesTable.id });

  if (!updated) {
    res.status(404).json({ error: "Convite não encontrado" });
    return;
  }

  await audit({
    familyId: getAuth(req).familyId,
    entityType: "caregiver_invite",
    entityId: String(inviteId),
    action: "deleted",
    actorId: String(getAuth(req).caregiverId),
    actorType: "caregiver",
  });

  res.status(204).send();
});

export default router;
