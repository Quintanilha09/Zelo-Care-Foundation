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
 * Este arquivo é esse processo. Ele imprime uma palavra só, e quem o chama é
 * `midia-no-s3.test.ts`.
 *
 * Não é `.test.ts` de propósito: não tem casos, e o guardrail do `test:all`
 * só cobre arquivos de teste de verdade.
 */
import { obterArmazenamento } from "../lib/media-storage.ts";

const armazenamento = obterArmazenamento();
process.stdout.write(armazenamento === null ? "NULO" : "CAIU_PARA_ALGUMA_COISA");
