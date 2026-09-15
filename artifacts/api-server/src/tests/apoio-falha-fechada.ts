/**
 * Roda `obterArmazenamento()` num processo que o código enxerga como PRODUÇÃO.
 *
 * ── Por que um arquivo separado ───────────────────────────────────────────
 *
 * `IS_PRODUCTION` é calculado no momento do import, a partir de `NODE_ENV` e
 * de `NODE_TEST_CONTEXT` — e essa segunda variável existe em TODO processo
 * iniciado por `node --test`. Dentro da suíte, portanto, `IS_PRODUCTION` é
 * sempre falso, por desenho e com razão.
 *
 * A consequência é que a garantia mais importante deste módulo — **produção
 * sem bucket devolve `null` em vez de cair para memória** — não pode ser
 * provada de dentro de um teste comum. Ela precisa de um processo em que
 * `NODE_TEST_CONTEXT` não exista.
 *
 * Este arquivo é esse processo. Ele imprime uma linha marcada, e quem o chama
 * é `midia-no-s3.test.ts`.
 *
 * Não é `.test.ts` de propósito: não tem casos, e o guardrail do `test:all`
 * só cobre arquivos de teste de verdade.
 *
 * ── Por que a linha é marcada, e por que tem quebra de linha dos dois lados ─
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * A PRIMEIRA VERSÃO ESCREVIA SÓ `NULO`, SEM QUEBRA DE LINHA, E O TESTE
 * COMPARAVA COM O FIM DA SAÍDA. ISSO REPROVOU NO CI EM 15/09/2026.
 *
 * `obterArmazenamento()` emite um aviso de segurança pelo pino ANTES deste
 * `write`, e o pino descarrega de forma assíncrona. Na minha máquina o log
 * saía primeiro; no runner do GitHub saiu depois, grudado:
 *
 *     NULO{"level":50,"action":"media_storage_unconfigured",...}
 *
 * O `endsWith("NULO")` virou falso e a suíte reprovou — sem defeito nenhum no
 * código sendo testado. Era uma corrida entre dois escritores do mesmo stdout.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * O marcador com quebra de linha dos dois lados torna a extração imune à
 * ordem: quem lê procura A LINHA que contém `ZELO_RESULTADO:`, em vez de
 * apostar em qual escritor chegou por último. É a mesma solução que
 * `apoio-banco-fora.ts` já usa, pelo mesmo motivo.
 */
import { obterArmazenamento } from "../lib/media-storage.ts";

const armazenamento = obterArmazenamento();
process.stdout.write(
  `\nZELO_RESULTADO:${armazenamento === null ? "NULO" : "CAIU_PARA_ALGUMA_COISA"}\n`,
);
