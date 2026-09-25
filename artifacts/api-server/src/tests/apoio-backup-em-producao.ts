/**
 * Chama `fazerCopiaDeSeguranca()` num processo que o código enxerga como
 * PRODUÇÃO, e sem configuração de backup — Issue #199.
 *
 * ── Por que um processo separado ──────────────────────────────────────────
 *
 * `IS_PRODUCTION` é calculado no import, a partir de `NODE_ENV` e de
 * `NODE_TEST_CONTEXT` — e essa segunda existe em TODO processo iniciado por
 * `node --test`. Dentro da suíte, portanto, `IS_PRODUCTION` é sempre falso,
 * por desenho e com razão.
 *
 * A garantia mais importante deste módulo — **produção sem chave pública
 * RECUSA copiar, em vez de gravar o banco em claro** — só pode ser provada
 * num processo em que `NODE_TEST_CONTEXT` não exista.
 *
 * Imprime uma linha marcada, e quem o chama é `copia-de-seguranca.test.ts`.
 *
 * Não é `.test.ts` de propósito: não tem casos, e o guardrail do `test:all`
 * só cobre arquivos de teste de verdade.
 */
import { fazerCopiaDeSeguranca } from "../lib/backup.ts";

let lancou = false;
let mensagem = "";

try {
  await fazerCopiaDeSeguranca();
} catch (e) {
  lancou = true;
  mensagem = e instanceof Error ? e.message : String(e);
}

// O marcador existe porque o logger (pino) escreve no MESMO stdout, de forma
// assíncrona. Procurar "a última linha" pega saída dele — foi o defeito da
// #209, e este arquivo já nasce com a lição aplicada.
process.stdout.write(`\nZELO_RESULTADO:${JSON.stringify({ lancou, mensagem })}\n`);

process.exit(0);
