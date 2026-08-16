import { getAuth } from "../lib/auth-types.ts";
/**
 * Rotas de autenticação — ZELO.
 * POST /api/auth/register
 * POST /api/auth/verify-email
 * POST /api/auth/login
 * POST /api/auth/refresh
 * POST /api/auth/logout
 * POST /api/auth/logout-all
 * POST /api/auth/password-reset/request
 * POST /api/auth/password-reset/confirm
 *
 * SEGURANÇA:
 * - Nenhum log contém e-mail, senha ou token (allowlist do safeLog)
 * - Rate limiting em todos os endpoints sensíveis
 * - Token de refresh usa rotação com detecção de roubo de sessão
 * - Recuperação de senha retorna 200 mesmo se o e-mail não existir (antiEnumeração)
 */

import { Router } from "express";
import { z } from "zod";
import { eq, and, gt, isNull, or } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  usersTable,
  caregiversTable,
  familiesTable,
  refreshTokensTable,
  emailVerificationsTable,
  passwordResetsTable,
  consentRecordsTable,
} from "@workspace/db";
import { hashPassword, verifyPassword, validatePasswordStrength } from "../lib/password";
import {
  generateAccessToken,
  generateRefreshToken,
  generateOneTimeToken,
  hashToken,
  decodeRefreshTokenUserId,
  revokeAccessToken,
  revokeAllAccessTokensForUser,
} from "../lib/tokens";
import { sendVerificationEmail, sendPasswordResetEmail } from "../lib/email";
import { safeLog } from "../lib/safe-logger";
import { audit } from "../lib/audit";
import { requireAuth } from "../middleware/require-auth";
import {
  loginByIpLimiter,
  loginByEmailLimiter,
  registerLimiter,
  passwordResetLimiter,
} from "../lib/rate-limit";
import { Clock } from "../lib/clock";

const router = Router();

// ── CADASTRO ─────────────────────────────────────────────────────────────

const RegisterBody = z.object({
  name: z.string().min(2).max(100),
  email: z.string().email(),
  password: z.string().min(8).max(128),
  consentTerms: z.boolean(),          // aceite dos Termos de Uso
  consentHealthData: z.boolean(),     // aceite para tratamento de dados de saúde
  consentRepresentative: z.enum(["self", "legal_representative"]).optional(),
  familyName: z.string().min(2).max(100).optional(),
});

router.post("/auth/register", registerLimiter, async (req, res): Promise<void> => {
  const body = RegisterBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  if (!body.data.consentTerms) {
    res.status(400).json({ error: "É necessário aceitar os Termos de Uso para continuar" });
    return;
  }
  if (!body.data.consentHealthData) {
    res.status(400).json({ error: "É necessário consentir com o tratamento de dados de saúde" });
    return;
  }

  const strengthCheck = validatePasswordStrength(body.data.password);
  if (!strengthCheck.ok) {
    res.status(400).json({ error: strengthCheck.error });
    return;
  }

  // Verifica e-mail único
  const [existingUser] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.email, body.data.email.toLowerCase()))
    .limit(1);

  if (existingUser) {
    // Retorna o mesmo erro que "e-mail inválido" para não confirmar existência
    res.status(400).json({ error: "Não foi possível criar a conta com esses dados" });
    return;
  }

  const passwordHash = await hashPassword(body.data.password);
  const ip = req.ip ?? "unknown";

  // Tudo em uma transação: usuário + família + cuidador + consentimentos
  const { userId, familyId, caregiverId } = await db.transaction(async (tx) => {
    // 1. Criar usuário
    const [newUser] = await tx
      .insert(usersTable)
      .values({
        email: body.data.email.toLowerCase(),
        name: body.data.name,
        passwordHash,
        emailVerified: false,
        status: "pending_verification",
      })
      .returning({ id: usersTable.id });

    // 2. Criar família
    const familyName = body.data.familyName ?? `Família de ${body.data.name}`;
    const slug = familyName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .slice(0, 50) + `-${Date.now()}`;
    const [newFamily] = await tx
      .insert(familiesTable)
      .values({ name: familyName, slug })
      .returning({ id: familiesTable.id });

    // 3. Criar cuidador principal vinculado ao usuário
    const [newCaregiver] = await tx
      .insert(caregiversTable)
      .values({
        familyId: newFamily.id,
        userId: newUser.id,
        name: body.data.name,
        email: body.data.email.toLowerCase(),
        role: "primary_caregiver",
      })
      .returning({ id: caregiversTable.id });

    // 4. Registrar consentimento dos Termos de Uso
    await tx.insert(consentRecordsTable).values({
      userId: newUser.id,
      consentType: "terms_of_service",
      consentGiven: "true",
      version: "v1.0",
      ipAddress: ip,
      userAgent: req.headers["user-agent"] ?? "",
    });

    // 5. Registrar consentimento de dados de saúde
    await tx.insert(consentRecordsTable).values({
      userId: newUser.id,
      consentType: "health_data_processing",
      consentGiven: "true",
      version: "v1.0",
      ipAddress: ip,
      userAgent: req.headers["user-agent"] ?? "",
      // Quem está consentindo: o titular ou um representante legal
    });

    return { userId: newUser.id, familyId: newFamily.id, caregiverId: newCaregiver.id };
  });

  // 6. Token de verificação de e-mail
  const { raw: verifyRaw, hash: verifyHash } = generateOneTimeToken();
  await db.insert(emailVerificationsTable).values({
    userId,
    tokenHash: verifyHash,
    expiresAt: new Date(Clock.now().getTime() + 24 * 60 * 60 * 1000), // 24h
  });
  await sendVerificationEmail(body.data.email, verifyRaw);

  safeLog.info({ action: "register", userId, familyId, caregiverId }, "Novo usuário cadastrado");
  await audit({ familyId, entityType: "user", entityId: String(userId), action: "created", actorType: "system", ipAddress: ip });

  res.status(201).json({ message: "Conta criada. Verifique seu e-mail para ativar a conta." });
});

