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

/**
 * Segredo do painel operacional.
 *
 * FALHA FECHADA se ele for IGUAL ao SESSION_SECRET. Os dois assinam mundos
 * diferentes: um abre o painel operacional, o outro abre a sessão de um
 * cuidador. A separação entre eles não é uma checagem que alguém possa
 * esquecer — é a própria criptografia, e só vale enquanto as chaves diferem.
 *
 * Se forem iguais, um token de admin passa por verifyAccessToken como se fosse
 * sessão de cuidador. O payload de admin não tem userId, então a requisição
 * segue com `userId: undefined` — e o que o chamador vê é um 404 confuso, não
 * o 401 que deveria acontecer.
 *
 * Encontrado em 23/08/2026: o workflow de CI definia as duas variáveis com o
 * MESMO valor, e o teste que protege essa fronteira falhou com 404 em vez de
 * 401 — exatamente o sintoma de o token ter sido aceito.
 */
function getAdminSecret(): string | null {
  const secret = process.env.ADMIN_PANEL_SECRET;
  if (!secret || secret.length === 0) return null;

  if (secret === process.env.SESSION_SECRET) {
    console.error(
      "[SEGURANCA] ADMIN_PANEL_SECRET e igual ao SESSION_SECRET. " +
        "Isso funde o painel operacional e a sessao de cuidador num unico dominio de confianca. " +
        "O painel fica DESABILITADO ate que os dois valores sejam diferentes."
    );
    return null;
  }

  return secret;
}

/**
 * Por que o painel esta indisponivel, ou `null` quando esta tudo certo.
 *
 * Existe porque `verifyAdminPassword` devolvia `false` em TRES situacoes
 * diferentes — senha errada, Secret ausente, e Secret colidindo com o
 * SESSION_SECRET — e a rota respondia "Senha incorreta" para as tres.
 *
 * O caso da colisao e o mais cruel: o painel esta fazendo exatamente o que
 * deve (se desabilitando por seguranca), e a unica pista disso ia para o log
 * do servidor, que ninguem esta olhando enquanto tenta entrar.
 *
 * O texto NUNCA revela valor de Secret — so diz o que esta errado e o que
 * fazer. Mesmo padrao de /auth/email/status e /config/maps: capacidade que
 * pode faltar e declarada, nao suposta.
 */
export function motivoDoPainelIndisponivel(): string | null {
  const secret = process.env.ADMIN_PANEL_SECRET;

  if (!secret || secret.length === 0) {
    return "O painel operacional nao esta configurado neste ambiente: falta o Secret ADMIN_PANEL_SECRET.";
  }

  if (secret === process.env.SESSION_SECRET) {
    return (
      "O painel esta desabilitado por seguranca: ADMIN_PANEL_SECRET e SESSION_SECRET estao com o MESMO valor, " +
      "e isso fundiria o painel operacional com a sessao de cuidador num unico dominio de confianca. " +
      "Gere um valor novo e diferente para o ADMIN_PANEL_SECRET e reinicie o servidor."
    );
  }

  return null;
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
