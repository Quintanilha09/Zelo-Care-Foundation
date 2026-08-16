/**
 * Utilitários de token — ZELO.
 *
 * ACCESS TOKEN (JWT):
 *   - Vida curta: 15 minutos
 *   - Payload: { sub (userId), familyId, caregiverId, role, jti }
 *   - Assinado com SESSION_SECRET
 *   - jti (JWT ID) permite revogação individual via blacklist em memória
 *
 * REFRESH TOKEN (opaco):
 *   - Estrutura raw: base64url({ userId, nonce: hex aleatório })
 *   - O banco guarda SHA-256(rawToken) — nunca o token cru
 *   - Ao decodificar um token não-encontrado no banco, recuperamos o userId
 *     para detectar roubo de sessão e revogar todos os tokens do usuário
 *
 * REVOGAÇÃO IMEDIATA (sem DB por requisição):
 *   - revokedJtis: Set em memória com JTIs revogados (logout individual)
 *   - userLogoutAt: Map userId → timestamp de logout-all
 *   - Tokens expiram em 15 min mesmo sem estar na blacklist
 */

import jwt from "jsonwebtoken";
import crypto from "node:crypto";
import { Clock } from "./clock";

if (!process.env.SESSION_SECRET) {
  throw new Error("SESSION_SECRET não definido — configure o segredo no vault");
}
const JWT_SECRET = process.env.SESSION_SECRET;
const ACCESS_TOKEN_TTL_SECONDS = 15 * 60; // 15 minutos

export interface AccessTokenPayload {
  userId: number;
  familyId: number;
  caregiverId: number;
  role: "primary_caregiver" | "caregiver" | "hired_caregiver" | "observer";
  jti: string;
  iat: number;
  exp: number;
}

// ── Blacklist em memória ──────────────────────────────────────────────────
// Perdida no restart do servidor — aceitável pois tokens expiram em 15 min.
const revokedJtis = new Set<string>();
const userLogoutAt = new Map<number, number>(); // userId → Date.now() do logout-all

export function revokeAccessToken(jti: string): void {
  revokedJtis.add(jti);
}

export function revokeAllAccessTokensForUser(userId: number): void {
  // Armazenar em segundos (mesma granularidade do JWT iat) evita falsos rejeites
  // quando um novo token é emitido no mesmo segundo que o logout-all.
  userLogoutAt.set(userId, Math.floor(Clock.now().getTime() / 1000));
}

export function isAccessTokenRevoked(payload: AccessTokenPayload): boolean {
  if (revokedJtis.has(payload.jti)) return true;
  const logoutAtSec = userLogoutAt.get(payload.userId);
  // Usa <= (não <): JWT iat tem resolução de 1 segundo, então um token
  // emitido no MESMO segundo que a revogação é indistinguível de "emitido
  // antes". Quando essa ambiguidade existe, erramos para o lado seguro —
  // trata como revogado. O custo é raro (força um re-login legítimo que por
  // coincidência caiu no mesmo segundo); o benefício é que revogar cuidador
  // (Fase 03) tem efeito realmente imediato, sem essa janela de 1s de escape.
  if (logoutAtSec !== undefined && payload.iat <= logoutAtSec) return true;
  return false;
}

// ── Access token ──────────────────────────────────────────────────────────

export function generateAccessToken(
  userId: number,
  familyId: number,
  caregiverId: number,
  role: AccessTokenPayload["role"]
): string {
  // Usa Clock.now() para iat para que o relógio controlável (Clock.advance)
  // funcione corretamente nos testes. jwt.sign usa Date.now() por padrão
  // mas aceitamos iat explícito via payload.
  const nowSec = Math.floor(Clock.now().getTime() / 1000);
  const payload = {
    sub: String(userId),
    userId,
    familyId,
    caregiverId,
    role,
    jti: crypto.randomUUID(),
    iat: nowSec,
    exp: nowSec + ACCESS_TOKEN_TTL_SECONDS,
  };
  return jwt.sign(payload, JWT_SECRET);
}

export function verifyAccessToken(token: string): AccessTokenPayload | null {
  try {
    const payload = jwt.verify(token, JWT_SECRET) as AccessTokenPayload;
    if (isAccessTokenRevoked(payload)) return null;
    return payload;
  } catch {
    return null;
  }
}

// ── Refresh token (opaco) ─────────────────────────────────────────────────

interface RefreshTokenData {
  userId: number;
  nonce: string;
}

/** Gera um refresh token opaco e retorna { raw, hash, userId }. */
export function generateRefreshToken(userId: number): { raw: string; hash: string } {
  const data: RefreshTokenData = { userId, nonce: crypto.randomBytes(32).toString("hex") };
  const raw = Buffer.from(JSON.stringify(data)).toString("base64url");
  const hash = hashToken(raw);
  return { raw, hash };
}

/** Extrai o userId embutido no refresh token SEM verificar validade.
 *  Usado para theft detection quando o hash não é encontrado no banco. */
export function decodeRefreshTokenUserId(raw: string): number | null {
  try {
    const json = Buffer.from(raw, "base64url").toString("utf-8");
    const data = JSON.parse(json) as Partial<RefreshTokenData>;
    if (typeof data.userId !== "number") return null;
    return data.userId;
  } catch {
    return null;
  }
}

// ── Utilitários gerais ────────────────────────────────────────────────────

export function hashToken(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

/** Gera um token de uso único (email verification, password reset, export). */
export function generateOneTimeToken(): { raw: string; hash: string } {
  const raw = crypto.randomBytes(32).toString("hex");
  const hash = hashToken(raw);
  return { raw, hash };
}
