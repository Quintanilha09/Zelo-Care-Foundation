/**
 * Sobe o app com o banco INALCANÇÁVEL e mede as duas rotas de saúde.
 *
 * ── Por que um processo separado ──────────────────────────────────────────
 *
 * A conexão com o banco é decidida no import de `@workspace/db`, a partir de
 * `DATABASE_URL`. Para simular banco fora do ar é preciso um processo cuja
 * variável aponte para lugar nenhum — e derrubar o Postgres da suíte não
 * serve, porque os outros arquivos de teste rodam no mesmo banco.
 *
 * Imprime uma linha de JSON, e quem o chama é `saude-rasa-e-profunda.test.ts`.
 *
 * Não é `.test.ts` de propósito: não tem casos, e o guardrail do `test:all`
 * só cobre arquivos de teste de verdade.
 */
import http from "node:http";
import app from "../app.ts";

const servidor = http.createServer(app);

await new Promise<void>((resolve) => {
  servidor.listen(0, "127.0.0.1", resolve);
});
const porta = (servidor.address() as { port: number }).port;

function pedir(rota: string): Promise<{ status: number; corpo: unknown }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { hostname: "127.0.0.1", port: porta, path: rota, method: "GET" },
      (res) => {
        let dados = "";
        res.on("data", (c: Buffer) => (dados += c.toString()));
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode ?? 0, corpo: JSON.parse(dados) });
          } catch {
            resolve({ status: res.statusCode ?? 0, corpo: dados });
          }
        });
      },
    );
    req.on("error", reject);
    req.end();
  });
}

const vivo = await pedir("/api/healthz");
const pronto = await pedir("/api/readyz");

// O prefixo existe porque o logger escreve no MESMO stdout, em várias linhas
// e às vezes coloridas. Procurar "a última linha" pegava saída do pino; um
// marcador torna a extração à prova de qualquer ruído.
process.stdout.write(
  `\nZELO_RESULTADO:${JSON.stringify({
    healthzStatus: vivo.status,
    healthzCorpo: vivo.corpo,
    readyzStatus: pronto.status,
    readyzCorpo: pronto.corpo,
  })}\n`,
);

servidor.close();
// O pg-boss não foi iniciado aqui (isto importa `app.ts`, não `index.ts`),
// mas o pool do `pg` pode manter o processo vivo tentando reconectar.
process.exit(0);
