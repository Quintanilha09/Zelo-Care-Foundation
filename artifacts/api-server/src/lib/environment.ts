/**
 * Detecção de ambiente — ZELO.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * REGRA: NA DÚVIDA, É PRODUÇÃO.
 *
 * Todo o código de segurança deste projeto costumava perguntar
 * `process.env.NODE_ENV !== "production"` pra decidir se afrouxava alguma
 * proteção. O problema é que `undefined !== "production"` é VERDADEIRO —
 * então um ambiente que simplesmente não define a variável (exatamente o
 * caso do deploy no Replit, descoberto na auditoria de 21/08/2026) rodava
 * com TODAS as proteções afrouxadas:
 *
 *   - rotas de manipulação do relógio expostas, sem autenticação
 *   - verificação de e-mail pulada no cadastro
 *   - token de verificação e link de reset de senha escritos no log
 *   - rate limit de login 10× mais frouxo
 *   - mensagem de erro interna devolvida ao cliente
 *
 * Ou seja: esquecer de configurar uma variável abria o app inteiro. A
 * correção não é lembrar de configurá-la — é fazer o esquecimento levar ao
 * estado SEGURO. Aqui, só um valor explícito de "development" ou "test"
 * libera comportamento de desenvolvimento; qualquer outra coisa (inclusive
 * ausência) é tratada como produção.
 * ═══════════════════════════════════════════════════════════════════════
 */

const raw = process.env.NODE_ENV?.trim().toLowerCase();

/** True só quando explicitamente marcado como desenvolvimento. */
export const IS_DEVELOPMENT = raw === "development";

/**
 * Teste automatizado.
 *
 * Aceita `NODE_ENV=test` e também detecta o test runner do próprio Node,
 * que define `NODE_TEST_CONTEXT` no processo de cada arquivo de teste.
 * Isso evita depender de `NODE_ENV=cmd` no script — sintaxe que o shell do
 * Windows não entende — e evita trazer uma dependência (`cross-env`) só
 * pra exportar uma variável.
 *
 * Note que isto NÃO afrouxa produção: `NODE_TEST_CONTEXT` só existe dentro
 * de um processo iniciado por `node --test`. Um servidor publicado nunca
 * roda assim.
 */
export const IS_TEST = raw === "test" || process.env.NODE_TEST_CONTEXT !== undefined;

/**
 * Produção é o padrão. Vale quando NODE_ENV é "production" — e também
 * quando não está definido, está vazio ou tem valor desconhecido.
 */
export const IS_PRODUCTION = !IS_DEVELOPMENT && !IS_TEST;

/**
 * "Pode afrouxar proteção pra facilitar o trabalho local?"
 *
 * Use esta função — nunca `NODE_ENV !== "production"` direto — pra
 * decidir sobre: montar rotas de diagnóstico, pular verificação, imprimir
 * segredo em log, ou relaxar limite de taxa.
 */
export function allowsDevelopmentShortcuts(): boolean {
  return IS_DEVELOPMENT || IS_TEST;
}
