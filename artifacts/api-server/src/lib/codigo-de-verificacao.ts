/**
 * Código de verificação de 6 dígitos — ZELO, Issue #77.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * SEIS DÍGITOS SÃO UM MILHÃO DE COMBINAÇÕES. O TOKEN QUE ISTO SUBSTITUI TINHA
 * 2^256. A TROCA SÓ NÃO É UM REBAIXAMENTO POR CAUSA DO LIMITE DE TENTATIVAS.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * O fundador pediu o código em 02/09/2026 — "assim como o GitHub" — e está
 * certo em pedir: digitar 6 dígitos na mesma tela é muito melhor, para uma
 * família com idoso, do que caçar um link no e-mail e trocar de aparelho no
 * meio do caminho. Mas a conta de segurança precisa estar escrita, porque quem
 * mexer nisto depois vai ter a tentação de "simplificar".
 *
 * ── A conta ───────────────────────────────────────────────────────────────
 *
 *   1.000.000 combinações
 *   ÷ 5 tentativas por código        → 1 chance em 200.000 por código emitido
 *
 * Um milhão de tentativas leva minutos para uma máquina. Cinco tentativas
 * levam a lugar nenhum. **A defesa é o contador, não o tamanho do código.**
 *
 * Por isso o limite de EMISSÃO importa tanto quanto o de tentativa: quem puder
 * pedir código à vontade ganha 5 chances por pedido, e ~100.000 pedidos chegam
 * a 50%. O teto de emissão é responsabilidade de quem chama (rate limit por
 * conta, não só por IP — botnet troca de IP, não troca de conta).
 *
 * ── Por que o hash leva o userId como sal ─────────────────────────────────
 *
 * Não é para dificultar força bruta offline: com um milhão de possibilidades,
 * quem tiver o hash quebra em segundos, sal ou não. **É para separar usuários.**
 * Sem o sal, dois usuários com o mesmo código teriam o mesmo hash — e a
 * verificação de um casaria com a linha do outro. O sal é correção, não
 * ofuscação.
 */

import { randomInt, createHash, timingSafeEqual } from "node:crypto";

/** Seis, como GitHub, Google e banco. Menos é fraco; mais, ninguém decora. */
export const DIGITOS = 6;

/**
 * Dez minutos. O link antigo valia 24 horas — prazo impensável aqui: cada
 * minuto a mais é mais tempo de janela para adivinhar um número de seis dígitos.
 */
export const VALIDADE_MINUTOS = 10;

/** Erros permitidos antes de o código morrer. Ver a conta no cabeçalho. */
export const MAX_TENTATIVAS = 5;

/**
 * Sorteia o código.
 *
 * `randomInt` do módulo `crypto`, nunca `Math.random()`: o segundo é previsível
 * a partir de algumas saídas observadas, e isto aqui é credencial.
 *
 * `padStart` porque 42 precisa virar "000042" — sem ele, um em cada dez códigos
 * teria menos de seis dígitos e um espaço de busca menor.
 */
export function gerarCodigo(): string {
  return String(randomInt(0, 10 ** DIGITOS)).padStart(DIGITOS, "0");
}

/**
 * Hash do código, preso ao usuário. Ver o cabeçalho para o porquê do sal.
 */
export function hashDoCodigo(userId: number, codigo: string): string {
  return createHash("sha256").update(`${userId}:${codigo}`).digest("hex");
}

/**
 * Compara dois hashes em tempo constante.
 *
 * O ganho é pequeno — os dois lados são hashes hex de tamanho fixo, e um
 * atacante não controla o que está gravado — mas comparar segredo com `===` é
 * o tipo de hábito que um dia é copiado para um lugar onde importa.
 */
export function conferirHash(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/** Aceita "123456", "123 456", "123-456". Rejeita o resto. */
export function normalizarCodigo(bruto: unknown): string | null {
  if (typeof bruto !== "string") return null;
  const so = bruto.replace(/[\s-]/g, "");
  return new RegExp(`^\\d{${DIGITOS}}$`).test(so) ? so : null;
}

/** Quando o código emitido agora deixa de valer. */
export function expiraEm(agora: Date): Date {
  return new Date(agora.getTime() + VALIDADE_MINUTOS * 60 * 1000);
}
