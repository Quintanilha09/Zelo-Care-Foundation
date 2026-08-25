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

import { allowsDevelopmentShortcuts } from "./environment.ts";
const isDev = allowsDevelopmentShortcuts();
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

function clientIp(req: { headers: Record<string, unknown>; socket: { remoteAddress?: string } }): string {
  const fwd = req.headers["x-forwarded-for"];
  const first = typeof fwd === "string" ? fwd.split(",")[0]?.trim() : undefined;
  return first ?? req.socket.remoteAddress ?? "unknown";
}

/**
 * Extração de medicamento por foto: 20 por hora POR USUÁRIO.
 *
 * Este é o único endpoint do produto que chama uma API PAGA (Claude
 * Vision). Sem teto, um cuidador autenticado — ou um token roubado —
 * esgota o crédito da conta inteira, que é o cenário do OWASP LLM10
 * (Unbounded Consumption). 20/hora é folgado pra quem está cadastrando os
 * remédios de uma família e apertado pra quem está torrando crédito.
 *
 * A chave é o userId (não o IP): o custo é por chamada, não por origem, e
 * uma família atrás do mesmo IP não deve dividir cota.
 */
export const photoExtractionLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 20 * M,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: (req) => {
    const auth = (req as { user?: { userId?: number } }).user;
    return `photo-extract:${auth?.userId ?? clientIp(req)}`;
  },
  message: { error: "Muitas fotos seguidas. Aguarde alguns minutos e tente de novo." },
});

/**
 * Painel operacional: 5 tentativas por 15 min por IP.
 *
 * O /admin é protegido por uma senha compartilhada única — sem limite,
 * era brute force direto contra a operação inteira do produto.
 */
export const adminLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5 * M,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: (req) => `admin-login:${clientIp(req)}`,
  message: { error: "Muitas tentativas. Aguarde antes de tentar novamente." },
});

/**
 * Rotas públicas que consomem um token de uso único (ativação de acesso do
 * paciente, aceite de convite, verificação de e-mail, confirmação de reset,
 * download de export, relatório do médico, troca de code do OAuth).
 *
 * Os tokens são 32 bytes aleatórios, então adivinhar por força bruta é
 * inviável — isto é defesa em profundidade e, principalmente, evita que
 * essas rotas virem amplificador de carga contra o banco.
 */
export const publicTokenLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30 * M,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: (req) => `public-token:${clientIp(req)}`,
  message: { error: "Muitas tentativas. Aguarde alguns minutos." },
});

/**
 * Renovação de sessão: 60 por 15 min por IP.
 *
 * Precisa ser generoso — o cliente renova sozinho a cada 15 min e várias
 * abas podem renovar juntas —, mas não ilimitado: `/auth/refresh` faz
 * consulta e escrita no banco a cada chamada.
 */
export const refreshLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60 * M,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: (req) => `refresh:${clientIp(req)}`,
  message: { error: "Muitas renovações de sessão. Aguarde alguns instantes." },
});

/**
 * Envio de mídia (QUI-5): 30 arquivos por hora, por usuário.
 *
 * A chave é o userId, não o IP — mesmo raciocínio do photoExtractionLimiter:
 * o custo é por arquivo guardado, e uma família atrás do mesmo IP não deve
 * dividir cota. 30/hora é folgado para quem está publicando o dia do
 * paciente e apertado para quem quer usar o bucket como hospedagem.
 */
export const mediaUploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 30 * M,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: (req) => {
    const auth = (req as { user?: { userId?: number } }).user;
    return `media-upload:${auth?.userId ?? clientIp(req)}`;
  },
  message: { error: "Muitos envios seguidos. Aguarde alguns minutos e tente de novo." },
});

/**
 * Leitura de mídia pelo link assinado: 300 por 15 min por IP.
 *
 * Bem mais generoso que o publicTokenLimiter (30/15min) de propósito: um
 * mural com 20 fotos são 20 leituras de uma vez, e várias pessoas da mesma
 * família costumam estar atrás do mesmo IP. Com 30 o app quebraria abrindo
 * a tela duas vezes.
 *
 * Continua existindo porque a rota não tem sessão — quem tem o link entra —
 * e sem teto ela viraria amplificador de banda contra o bucket.
 */
export const mediaContentLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300 * M,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: (req) => `media-content:${clientIp(req)}`,
  message: { error: "Muitas leituras seguidas. Aguarde alguns instantes." },
});
