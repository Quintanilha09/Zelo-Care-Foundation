/**
 * As duas perguntas de saúde — Issue #196.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O DEFEITO QUE ISTO CONSERTA SÓ APARECE COM O BANCO FORA DO AR.
 *
 * Antes existia só `/healthz`, e ele consultava o banco. O balanceador do
 * Lightsail REINICIA o contêiner que responde fora da faixa saudável — então
 * um banco que piscasse por trinta segundos faria o balanceador derrubar um
 * app que estava perfeitamente bem, levando junto o pg-boss e todas as
 * conexões SSE abertas.
 *
 * Uma indisponibilidade curta do banco virava uma longa do aplicativo,
 * causada pela própria verificação de saúde.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── Por que este arquivo aponta para um banco que não existe ─────────────
 *
 * Não dá para derrubar o Postgres da suíte: os outros arquivos rodam no mesmo
 * banco, e `--test-concurrency=1` não impede que o processo seguinte o
 * encontre parado.
 *
 * Então a queda é simulada do jeito mais fiel possível: um segundo processo,
 * com `DATABASE_URL` apontando para uma porta onde não há ninguém ouvindo. O
 * app sobe, as rotas respondem, e o banco está inalcançável — que é
 * exatamente o cenário do balanceador.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import path from "node:path";
import app from "../app.ts";

const rodar = promisify(execFile);

interface Resposta {
  status: number;
  corpo: Record<string, unknown>;
}

/**
 * Pesca a linha de resultado do processo de apoio.
 *
 * O logger (pino) escreve no MESMO stdout, em várias linhas e às vezes
 * coloridas. Pegar "a última linha" pegava saída dele; o marcador torna a
 * extração à prova de qualquer ruído que apareça no meio.
 */
function extrairResultado(stdout: string): string {
  const linha = stdout.split("\n").find((l) => l.includes("ZELO_RESULTADO:"));
  assert.ok(linha, `o processo de apoio não imprimiu o resultado. Saída:\n${stdout}`);
  return linha.slice(linha.indexOf("ZELO_RESULTADO:") + "ZELO_RESULTADO:".length).trim();
}

async function comServidor<T>(acao: (pedir: (rota: string) => Promise<Resposta>) => Promise<T>): Promise<T> {
  const servidor = http.createServer(app);
  await new Promise<void>((resolve, reject) => {
    servidor.listen(0, "127.0.0.1", resolve);
    servidor.on("error", reject);
  });
  const porta = (servidor.address() as { port: number }).port;

  const pedir = (rota: string): Promise<Resposta> =>
    new Promise((resolve, reject) => {
      const req = http.request(
        { hostname: "127.0.0.1", port: porta, path: rota, method: "GET" },
        (res) => {
          let dados = "";
          res.on("data", (c: Buffer) => (dados += c.toString()));
          res.on("end", () => {
            try {
              resolve({ status: res.statusCode ?? 0, corpo: JSON.parse(dados) as Record<string, unknown> });
            } catch {
              resolve({ status: res.statusCode ?? 0, corpo: { cru: dados } });
            }
          });
        },
      );
      req.on("error", reject);
      req.end();
    });

  try {
    return await acao(pedir);
  } finally {
    await new Promise<void>((res, rej) => servidor.close((e) => (e ? rej(e) : res())));
  }
}

describe("Com o banco DE PE", () => {
  it("as duas rotas respondem 200", async () => {
    await comServidor(async (pedir) => {
      const vivo = await pedir("/api/healthz");
      assert.equal(vivo.status, 200);
      assert.equal(vivo.corpo.status, "ok");

      const pronto = await pedir("/api/readyz");
      assert.equal(pronto.status, 200);
      assert.equal(pronto.corpo.db, "ok");
      assert.equal(typeof pronto.corpo.dbLatencyMs, "number");
    });
  });

  it("o /healthz NAO consulta o banco, e o /readyz consulta", async () => {
    await comServidor(async (pedir) => {
      const vivo = await pedir("/api/healthz");
      // A ausência do campo `db` é o que diz que ele não foi ao banco. Se um
      // dia alguém acrescentar a consulta de volta aqui, este caso reprova.
      assert.equal(vivo.corpo.db, undefined, "/healthz não pode reportar estado de banco");
      assert.equal(typeof vivo.corpo.uptimeSeconds, "number");

      const pronto = await pedir("/api/readyz");
      assert.equal(pronto.corpo.db, "ok");
    });
  });
});

describe("Com o banco FORA DO AR", () => {
  it("o /healthz responde 200 e o /readyz responde 503", async () => {
    /**
     * ═════════════════════════════════════════════════════════════════════
     * É O CASO INTEIRO DESTA ISSUE.
     *
     * Se o `/healthz` respondesse 503 aqui, o balanceador reiniciaria o
     * contêiner — e o app, que está de pé e servindo, seria derrubado por um
     * problema que não é dele.
     * ═════════════════════════════════════════════════════════════════════
     */
    const apoio = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "apoio-banco-fora.ts",
    );

    const ambiente: NodeJS.ProcessEnv = {
      ...process.env,
      // Porta 1: reservada, e nunca há Postgres nela. A conexão é recusada na
      // hora, sem esperar tempo de espera de rede.
      DATABASE_URL: "postgresql://ninguem:ninguem@127.0.0.1:1/ninguem",
    };

    const { stdout } = await rodar("npx", ["tsx", apoio], {
      env: ambiente,
      shell: process.platform === "win32",
    });

    const linha = extrairResultado(stdout);
    const r = JSON.parse(linha) as {
      healthzStatus: number;
      readyzStatus: number;
      readyzCorpo: Record<string, unknown>;
    };

    assert.equal(
      r.healthzStatus,
      200,
      "com o banco fora, /healthz TEM que responder 200 — senão o balanceador " +
        "reinicia um app saudável e derruba o pg-boss e as conexões SSE junto",
    );
    assert.equal(r.readyzStatus, 503, "com o banco fora, /readyz tem que dizer que não dá");
    assert.equal(r.readyzCorpo.db, "error");
  });

  it("o /readyz NAO vaza host, porta nem usuario do banco", async () => {
    /**
     * A mensagem de erro do driver `pg` traz host, porta e às vezes o usuário.
     * Numa rota pública, isso é mapa entregue de graça a quem estiver olhando.
     */
    const apoio = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "apoio-banco-fora.ts",
    );

    const ambiente: NodeJS.ProcessEnv = {
      ...process.env,
      DATABASE_URL: "postgresql://usuario_secreto:senha_secreta@127.0.0.1:1/banco_secreto",
    };

    const { stdout } = await rodar("npx", ["tsx", apoio], {
      env: ambiente,
      shell: process.platform === "win32",
    });

    const linha = extrairResultado(stdout);
    const cru = JSON.stringify(JSON.parse(linha));

    for (const segredo of ["usuario_secreto", "senha_secreta", "banco_secreto", "127.0.0.1", "ECONNREFUSED"]) {
      assert.ok(
        !cru.includes(segredo),
        `a resposta do /readyz não pode conter "${segredo}" — é rota pública`,
      );
    }
  });
});
