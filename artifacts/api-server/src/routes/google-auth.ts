/**
 * Autenticação via Google OAuth 2.0 — ZELO.
 *
 * GET  /api/auth/google           → inicia o fluxo OAuth (redireciona para Google)
 * GET  /api/auth/google/callback  → callback do Google (cria/vincula conta, emite tokens)
 * POST /api/auth/google/exchange  → troca o one-time login code por access+refresh token
 * GET  /api/auth/google/status    → informa ao frontend se OAuth está configurado
 *
 * SEGURANÇA:
 * - State CSRF: gerado aleatoriamente, armazenado em cookie httpOnly, comparado no callback
 * - Login code: one-time, válido 60s, consumido uma única vez
 * - Google já verifica o e-mail — nenhuma verificação adicional necessária
 * - Conta Google-only usa passwordHash="!" — login por senha bloqueado com mensagem clara
 *
 * ISOLAMENTO AMBIENTE:
 * - Em produção: exige GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET configurados
 * - Sem as credenciais: /status retorna { configured: false } e frontend desabilita o botão
 */

import { Router, type Request, type Response } from "express";
import crypto from "node:crypto";
import { eq, lt } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  usersTable,
  caregiversTable,
  familiesTable,
  refreshTokensTable,
  consentRecordsTable,
  oauthLoginCodesTable,
} from "@workspace/db";
import {
  generateAccessToken,
  generateRefreshToken,
  generateOneTimeToken,
  hashToken,
} from "../lib/tokens";
import { safeLog } from "../lib/safe-logger";
import { audit } from "../lib/audit";
import { Clock } from "../lib/clock";
import { resolveActiveCaregiver } from "../lib/active-family.ts";
import { publicTokenLimiter } from "../lib/rate-limit";

const router = Router();

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;

const isConfigured = () => !!(CLIENT_ID && CLIENT_SECRET);

/** Teto de espera pelo Google. Sem isso, um upstream lento segura a
 *  requisição de login indefinidamente e consome conexão do servidor. */
const OAUTH_TIMEOUT_MS = 10_000;

// ── One-time login codes (troca segura de tokens pós-redirect) ────────────
// O backend não pode injetar tokens no frontend via redirect (segurança).
// Emite um code aleatório de vida curta (60s) que o frontend troca por
// tokens reais. Fica no banco (oauth_login_codes), não em memória do
// processo — ver o docblock da tabela pra explicação completa: um Map em
// memória perde o code se /callback e /exchange caírem em processos
// diferentes, e o login falha em silêncio.

async function issueLoginCode(userId: number, accessToken: string, refreshToken: string): Promise<string> {
  const { raw, hash } = generateOneTimeToken();
  await db.insert(oauthLoginCodesTable).values({
    userId,
    codeHash: hash,
    accessToken,
    refreshToken,
    expiresIn: 15 * 60,
    expiresAt: new Date(Clock.now().getTime() + 60_000),
  });
  return raw;
}

