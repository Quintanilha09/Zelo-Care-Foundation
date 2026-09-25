/**
 * Como o histórico se refere a quem saiu da família — Issue #213.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O REGISTRO É DO PACIENTE, NÃO DE QUEM DIGITOU.
 *
 * Desde a #213, apagar um cuidador coloca `null` em `dose_records.caregiver_id`
 * em vez de barrar a operação — *perde-se o nome, nunca a dose*, que é a mesma
 * decisão que `correctedByCaregiverId` já tomava e o invariante 1 do produto
 * exige.
 *
 * Mas "perde-se o nome" não pode virar "some a linha". Sem este cuidado, dois
 * defeitos aparecem calados:
 *
 *   1. `innerJoin` com `caregivers` DERRUBA a dose do resultado. Num relatório
 *      de adesão, isso faz a adesão parecer MENOR do que foi — o produto
 *      mentiria sobre o cuidado que a família teve.
 *   2. O nome chega `null` na tela, e vira "undefined" ou um espaço vazio.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * O rótulo é neutro de propósito. Ele descreve um fato administrativo — a
 * pessoa não está mais na família — e não insinua nada sobre ela.
 */
import { sql, type SQL } from "drizzle-orm";
import type { AnyColumn } from "drizzle-orm";

export const CUIDADOR_REMOVIDO = "Cuidador removido";

/**
 * O nome de quem registrou, com o rótulo no lugar do vazio.
 *
 * ── Por que são DOIS argumentos ───────────────────────────────────────────
 *
 * Um `coalesce` simples estaria errado, e de um jeito que assusta quem olha a
 * tela: nas consultas que partem da dose AGENDADA, o nome vem nulo também
 * quando **não há registro nenhum** — a dose ainda não foi tomada. Trocar esse
 * nulo por "Cuidador removido" faria uma dose pendente parecer registrada por
 * alguém que saiu.
 *
 * `provaDeRegistro` é uma coluna do próprio `dose_records` (o `id`, por
 * exemplo). Ela distingue os dois nulos:
 *
 *   sem registro             → nulo, e continua nulo
 *   registro sem cuidador    → o rótulo
 *
 * ── Quando OMITIR o segundo argumento ────────────────────────────────────
 *
 * Quando a consulta parte de `dose_records`, o registro sempre existe e não há
 * o que distinguir: omita.
 *
 * E há um caso em que passá-lo QUEBRA: consulta com `GROUP BY`. Referenciar
 * `dose_records.id` dentro do `case` obriga essa coluna a estar no agrupamento,
 * e agrupar por id desfaz a agregação. O Postgres recusa com
 * *"column must appear in the GROUP BY clause"* — 8 testes do calendário de
 * adesão reprovaram assim em 24/09/2026.
 *
 * Use sempre junto de `leftJoin`. Com `innerJoin` esta função nem é alcançada:
 * a linha já foi descartada antes.
 */
export function nomeDeQuemRegistrou(
  nomeDoCuidador: AnyColumn,
  provaDeRegistro?: AnyColumn,
): SQL<string | null> {
  if (!provaDeRegistro) {
    return sql<string | null>`coalesce(${nomeDoCuidador}, ${CUIDADOR_REMOVIDO})`;
  }
  return sql<string | null>`case when ${provaDeRegistro} is null then null else coalesce(${nomeDoCuidador}, ${CUIDADOR_REMOVIDO}) end`;
}
