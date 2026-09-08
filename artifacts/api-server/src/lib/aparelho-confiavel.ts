/**
 * Aparelho confiável — Issue #79.
 *
 * O token que diz "este navegador já provou ser desta pessoa". Ele não abre
 * sessão nenhuma: só decide se o login pede, ou não pede, o código de 6
 * dígitos. A senha continua obrigatória em toda entrada.
 */

import { and, eq, gt } from "drizzle-orm";
import { db, trustedDevicesTable } from "@workspace/db";

import { generateOneTimeToken, hashToken } from "./tokens.ts";
import { Clock } from "./clock.ts";

/**
 * Quantos dias um aparelho continua confiável — e por que 30, e não 90.
 *
 * ── O fundador aprovou 90, e pediu para eu conferir se era o comum ────────
 *
 * Não era. Pesquisado em 03/09/2026:
 *
 * | Serviço | Duração |
 * |---|---|
 * | Google, GitHub e a maioria | **30 dias** |
 * | LastPass | 30 dias, com expiração explícita |
 * | Microsoft 365 | configurável, até 90 |
 *
 * Trinta é o padrão da indústria; noventa é o teto de quem deixa configurar.
 *
 * ── Por que a renovação faz os dois números empatarem ─────────────────────
 *
 * O prazo **reinicia a cada entrada** (`last_used_at`). Para quem abre o app
 * com qualquer regularidade — o cuidador principal, o contratado — 30 e 90 são
 * igualmente invisíveis, porque o relógio nunca chega perto do fim.
 *
 * A diferença só aparece para quem some por mais de um mês: o parente distante
 * no papel `observer`. Pedir código a essa pessoa depois de um mês fora é
 * razoável — e é exatamente quando um segundo fator vale mais.
 *
 * ── Isto é uma linha só ───────────────────────────────────────────────────
 *
 * Se o fundador preferir 90 mesmo assim, é trocar este número. Fica registrado
 * que 90 é mais frouxo que o padrão, e que a escolha foi informada.
 */
export const DIAS_DE_CONFIANCA = 30;

/** Até quando um aparelho registrado (ou usado) agora continua valendo. */
export function confiancaExpiraEm(agora: Date): Date {
  return new Date(agora.getTime() + DIAS_DE_CONFIANCA * 24 * 60 * 60 * 1000);
}

/**
 * Gera o token do aparelho: 256 bits, como todo token opaco deste projeto.
 *
 * Seis dígitos bastam para o código do e-mail porque ele morre em 10 minutos e
 * tem contador de tentativas. Este vale 30 dias e não tem contador nenhum —
 * então precisa de entropia de verdade.
 */
export function gerarTokenDeAparelho(): { raw: string; hash: string } {
  return generateOneTimeToken();
}

/** O hash guardado no banco, a partir do token que o navegador mandou. */
export function hashDoAparelho(raw: string): string {
  return hashToken(raw);
}

// ── O rótulo ──────────────────────────────────────────────────────────────
//
// "Chrome no Windows" existe para a pessoa reconhecer a linha na lista de
// aparelhos e saber qual desligar. **Ele nunca decide se um aparelho vale** —
// quem decide é o token. Essa separação é o que permite ler o user agent, que
// mente com frequência, sem que a mentira custe segurança: o pior caso de um
// rótulo errado é uma linha confusa na tela, não um estranho entrando.

const NAVEGADORES: Array<[RegExp, string]> = [
  // Ordem importa: Edge e Opera se declaram Chrome, e Chrome se declara
  // Safari. Quem casa primeiro ganha, então o mais específico vem antes.
  [/\bEdgA?\//, "Edge"],
  [/\bOPR\/|\bOpera\//, "Opera"],
  [/\bSamsungBrowser\//, "Samsung Internet"],
  [/\bFirefox\/|\bFxiOS\//, "Firefox"],
  [/\bCriOS\//, "Chrome"],
  [/\bChrome\//, "Chrome"],
  [/\bSafari\//, "Safari"],
];

const SISTEMAS: Array<[RegExp, string]> = [
  // "Android" antes de "Linux" pelo mesmo motivo: todo Android é Linux.
  [/\bAndroid\b/, "Android"],
  [/\biPhone\b/, "iPhone"],
  [/\biPad\b/, "iPad"],
  [/\bWindows\b/, "Windows"],
  [/\bMac OS X\b|\bMacintosh\b/, "Mac"],
  [/\bLinux\b/, "Linux"],
];

/**
 * "Chrome no Windows", "Safari no iPhone", "Aparelho desconhecido".
 *
 * User agent vazio, esquisito ou de robô cai no genérico em vez de virar um
 * rótulo inventado — a pessoa reconhece melhor um "desconhecido" honesto do
 * que um palpite errado com cara de certeza.
 */
export function rotuloDoAparelho(userAgent: string | null | undefined): string {
  const ua = typeof userAgent === "string" ? userAgent : "";
  const navegador = NAVEGADORES.find(([re]) => re.test(ua))?.[1];
  const sistema = SISTEMAS.find(([re]) => re.test(ua))?.[1];

  if (navegador && sistema) return `${navegador} no ${sistema}`;
  if (navegador) return navegador;
  if (sistema) return sistema;
  return "Aparelho desconhecido";
}

// ── As três operações sobre a tabela ────────────────────────────────────
//
// Elas moram aqui, e não na rota de login, porque `trusted_devices` precisa
// ter um dono só: a tela de Ajustes registra aparelho ao ativar o segundo
// fator, o login registra ao confirmar o código, e os dois têm que gravar a
// mesma coisa. Duas cópias divergem — uma esquece o rótulo, a outra o prazo.

/**
 * Este token de aparelho é deste usuário, e ainda vale?
 *
 * A consulta pergunta as duas coisas de uma vez — o dono E o hash. Procurar
 * só pelo hash e conferir o dono depois é como um token válido de outra conta
 * entra por uma refatoração distraída.
 */
export async function aparelhoConhecido(
  userId: number,
  raw: string | undefined,
): Promise<number | null> {
  if (typeof raw !== "string" || raw.length === 0) return null;

  const [aparelho] = await db
    .select({ id: trustedDevicesTable.id })
    .from(trustedDevicesTable)
    .where(
      and(
        eq(trustedDevicesTable.userId, userId),
        eq(trustedDevicesTable.tokenHash, hashDoAparelho(raw)),
        eq(trustedDevicesTable.revoked, false),
        gt(trustedDevicesTable.expiresAt, Clock.now()),
      ),
    )
    .limit(1);

  return aparelho?.id ?? null;
}

/** Reinicia os 30 dias. Sem isto, o prazo vira uma data de despejo. */
export async function renovarAparelho(id: number): Promise<void> {
  const agora = Clock.now();
  await db
    .update(trustedDevicesTable)
    .set({ lastUsedAt: agora, expiresAt: confiancaExpiraEm(agora) })
    .where(eq(trustedDevicesTable.id, id));
}

/**
 * Registra o aparelho e devolve o token cru.
 *
 * O cru só existe em dois lugares: nesta linha de retorno e no navegador da
 * pessoa. O banco fica com o hash, como todo token deste projeto.
 */
export async function registrarAparelho(
  userId: number,
  userAgent: string | null,
  ip: string | null,
): Promise<string> {
  const { raw, hash } = gerarTokenDeAparelho();
  const agora = Clock.now();

  await db.insert(trustedDevicesTable).values({
    userId,
    tokenHash: hash,
    label: rotuloDoAparelho(userAgent),
    createdIp: ip,
    lastUsedAt: agora,
    expiresAt: confiancaExpiraEm(agora),
  });

  return raw;
}