// ── VERIFICAÇÃO DE E-MAIL ─────────────────────────────────────────────────

router.post("/auth/verify-email", async (req, res): Promise<void> => {
  const token = String(req.body?.token ?? "");
  if (!token) { res.status(400).json({ error: "Token obrigatório" }); return; }

  const tokenHash = hashToken(token);
  const [record] = await db
    .select()
    .from(emailVerificationsTable)
    .where(
      and(
        eq(emailVerificationsTable.tokenHash, tokenHash),
        eq(emailVerificationsTable.used, false),
        gt(emailVerificationsTable.expiresAt, Clock.now())
      )
    )
    .limit(1);

  if (!record) {
    res.status(400).json({ error: "Token inválido ou expirado" });
    return;
  }

  await db.transaction(async (tx) => {
    await tx.update(emailVerificationsTable)
      .set({ used: true, usedAt: Clock.now() })
      .where(eq(emailVerificationsTable.id, record.id));
    await tx.update(usersTable)
      .set({ emailVerified: true, status: "active" })
      .where(eq(usersTable.id, record.userId));
  });

  res.json({ message: "E-mail verificado com sucesso. Faça login para continuar." });
});

// ── LOGIN ────────────────────────────────────────────────────────────────

const LoginBody = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

router.post("/auth/login", loginByIpLimiter, loginByEmailLimiter, async (req, res): Promise<void> => {
  const body = LoginBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "E-mail e senha são obrigatórios" });
    return;
  }

  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.email, body.data.email.toLowerCase()))
    .limit(1);

  // Timing-safe: mesmo que o usuário não exista, executa o verify para evitar timing attack
  const dummyHash = "$argon2id$v=19$m=65536,t=3,p=1$dummysalt1234567$dummyhash123456789012345678901234";
  const passwordOk = user?.passwordHash
    ? await verifyPassword(user.passwordHash, body.data.password)
    : await verifyPassword(dummyHash, body.data.password).then(() => false);

  if (!user || !passwordOk) {
    res.status(401).json({ error: "E-mail ou senha incorretos" });
    return;
  }

  if (!user.emailVerified) {
    res.status(403).json({ error: "Verifique seu e-mail antes de fazer login" });
    return;
  }

  if (user.status !== "active") {
    res.status(403).json({ error: "Conta suspensa ou inativa" });
    return;
  }

  // Busca o cuidador vinculado ao usuário
  const [caregiver] = await db
    .select({ id: caregiversTable.id, familyId: caregiversTable.familyId, role: caregiversTable.role })
    .from(caregiversTable)
    .where(eq(caregiversTable.userId, user.id))
    .limit(1);

  if (!caregiver) {
    res.status(500).json({ error: "Conta sem vínculo familiar. Contate o suporte." });
    return;
  }

  const accessToken = generateAccessToken(user.id, caregiver.familyId, caregiver.id, caregiver.role);
  const { raw: refreshRaw, hash: refreshHash } = generateRefreshToken(user.id);

  const REFRESH_TTL_DAYS = 30;
  await db.insert(refreshTokensTable).values({
    userId: user.id,
    tokenHash: refreshHash,
    userAgent: req.headers["user-agent"] ?? null,
    ipAddress: req.ip ?? null,
    expiresAt: new Date(Clock.now().getTime() + REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000),
  });

  safeLog.info({ action: "login", userId: user.id, caregiverId: caregiver.id }, "Login realizado");
  await audit({
    familyId: caregiver.familyId,
    entityType: "session",
    entityId: String(user.id),
    action: "created",
    actorId: String(caregiver.id),
    actorType: "caregiver",
    ipAddress: req.ip ?? undefined,
  });

  res.json({ accessToken, refreshToken: refreshRaw, expiresIn: 900 });
});

