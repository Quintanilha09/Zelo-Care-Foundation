/**
 * O nome de quem cuida — Issue #78.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * CRIAR O NOME NÃO NORMALIZAVA. EDITAR NORMALIZAVA. QUEM SE CADASTRASSE COM
 * ESPAÇO SOBRANDO CARREGAVA ISSO ATÉ EDITAR O PERFIL.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Medido em 02/09/2026: a família 425 estava gravada como
 * `'Família de Gabriel Quintanilha '` — com espaço no fim, vindo cru do
 * formulário de cadastro.
 *
 * | Rota | Tratava o nome? |
 * |---|---|
 * | `POST /auth/register` | **não** — `z.string().min(2).max(100)`, cru |
 * | `PATCH /account/me` | **sim** — `.trim().replace(/\s+/g, " ")` |
 *
 * Duas cópias da mesma regra, uma delas ausente. Este arquivo existe para que
 * não haja mais duas: as duas rotas passam a usar **o mesmo schema**, e o nome
 * sai delas já normalizado. Uma divergência futura teria que ser escrita de
 * propósito.
 *
 * ── Isto NÃO é `nome-de-paciente.ts` ──────────────────────────────────────
 *
 * Aquele arquivo exige pelo menos duas palavras e restringe os caracteres,
 * porque nome de paciente vai em ficha e em relatório de aderência. Aqui é o
 * nome de quem usa o app, e **cuidador pode se chamar só "Ana"**. Aplicar a
 * regra de paciente aqui recusaria gente de verdade no cadastro.
 */

import { z } from "zod";

export const NOME_MIN = 2;
export const NOME_MAX = 100;

/** Uma frase só, igual nas duas rotas. Ver `lib/erro-de-validacao.ts`. */
export const MENSAGEM_DE_NOME = `O nome precisa ter entre ${NOME_MIN} e ${NOME_MAX} caracteres.`;

/**
 * Tira o que sobra nas pontas e colapsa espaço repetido no meio.
 *
 * `"  Ana   Maria  "` vira `"Ana Maria"`. Não mexe em acento, maiúscula nem
 * hífen: normalizar isso seria corrigir o nome da pessoa, e o nome é dela.
 */
export function normalizarNome(bruto: string): string {
  return bruto.trim().replace(/\s+/g, " ");
}

/**
 * O nome, já limpo, ou um erro com a frase acima.
 *
 * ── Por que a checagem do mínimo acontece duas vezes ──────────────────────
 *
 * `min(NOME_MIN)` roda antes do `transform`, sobre o texto cru; o `refine`
 * roda depois, sobre o já normalizado. Sem o segundo, `"  a  "` passaria: são
 * cinco caracteres antes de limpar e um depois. É exatamente o que
 * `PATCH /account/me` já fazia à mão, e o motivo de fazer à mão era não haver
 * onde escrever isto uma vez só.
 */
export const nomeDePessoa = z
  .string({ required_error: MENSAGEM_DE_NOME, invalid_type_error: MENSAGEM_DE_NOME })
  .min(NOME_MIN, { message: MENSAGEM_DE_NOME })
  .max(NOME_MAX, { message: MENSAGEM_DE_NOME })
  .transform(normalizarNome)
  .refine((nome) => nome.length >= NOME_MIN, { message: MENSAGEM_DE_NOME });
