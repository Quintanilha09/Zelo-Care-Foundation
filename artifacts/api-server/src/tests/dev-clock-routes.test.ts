/**
 * Testes das rotas de controle do relógio — proteção de produção
 *
 * Verifica dois comportamentos:
 * 1. Em desenvolvimento: as rotas /api/dev/clock existem e respondem.
 * 2. Em produção: as rotas NÃO existem — Express retorna 404 naturalmente.
 *
 * A proteção é estrutural: o router não registra as rotas em produção.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import express from "express";
import type { Express } from "express";
import { Clock } from "../lib/clock.ts";

// ── helper: inicia o app em uma porta aleatória e faz uma requisição ──────

function startServer(app: Express): Promise<{ port: number; close: () => Promise<void> }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as { port: number };
      resolve({
        port: addr.port,
        close: () =>
          new Promise((res, rej) => server.close((err) => (err ? rej(err) : res()))),
      });
    });
    server.on("error", reject);
  });
}

async function httpRequest(
  port: number,
  method: string,
  path: string,
  body?: unknown
): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : undefined;
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path,
        method,
        headers: {
          "Content-Type": "application/json",
          ...(payload ? { "Content-Length": Buffer.byteLength(payload) } : {}),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk: Buffer) => (data += chunk.toString()));
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode ?? 0, body: JSON.parse(data) });
          } catch {
            resolve({ status: res.statusCode ?? 0, body: data });
          }
        });
      }
    );
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// ── cria app isolado com NODE_ENV controlado ──────────────────────────────

/**
 * Os módulos que `routes/index.ts` monta dentro do
 * `if (allowsDevelopmentShortcuts())`.
 *
 * ── Isto é um ESPELHO, e espelho descola ─────────────────────────────────
 *
 * O `createApp` abaixo não usa o `routes/index.ts` de verdade: montar o
 * router inteiro exigiria banco, e o gate é lido no momento do import, o que
 * obrigaria a furar o cache de módulo para trocar de ambiente. Então este
 * arquivo reimplementa a regra.
 *
 * O preço apareceu na Issue #122: entrou uma segunda rota de desenvolvimento
 * (`dev-plano`), este espelho continuou só com o relógio, e a asserção de
 * produção passou a **passar sem provar nada** — a rota nunca tinha sido
 * montada, nem no ambiente em que deveria existir.
 *
 * O caso `o espelho não pode ficar para trás` fecha o buraco: ele lê o
 * `routes/index.ts` e falha se aparecer uma rota de desenvolvimento que não
 * esteja nesta lista.
 */
const ROTAS_DE_DESENVOLVIMENTO = ["dev-clock", "dev-plano"] as const;

async function createApp(nodeEnv: string): Promise<Express> {
  const app = express();
  app.use(express.json());
  const router = express.Router();

  if (nodeEnv !== "production") {
    for (const nome of ROTAS_DE_DESENVOLVIMENTO) {
      const modulo = (await import(`../routes/${nome}.ts`)) as { default: express.Router };
      router.use(modulo.default);
    }
  }

  app.use("/api", router);
  return app;
}

// ── testes ────────────────────────────────────────────────────────────────

