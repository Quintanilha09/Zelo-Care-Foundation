/**
 * Autenticação do painel operacional — ZELO (ZELO-32).
 *
 * "Autenticação separada da conta de usuário comum" (critério da história)
 * significa, na prática, uma coisa: um token de cuidador nunca pode abrir
 * o painel, e um token de admin nunca pode passar por `requireAuth`. A
 * forma mais simples de garantir isso com certeza — sem depender de
 * lembrar de checar um campo certo no payload — é assinar com um SEGREDO
 * inteiramente diferente de `SESSION_SECRET`. `jwt.verify` rejeita na
 * hora qualquer token assinado com a chave errada, então a separação é
 * garantida pela própria criptografia, não por convenção.
 *
 * Um único operador (o fundador) neste estágio — por isso "senha
 * compartilhada" em vez de conta própria por admin. Evoluir pra
 * admins individuais (se um dia fizer sentido) é troca de mecanismo, não
 * de forma — o resto do painel (rotas, UI) não muda.
 */
import jwt from "jsonwebtoken";
import crypto from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import { Clock } from "./clock.ts";

const ADMIN_TOKEN_TTL_SECONDS = 8 * 60 * 60; // 8h — uma sessão de trabalho, não precisa de refresh token próprio

function getAdminSecret(): string | null {
  const secret = process.env.ADMIN_PANEL_SECRET;
  return secret && secret.length > 0 ? secret : null;
}

/** Comparação em tempo constante — a senha do painel não pode vazar por timing attack. */
function safeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

export function verifyAdminPassword(candidate: string): boolean {
  const secret = getAdminSecret();
  if (!secret) return false;
  return safeEquals(candidate, secret);
}

export function generateAdminToken(): string {
  const secret = getAdminSecret();
  if (!secret) throw new Error("ADMIN_PANEL_SECRET não configurado");
  const nowSec = Math.floor(Clock.now().getTime() / 1000);
  return jwt.sign({ scope: "admin", iat: nowSec, exp: nowSec + ADMIN_TOKEN_TTL_SECONDS }, secret);
}

function verifyAdminToken(token: string): boolean {
  const secret = getAdminSecret();
  if (!secret) return false;
  try {
    const payload = jwt.verify(token, secret) as { scope?: string };
    return payload.scope === "admin";
  } catch {
    return false;
  }
}

export function requireAdminAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ") || !verifyAdminToken(header.slice(7))) {
    res.status(401).json({ error: "Autenticação de administrador necessária" });
    return;
  }
  next();
}
