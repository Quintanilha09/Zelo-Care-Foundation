/**
 * Runner de testes — ZELO
 *
 * Executa os testes com Node.js test runner nativo (node:test).
 * Não requer instalação adicional — disponível no Node 18+.
 *
 * Uso:
 *   # Todos os testes (sem banco):
 *   pnpm --filter @workspace/api-server run test
 *
 *   # Incluindo testes de integridade do banco:
 *   DATABASE_URL=<url> pnpm --filter @workspace/api-server run test:all
 *
 * Os testes clock e safe-logger não precisam de banco.
 * O teste integrity precisa de DATABASE_URL.
 */

// Este arquivo é apenas documentação do runner.
// Os testes são descobertos automaticamente pelo node --test.
export {};