describe("Rotas dev/clock — proteção de produção", () => {
  before(() => Clock.reset());
  after(() => Clock.reset());

  it("o espelho não pode ficar para trás do routes/index.ts", () => {
    // Lê a fonte de verdade e compara com a lista deste arquivo. Sem isto,
    // uma rota de desenvolvimento nova entra no app e sai deste teste ao
    // mesmo tempo — e os casos de produção abaixo passam sem provar nada,
    // porque estariam pedindo 404 de uma rota que ninguém montou.
    const fonte = readFileSync(
      fileURLToPath(new URL("../routes/index.ts", import.meta.url)),
      "utf8",
    );

    const inicio = fonte.indexOf("if (allowsDevelopmentShortcuts()) {");
    assert.ok(inicio >= 0, "o portão de desenvolvimento sumiu do routes/index.ts");

    const bloco = fonte.slice(inicio, fonte.indexOf("\n}", inicio));
    const montadas = [...bloco.matchAll(/import\("\.\/(dev-[a-z0-9-]+)\.js"\)/g)].map((m) => m[1]!);

    assert.deepEqual(
      montadas.slice().sort(),
      [...ROTAS_DE_DESENVOLVIMENTO].sort(),
      "rota de desenvolvimento montada no app mas ausente deste teste (ou o contrário)",
    );
  });

  describe("Em desenvolvimento (NODE_ENV=development)", () => {
    let port: number;
    let close: () => Promise<void>;

    before(async () => {
      const app = await createApp("development");
      const srv = await startServer(app);
      port = srv.port;
      close = srv.close;
    });

    after(async () => {
      await close();
      Clock.reset();
    });

    it("GET /api/dev/clock retorna 200 com estado do relógio", async () => {
      const res = await httpRequest(port, "GET", "/api/dev/clock");
      assert.equal(res.status, 200, `Esperava 200, recebeu ${res.status}`);
      const body = res.body as Record<string, unknown>;
      assert.ok("now" in body, "Resposta deve ter campo 'now'");
      assert.ok("offsetMs" in body, "Resposta deve ter campo 'offsetMs'");
      assert.ok("isInTestMode" in body, "Resposta deve ter campo 'isInTestMode'");
    });

    it("POST /api/dev/clock/advance retorna 200 e avança o relógio", async () => {
      const res = await httpRequest(port, "POST", "/api/dev/clock/advance", { ms: 60000 });
      assert.equal(res.status, 200, `Esperava 200, recebeu ${res.status}`);
      const body = res.body as Record<string, unknown>;
      assert.equal(body.ok, true);
      assert.equal(body.advancedMs, 60000);
    });

    it("POST /api/dev/clock/reset retorna 200 e restaura o relógio", async () => {
      const res = await httpRequest(port, "POST", "/api/dev/clock/reset", {});
      assert.equal(res.status, 200);
      const body = res.body as Record<string, unknown>;
      assert.equal(body.ok, true);
      assert.equal(body.isInTestMode, false);
    });

    it("POST /api/dev/clock/advance com ms inválido retorna 400", async () => {
      const res = await httpRequest(port, "POST", "/api/dev/clock/advance", { ms: "não-é-número" });
      assert.equal(res.status, 400);
    });

    it("POST /api/dev/plano sem sessão retorna 401 — a rota existe, mas tem dono", async () => {
      // 401 e não 404 é o ponto: em desenvolvimento a rota ESTÁ registrada, e
      // quem barra é o `requireAuth`. É o contraste com o caso de produção
      // logo abaixo, onde os 404 provam que ela não chegou a existir.
      const res = await httpRequest(port, "POST", "/api/dev/plano", { plano: "professional" });
      assert.equal(res.status, 401,
        `Em desenvolvimento /api/dev/plano sem token deve ser 401, recebeu ${res.status}`);
    });
  });

  describe("Em produção (NODE_ENV=production) — rotas não existem", () => {
    let port: number;
    let close: () => Promise<void>;

    before(async () => {
      const app = await createApp("production");
      const srv = await startServer(app);
      port = srv.port;
      close = srv.close;
    });

    after(async () => {
      await close();
    });

    it("GET /api/dev/clock retorna 404 — rota não existe em produção", async () => {
      const res = await httpRequest(port, "GET", "/api/dev/clock");
      assert.equal(res.status, 404,
        `Em produção /api/dev/clock deve ser 404 (rota não existe), recebeu ${res.status}`);
    });

    it("POST /api/dev/clock/advance retorna 404 em produção", async () => {
      const res = await httpRequest(port, "POST", "/api/dev/clock/advance", { ms: 9999999 });
      assert.equal(res.status, 404,
        `Em produção /api/dev/clock/advance deve ser 404, recebeu ${res.status}`);
    });

    it("POST /api/dev/clock/freeze retorna 404 em produção", async () => {
      const res = await httpRequest(port, "POST", "/api/dev/clock/freeze", { iso: "2099-01-01T00:00:00Z" });
      assert.equal(res.status, 404,
        `Em produção /api/dev/clock/freeze deve ser 404, recebeu ${res.status}`);
    });

    it("POST /api/dev/clock/reset retorna 404 em produção", async () => {
      const res = await httpRequest(port, "POST", "/api/dev/clock/reset", {});
      assert.equal(res.status, 404,
        `Em produção /api/dev/clock/reset deve ser 404, recebeu ${res.status}`);
    });

    it("POST /api/dev/plano retorna 404 em produção — e 404 é o número certo", async () => {
      // **404, nunca 401.** 401 diria que a rota existe e só faltou credencial,
      // e uma rota que troca o plano de uma família não pode existir em
      // produção nem para dizer "não autorizado". A proteção é o router não
      // registrar — ver `routes/dev-plano.ts`.
      const res = await httpRequest(port, "POST", "/api/dev/plano", { plano: "professional" });
      assert.equal(res.status, 404,
        `Em produção /api/dev/plano deve ser 404 (rota não existe), recebeu ${res.status}`);
    });
  });
});