// ── RENOVAÇÃO DE TOKEN ────────────────────────────────────────────────────

router.post("/auth/refresh", async (req, res): Promise<void> => {
  const raw = String(req.body?.refreshToken ?? "");
  if (!raw) { res.status(401).json({ error: "Token de renovação obrigatório" }); return; }

  const tokenHash = hashToken(raw);

  const [existing] = await db
    .select()
    .from(refreshTokensTable)
    .where(
      and(
        eq(refreshTokensTable.tokenHash, tokenHash),
        eq(refreshTokensTable.revoked, false),
        gt(refreshTokensTable.expiresAt, Clock.now())
      )
    )
    .limit(1);

  if (!existing) {
    // Token não encontrado como ativo: pode ter sido rotacionado (roubo de sessão)
    const stolenUserId = decodeRefreshTokenUserId(raw);
    if (stolenUserId !== null) {
      // SINAL DE ROUBO DE SESSÃO — revogar TODOS os tokens deste usuário
      await db.update(refreshTokensTable)
        .set({ revoked: true, revokedAt: Clock.now(), revokedReason: "theft_detected" })
        .where(and(eq(refreshTokensTable.userId, stolenUserId), eq(refreshTokensTable.revoked, false)));
      revokeAllAccessTokensForUser(stolenUserId);
      safeLog.warn({ action: "theft_detected", userId: stolenUserId }, "Roubo de sessão detectado — todos os tokens revogados");
    }
    res.status(401).json({ error: "Sessão inválida. Faça login novamente." });
    return;
  }

  const [caregiver] = await db
    .select({ id: caregiversTable.id, familyId: caregiversTable.familyId, role: caregiversTable.role })
    .from(caregiversTable)
    .where(eq(caregiversTable.userId, existing.userId))
    .limit(1);

  if (!caregiver) {
    res.status(401).json({ error: "Sessão inválida" });
    return;
  }

  // Rotação: invalida o token antigo e gera um novo par
  const { raw: newRefreshRaw, hash: newRefreshHash } = generateRefreshToken(existing.userId);
  const newAccessToken = generateAccessToken(existing.userId, caregiver.familyId, caregiver.id, caregiver.role);

  await db.transaction(async (tx) => {
    await tx.update(refreshTokensTable)
      .set({ revoked: true, revokedAt: Clock.now(), revokedReason: "rotated" })
      .where(eq(refreshTokensTable.id, existing.id));
    await tx.insert(refreshTokensTable).values({
      userId: existing.userId,
      tokenHash: newRefreshHash,
      userAgent: req.headers["user-agent"] ?? null,
      ipAddress: req.ip ?? null,
      expiresAt: new Date(Clock.now().getTime() + 30 * 24 * 60 * 60 * 1000),
    });
  });

  res.json({ accessToken: newAccessToken, refreshToken: newRefreshRaw, expiresIn: 900 });
});

// ── LOGOUT ───────────────────────────────────────────────────────────────

