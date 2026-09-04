/**
 * A mensagem de validação que chega na tela — Issue #88.
 *
 * ── O defeito que isto conserta ───────────────────────────────────────────
 *
 * As rotas respondiam `{ error: body.error.message }`. Em zod 3,
 * `ZodError.message` **não é uma frase**: é o array de issues serializado em
 * JSON. O que a pessoa via na tela era isto:
 *
 * ```
 * [ { "code": "custom", "message": "Escreva o nome e ao menos um sobrenome.",
 *     "path": [] } ]
 * ```
 *
 * A frase certa estava lá dentro o tempo todo, envelopada em colchete e aspas.
 *
 * ── Por que passou despercebido ───────────────────────────────────────────
 *
 * A Issue #56 escreveu mensagens específicas de propósito, e deixou um teste
 * afirmando que elas nunca são genéricas. Só que o teste lê
 * `error.issues[0].message` — a frase — enquanto a rota mandava
 * `error.message` — o JSON. **O teste media uma propriedade que o caminho de
 * produção não tinha.**
 *
 * É a mesma classe de defeito do limitador de mídia (Issue #90) e do comentário
 * do canvas (Issue #53): o texto afirmava uma coisa, o código fazia outra, e
 * nada cruzava os dois.
 */

import type { ZodError } from "zod";

/**
 * A primeira mensagem legível de um erro de validação.
 *
 * Primeira e não todas: um formulário mostra um alerta, e empilhar quatro
 * frases nele faz a pessoa não ler nenhuma. O `superRefine` dos schemas deste
 * projeto já retorna cedo justamente para que a primeira seja a que importa.
 */
export function mensagemDeValidacao(erro: ZodError): string {
  return erro.issues[0]?.message ?? "Não conseguimos validar os dados enviados.";
}
