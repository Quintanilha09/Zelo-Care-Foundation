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

async function createApp(nodeEnv: string): Promise<Express> {
  const app = express();
  app.use(express.json());
  const router = express.Router();

  if (nodeEnv !== "production") {
    const { default: devClockRouter } = await import("../routes/dev-clock.ts");
    router.use(devClockRouter);
  }

  app.use("/api", router);
  return app;
}

// ── testes ────────────────────────────────────────────────────────────────

describe("Rotas dev/clock — proteção de produção", () => {
  before(() => Clock.reset());
  after(() => Clock.reset());

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
  });
});