router.post("/auth/logout", requireAuth, async (req, res): Promise<void> => {
  const raw = String(req.body?.refreshToken ?? "");

  if (raw) {
    const tokenHash = hashToken(raw);
    await db.update(refreshTokensTable)
      .set({ revoked: true, revokedAt: Clock.now(), revokedReason: "user_logout" })
      .where(
        and(
          eq(refreshTokensTable.tokenHash, tokenHash),
          eq(refreshTokensTable.userId, getAuth(req).userId)
        )
      );
  }

  // Revoga o access token atual via blacklist em memória
  revokeAccessToken(getAuth(req).jti);
  res.status(204).send();
});

// ── LOGOUT DE TODOS OS DISPOSITIVOS ──────────────────────────────────────

router.post("/auth/logout-all", requireAuth, async (req, res): Promise<void> => {
  await db.update(refreshTokensTable)
    .set({ revoked: true, revokedAt: Clock.now(), revokedReason: "logout_all" })
    .where(
      and(
        eq(refreshTokensTable.userId, getAuth(req).userId),
        eq(refreshTokensTable.revoked, false)
      )
    );
  revokeAllAccessTokensForUser(getAuth(req).userId);

  safeLog.info({ action: "logout_all", userId: getAuth(req).userId }, "Logout de todos os dispositivos");
  await audit({
    familyId: getAuth(req).familyId,
    entityType: "session",
    entityId: String(getAuth(req).userId),
    action: "deleted",
    actorId: String(getAuth(req).caregiverId),
    actorType: "caregiver",
  });

  res.status(204).send();
});

// ── RECUPERAÇÃO DE SENHA — SOLICITAÇÃO ──────────────────────────────────

router.post("/auth/password-reset/request", passwordResetLimiter, async (req, res): Promise<void> => {
  const email = String(req.body?.email ?? "").toLowerCase();

  // Sempre retorna 200 — nunca confirma se o e-mail existe (antiEnumeração)
  const [user] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.email, email))
    .limit(1);

  if (user) {
    const { raw, hash } = generateOneTimeToken();
    await db.insert(passwordResetsTable).values({
      userId: user.id,
      tokenHash: hash,
      expiresAt: new Date(Clock.now().getTime() + 60 * 60 * 1000), // 1 hora
      requestIp: req.ip ?? null,
    });
    await sendPasswordResetEmail(email, raw);
  }

  res.json({ message: "Se esse e-mail estiver cadastrado, você receberá um link de recuperação." });
});

// ── RECUPERAÇÃO DE SENHA — CONFIRMAÇÃO ───────────────────────────────────

const ResetConfirmBody = z.object({
  token: z.string().min(1),
  newPassword: z.string().min(8).max(128),
});

router.post("/auth/password-reset/confirm", async (req, res): Promise<void> => {
  const body = ResetConfirmBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: "Token e nova senha são obrigatórios" }); return; }

  const strengthCheck = validatePasswordStrength(body.data.newPassword);
  if (!strengthCheck.ok) { res.status(400).json({ error: strengthCheck.error }); return; }

  const tokenHash = hashToken(body.data.token);
  const [record] = await db
    .select()
    .from(passwordResetsTable)
    .where(
      and(
        eq(passwordResetsTable.tokenHash, tokenHash),
        eq(passwordResetsTable.used, false),
        gt(passwordResetsTable.expiresAt, Clock.now())
      )
    )
    .limit(1);

  if (!record) { res.status(400).json({ error: "Link inválido ou expirado" }); return; }

  const newHash = await hashPassword(body.data.newPassword);

  await db.transaction(async (tx) => {
    await tx.update(usersTable).set({ passwordHash: newHash }).where(eq(usersTable.id, record.userId));
    await tx.update(passwordResetsTable)
      .set({ used: true, usedAt: Clock.now() })
      .where(eq(passwordResetsTable.id, record.id));
    // Força logout em todos os dispositivos após troca de senha
    await tx.update(refreshTokensTable)
      .set({ revoked: true, revokedAt: Clock.now(), revokedReason: "password_changed" })
      .where(and(eq(refreshTokensTable.userId, record.userId), eq(refreshTokensTable.revoked, false)));
  });
  revokeAllAccessTokensForUser(record.userId);

  res.json({ message: "Senha alterada. Faça login novamente em todos os dispositivos." });
});

export default router;