interface LoginCodeEntry {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

async function consumeLoginCode(code: string): Promise<LoginCodeEntry | null> {
  const hash = hashToken(code);
  const [entry] = await db
    .delete(oauthLoginCodesTable)
    .where(eq(oauthLoginCodesTable.codeHash, hash))
    .returning();
  if (!entry || entry.expiresAt.getTime() < Clock.now().getTime()) return null;
  return entry;
}

// Limpeza best-effort de codes vencidos nunca trocados (ex: usuário fechou
// a aba no meio do redirect) — não é o que garante segurança (expiresAt já
// faz isso em consumeLoginCode), só evita a tabela crescer à toa.
setInterval(() => {
  void db.delete(oauthLoginCodesTable).where(lt(oauthLoginCodesTable.expiresAt, Clock.now())).catch(() => {});
}, 5 * 60_000).unref();

// ── Helpers ───────────────────────────────────────────────────────────────

function getBaseUrl(req: Request): string {
  // trust proxy está habilitado no app.ts — req.protocol já reflete X-Forwarded-Proto
  const proto = (req.headers["x-forwarded-proto"] as string)?.split(",")[0]?.trim() ?? req.protocol;
  const host = (req.headers["x-forwarded-host"] as string) ?? req.hostname;
  return `${proto}://${host}`;
}

function redirectError(res: Response, reason: string): void {
  res.redirect(`/?auth_error=${encodeURIComponent(reason)}`);
}

// ── Status ────────────────────────────────────────────────────────────────

router.get("/auth/google/status", (_req, res) => {
  res.json({ configured: isConfigured() });
});

// ── Inicia OAuth ──────────────────────────────────────────────────────────

router.get("/auth/google", (req: Request, res: Response): void => {
  if (!isConfigured()) {
    res.status(503).json({ error: "Google OAuth não configurado neste ambiente" });
    return;
  }

  const state = crypto.randomBytes(16).toString("hex");
  const callbackUrl = `${getBaseUrl(req)}/api/auth/google/callback`;

  res.cookie("_g_state", state, {
    httpOnly: true,
    sameSite: "lax",
    maxAge: 10 * 60 * 1000, // 10 minutos
    secure: req.protocol === "https",
  });

  const params = new URLSearchParams({
    client_id: CLIENT_ID!,
    redirect_uri: callbackUrl,
    response_type: "code",
    scope: "openid email profile",
    state,
    access_type: "offline",
    prompt: "select_account",
  });

  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
});

// ── Callback ──────────────────────────────────────────────────────────────

router.get("/auth/google/callback", async (req: Request, res: Response): Promise<void> => {
  const { code, state, error } = req.query as Record<string, string | undefined>;
  const storedState = (req.cookies as Record<string, string>)?._g_state;
  res.clearCookie("_g_state");

  if (error || !code || !state || state !== storedState) {
    safeLog.warn({ action: "google_callback_invalid", hasCode: !!code, hasState: !!state }, "Callback Google inválido ou CSRF");
    redirectError(res, "google_failed");
    return;
  }

  const callbackUrl = `${getBaseUrl(req)}/api/auth/google/callback`;

  // 1. Trocar code por access_token do Google
  let googleEmail: string;
  let googleName: string;

  try {
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      signal: AbortSignal.timeout(OAUTH_TIMEOUT_MS),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: CLIENT_ID!,
        client_secret: CLIENT_SECRET!,
        redirect_uri: callbackUrl,
        grant_type: "authorization_code",
      }),
    });

    if (!tokenRes.ok) {
      safeLog.error({ action: "google_token_exchange_failed", status: tokenRes.status }, "Falha na troca de código");
      redirectError(res, "google_failed");
      return;
    }

    const tokenData = await tokenRes.json() as { access_token: string };

    // 2. Buscar dados do usuário
    const userRes = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
      signal: AbortSignal.timeout(OAUTH_TIMEOUT_MS),
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });

    if (!userRes.ok) throw new Error("userinfo failed");

    const info = await userRes.json() as {
      sub: string; email: string; name: string; email_verified: boolean;
    };

    if (!info.email_verified) {
      redirectError(res, "google_unverified");
      return;
    }

    googleEmail = info.email.toLowerCase();
    googleName = info.name ?? info.email.split("@")[0];
  } catch {
    safeLog.error({ action: "google_userinfo_failed" }, "Falha ao obter dados do Google");
    redirectError(res, "google_failed");
    return;
  }

  const ip = req.ip ?? "unknown";

  // 3. Encontrar conta existente ou criar nova
  const [existing] = await db
    .select({ id: usersTable.id, emailVerified: usersTable.emailVerified, status: usersTable.status })
    .from(usersTable)
    .where(eq(usersTable.email, googleEmail))
    .limit(1);

  let userId: number;
  let familyId: number;
  let caregiverId: number;
  let caregiverRole: "primary_caregiver" | "caregiver" | "hired_caregiver" | "observer" = "primary_caregiver";

  if (existing) {
    // Conta existente — vincula Google (ativa se estava pendente de verificação de e-mail)
    userId = existing.id;

    if (!existing.emailVerified || existing.status !== "active") {
      await db.update(usersTable)
        .set({ emailVerified: true, status: "active" })
        .where(eq(usersTable.id, userId));
    }

    // Mesma resolução do login por senha (lib/active-family.ts) — quem é
    // cuidador em mais de uma família entra sempre na mesma, não numa
    // arbitrária que muda entre sessões.
    const caregiver = await resolveActiveCaregiver(userId);

    if (!caregiver) {
      safeLog.error({ action: "google_no_caregiver", userId }, "Conta sem cuidador vinculado");
      redirectError(res, "google_no_caregiver");
      return;
    }

    caregiverId = caregiver.id;
    familyId = caregiver.familyId;
    caregiverRole = caregiver.role as typeof caregiverRole;

    safeLog.info({ action: "google_login", userId, familyId }, "Login via Google em conta existente");
    await audit({ familyId, entityType: "session", entityId: String(caregiverId), action: "created", actorType: "caregiver", ipAddress: ip });
  } else {
    // Nova conta — mesmo fluxo do cadastro por e-mail, sem verificação adicional
    const result = await db.transaction(async (tx) => {
      const [newUser] = await tx.insert(usersTable).values({
        email: googleEmail,
        name: googleName,
        // "!" marca conta Google-only: verifyPassword nunca é chamado para ela
        // (o login por e-mail verifica esta flag e retorna 401 com mensagem clara)
        passwordHash: "!",
        emailVerified: true,   // Google já verificou
        status: "active",
      }).returning({ id: usersTable.id });

      const familyName = `Família de ${googleName}`;
      const slug = familyName.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 50)
        + `-${Date.now()}`;

      const [newFamily] = await tx.insert(familiesTable)
        .values({ name: familyName, slug })
        .returning({ id: familiesTable.id });

      const [newCaregiver] = await tx.insert(caregiversTable).values({
        familyId: newFamily.id,
        userId: newUser.id,
        name: googleName,
        email: googleEmail,
        role: "primary_caregiver",
      }).returning({ id: caregiversTable.id });

      await tx.insert(consentRecordsTable).values([
        { userId: newUser.id, consentType: "terms_of_service",        consentGiven: "true", version: "v1.0", ipAddress: ip },
        { userId: newUser.id, consentType: "health_data_processing",  consentGiven: "true", version: "v1.0", ipAddress: ip },
      ]);

      return { userId: newUser.id, familyId: newFamily.id, caregiverId: newCaregiver.id };
    });

    userId = result.userId;
    familyId = result.familyId;
    caregiverId = result.caregiverId;

    safeLog.info({ action: "google_register", userId, familyId }, "Nova conta criada via Google");
    await audit({ familyId, entityType: "user", entityId: String(userId), action: "created", actorType: "system", ipAddress: ip });
  }

  // 4. Emitir tokens ZELO e trocar por login code (não expor tokens em URL)
  const REFRESH_TTL_DAYS = 30;
  const accessToken = generateAccessToken(userId, familyId, caregiverId, caregiverRole);
  const { raw: refreshRaw, hash: refreshHash } = generateRefreshToken(userId);

  await db.insert(refreshTokensTable).values({
    userId,
    tokenHash: refreshHash,
    userAgent: req.headers["user-agent"] ?? null,
    ipAddress: ip,
    expiresAt: new Date(Clock.now().getTime() + REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000),
  });

  const loginCode = await issueLoginCode(userId, accessToken, refreshRaw);
  res.redirect(`/?oauth_code=${loginCode}`);
});

// ── Troca do login code por tokens reais ──────────────────────────────────

router.post("/auth/google/exchange", publicTokenLimiter, async (req: Request, res: Response): Promise<void> => {
  const { code } = req.body as { code?: string };
  if (!code) { res.status(400).json({ error: "Código obrigatório" }); return; }

  const entry = await consumeLoginCode(code);
  if (!entry) {
    safeLog.warn({ action: "google_exchange_failed" }, "Código de troca OAuth inválido, expirado ou já usado");
    res.status(401).json({ error: "Código inválido ou expirado — tente novamente" });
    return;
  }

  res.json({ accessToken: entry.accessToken, refreshToken: entry.refreshToken, expiresIn: entry.expiresIn });
});

export default router;
