/**
 * Limitadores de taxa — ZELO.
 *
 * Todos os endpoints de autenticação têm dois limitadores:
 *   1. Por IP — protege contra ataques distribuídos
 *   2. Por e-mail/identificador — protege contra ataques direcionados
 *
 * Em desenvolvimento os limites são dobrados para não atrapalhar testes.
 *
 * RESPOSTA PADRÃO EM EXCESSO: 429 com Retry-After em segundos.
 */

import rateLimit from "express-rate-limit";

const isDev = process.env.NODE_ENV !== "production";
const M = isDev ? 10 : 1; // multiplicador: mais frouxo em dev

/** Login: 5 tentativas por 15 min por IP. */
export const loginByIpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5 * M,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: (req) => `login:ip:${(req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() ?? req.socket.remoteAddress ?? "unknown"}`,
  message: { error: "Muitas tentativas. Aguarde antes de tentar novamente." },
});

/** Login: 10 tentativas por hora por e-mail (protege contas específicas). */
export const loginByEmailLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10 * M,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: (req) => {
    const body = req.body as Record<string, unknown> | undefined;
    const email = typeof body?.email === "string" ? body.email.toLowerCase() : "unknown";
    return `login:email:${email}`;
  },
  message: { error: "Muitas tentativas. Aguarde antes de tentar novamente." },
});

/** Cadastro: 3 por hora por IP. */
export const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 3 * M,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: (req) => `register:${(req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() ?? req.socket.remoteAddress ?? "unknown"}`,
  message: { error: "Muitas tentativas. Aguarde antes de tentar novamente." },
});

/** Recuperação de senha: 3 por hora por IP + e-mail. */
export const passwordResetLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 3 * M,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: (req) => {
    const body = req.body as Record<string, unknown> | undefined;
    const email = typeof body?.email === "string" ? body.email.toLowerCase() : "unknown";
    const ip = (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() ?? req.socket.remoteAddress ?? "unknown";
    return `reset:${ip}:${email}`;
  },
  message: { error: "Muitas tentativas. Aguarde antes de tentar novamente." },
});

/** Confirmação de senha do usuário JÁ autenticado ("confirme que é você"
 *  antes de uma ação sensível): 10 por 15 min por usuário.
 *
 *  Limite próprio, separado do de login, de propósito: quem já está
 *  autenticado errar a senha aqui não pode consumir a cota de LOGIN e
 *  trancar a conta pra entrar de novo — foi o que aconteceria ao reusar
 *  /auth/login pra confirmar a saída do modo idoso. A chave é o userId do
 *  token (não o IP), já que o aparelho é compartilhado por definição. */
export const verifyPasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10 * M,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: (req) => {
    const auth = (req as { user?: { userId?: number } }).user;
    return `verify-password:${auth?.userId ?? "unknown"}`;
  },
  message: { error: "Muitas tentativas de senha. Aguarde alguns minutos." },
});

/** Reenvio de verificação: 2 por hora por IP. */
export const resendVerificationLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 2 * M,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: (req) => `resend:${(req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() ?? req.socket.remoteAddress ?? "unknown"}`,
  message: { error: "Muitas tentativas. Aguarde antes de tentar novamente." },
});
