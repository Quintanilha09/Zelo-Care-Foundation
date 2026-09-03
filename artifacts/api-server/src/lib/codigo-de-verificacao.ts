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
 * Códigos que uma CONTA pode receber por hora — Issue #75.
 *
 * Por conta, e não só por IP, porque botnet troca de IP e não troca de conta.
 * É este teto que impede o reenvio de virar máquina de tentativas: sem ele,
 * cada pedido devolveria mais cinco palpites, sem fim.
 *
 *   5 códigos × 5 tentativas = 25 palpites por hora em 1.000.000
 *   → ~20.000 horas (mais de dois anos) para chegar a 50% numa conta só
 *
 * Enquanto o reenvio não existia, o sistema tinha UM código por conta, para
 * sempre — 1 chance em 200.000. Aquela robustez era acidental, vinda da falta
 * desta rota. Este número é o que a substitui de propósito.
 */
export const MAX_CODIGOS_POR_HORA = 5;

/**
 * Tempo mínimo de resposta das rotas de código — Issue #84.
 *
 * **O problema.** A confirmação responde a mesma coisa para código errado,
 * expirado, esgotado e conta inexistente. O conteúdo é idêntico; o **tempo**
 * não era: conta inexistente saía depois de uma consulta, conta existente fazia
 * duas, mais hash, mais às vezes um `UPDATE`. Quem cronometrasse distinguia os
 * dois — e descobria quais e-mails têm conta no ZELO, que é exatamente o que a
 * resposta genérica existe para esconder.
 *
 * **Por que piso e não "igualar as consultas".** Igualar cobre a leitura e não
 * cobre a escrita: o `UPDATE` do contador de tentativas só acontece num dos
 * caminhos. O piso mascara tudo o que estiver abaixo dele, inclusive isso.
 *
 * **Isto é mitigação, não tempo constante.** Tempo constante de verdade contra
 * um banco de dados não existe: uma consulta lenta por contenção estoura
 * qualquer piso. O que o piso faz é tirar do atacante o sinal barato — e o
 * caro, ele já não tem, porque o `publicTokenLimiter` corta a coleta.
 *
 * 250 ms: acima de qualquer caminho normal desta rota, e imperceptível numa
 * ação que a pessoa faz uma vez na vida.
 */
export const PISO_DE_RESPOSTA_MS = 250;

/**
 * Marca o início, para o piso de tempo. `performance.now()` de propósito:
 * é monotônico, então ajuste de relógio não produz duração negativa. Também
 * não é leitura de relógio de parede, então não conflita com a regra do
 * `lint:clock` — isto mede duração, não decide "que horas são".
 */
export function inicioDaMedicao(): number {
  return performance.now();
}

/** Segura a resposta até `PISO_DE_RESPOSTA_MS` desde `inicio`. */
export async function esperarAtePiso(inicio: number): Promise<void> {
  const falta = PISO_DE_RESPOSTA_MS - (performance.now() - inicio);
  if (falta > 0) await new Promise((r) => setTimeout(r, falta));
}

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
