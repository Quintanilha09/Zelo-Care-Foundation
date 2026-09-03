/**
 * Reenviar o código, sem abrir a porta — Issues #75 e #84.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * A ROTA DE REENVIO DEVOLVE TENTATIVAS AO ATACANTE.
 *
 * Antes dela, o sistema tinha UM código por conta, para sempre: cinco palpites
 * e acabou — 1 chance em 200.000. Essa robustez era **acidental**, vinha da
 * falta de um jeito de pedir outro código.
 *
 * Cada reenvio devolve cinco palpites. O teto de emissão por conta é o que
 * impede isso de virar máquina de adivinhar, e é o que este arquivo guarda.
 * Se alguém "simplificar" a rota e tirar a contagem, nada na tela muda e
 * nenhum outro teste quebra.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { eq, like, desc, and } from "drizzle-orm";
import { db } from "@workspace/db";
import { usersTable, familiesTable, emailVerificationsTable } from "@workspace/db";
import {
  hashDoCodigo,
  MAX_CODIGOS_POR_HORA,
  PISO_DE_RESPOSTA_MS,
} from "../lib/codigo-de-verificacao.ts";
import { Clock } from "../lib/clock.ts";
import app from "../app.ts";

const SUFIXO = "@reenvio-test.zelo.test";

let testPort: number;
let closeServer: () => Promise<void>;

before(async () => {
  await new Promise<void>((resolve, reject) => {
    const server = http.createServer(app);
    server.listen(0, "127.0.0.1", () => {
      testPort = (server.address() as { port: number }).port;
      closeServer = () => new Promise((res, rej) => server.close((e) => (e ? rej(e) : res())));
      resolve();
    });
    server.on("error", reject);
  });
});

after(async () => {
  await closeServer();
  await db.delete(usersTable).where(like(usersTable.email, `%${SUFIXO}`));
  await db.delete(familiesTable).where(like(familiesTable.name, "Família Fictícia Reenvio %"));
});

async function api(path: string, body?: unknown) {
  const payload = body ? JSON.stringify(body) : undefined;
  return new Promise<{ status: number; body: Record<string, unknown>; ms: number }>(
    (resolve, reject) => {
      const t0 = performance.now();
      const req = http.request(
        {
          hostname: "127.0.0.1",
          port: testPort,
          path: `/api${path}`,
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(payload ? { "Content-Length": Buffer.byteLength(payload) } : {}),
          },
        },
        (res) => {
          let data = "";
          res.on("data", (c: Buffer) => (data += c.toString()));
          res.on("end", () => {
            const ms = performance.now() - t0;
            try {
              resolve({ status: res.statusCode ?? 0, body: JSON.parse(data) as Record<string, unknown>, ms });
            } catch {
              resolve({ status: res.statusCode ?? 0, body: { bruto: data }, ms });
            }
          });
        },
      );
      req.on("error", reject);
      if (payload) req.write(payload);
      req.end();
    },
  );
}

/** Conta pendente com um código conhecido. */
async function contaPendente(codigo: string, opcoes: { verificada?: boolean } = {}) {
  const marca = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const email = `reenvio-${marca}${SUFIXO}`;

  await db
    .insert(familiesTable)
    .values({ name: `Família Fictícia Reenvio ${marca}`, slug: `reenv-${marca}` });

  const [user] = await db
    .insert(usersTable)
    .values({
      email,
      name: "Pessoa Fictícia Reenvio",
      passwordHash: "nao-usado-neste-teste",
      emailVerified: opcoes.verificada ?? false,
      status: opcoes.verificada ? "active" : "pending_verification",
    })
    .returning({ id: usersTable.id });

  await db.insert(emailVerificationsTable).values({
    userId: user.id,
    tokenHash: hashDoCodigo(user.id, codigo),
    expiresAt: new Date(Clock.now().getTime() + 10 * 60 * 1000),
  });

  return { email, userId: user.id };
}

async function codigosVivos(userId: number): Promise<number> {
  const linhas = await db
    .select({ id: emailVerificationsTable.id })
    .from(emailVerificationsTable)
    .where(and(eq(emailVerificationsTable.userId, userId), eq(emailVerificationsTable.used, false)));
  return linhas.length;
}

async function totalDeCodigos(userId: number): Promise<number> {
  const linhas = await db
    .select({ id: emailVerificationsTable.id })
    .from(emailVerificationsTable)
    .where(eq(emailVerificationsTable.userId, userId));
  return linhas.length;
}

describe("Reenvio — o teto de emissão por conta", () => {
  it(`para de emitir depois de ${MAX_CODIGOS_POR_HORA} códigos na mesma hora`, async () => {
    // A conta já nasce com 1 código (o do cadastro).
    const { email, userId } = await contaPendente("111111");

    for (let i = 0; i < MAX_CODIGOS_POR_HORA + 3; i++) {
      await api("/auth/verify-email/resend", { email });
    }

    const total = await totalDeCodigos(userId);
    assert.equal(
      total,
      MAX_CODIGOS_POR_HORA,
      `esperava parar em ${MAX_CODIGOS_POR_HORA} códigos, emitiu ${total} — o teto sumiu`,
    );
  });

  it("estourar o teto responde IGUAL a um reenvio normal", async () => {
    const { email } = await contaPendente("111111");

    const primeira = await api("/auth/verify-email/resend", { email });
    for (let i = 0; i < MAX_CODIGOS_POR_HORA + 2; i++) {
      await api("/auth/verify-email/resend", { email });
    }
    const depoisDoTeto = await api("/auth/verify-email/resend", { email });

    // Se o teto tivesse recado próprio, ele viraria o oráculo que a resposta
    // genérica existe para fechar: "esta conta existe, está pendente, e alguém
    // andou pedindo código".
    assert.equal(depoisDoTeto.status, primeira.status);
    assert.deepEqual(depoisDoTeto.body, primeira.body);
  });
});

describe("Reenvio — só um código vale por vez", () => {
  it("emitir aposenta TODOS os anteriores", async () => {
    const { email, userId } = await contaPendente("111111");
    assert.equal(await codigosVivos(userId), 1);

    await api("/auth/verify-email/resend", { email });

    // Dois códigos vivos seriam dez tentativas em vez de cinco — o dobro da
    // janela, de graça.
    assert.equal(await codigosVivos(userId), 1, "só o mais recente pode continuar valendo");
    assert.equal(await totalDeCodigos(userId), 2, "o anterior continua no banco, mas usado");
  });

  it("o código antigo para de funcionar depois do reenvio", async () => {
    const { email, userId } = await contaPendente("111111");
    await api("/auth/verify-email/resend", { email });

    const comOAntigo = await api("/auth/verify-email", { email, codigo: "111111" });
    assert.equal(comOAntigo.status, 400, "o código anterior não pode sobreviver ao reenvio");

    const [u] = await db
      .select({ v: usersTable.emailVerified })
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .limit(1);
    assert.equal(u?.v, false);
  });
});

describe("Reenvio — anti-enumeração", () => {
  it("conta inexistente, pendente e já confirmada respondem a MESMA coisa", async () => {
    const pendente = await contaPendente("111111");
    const confirmada = await contaPendente("222222", { verificada: true });

    const aExistente = await api("/auth/verify-email/resend", { email: pendente.email });
    const aConfirmada = await api("/auth/verify-email/resend", { email: confirmada.email });
    const aInexistente = await api("/auth/verify-email/resend", {
      email: `nao-existe-${Date.now()}${SUFIXO}`,
    });

    assert.equal(aConfirmada.status, aExistente.status);
    assert.deepEqual(aConfirmada.body, aExistente.body);
    assert.equal(aInexistente.status, aExistente.status);
    assert.deepEqual(aInexistente.body, aExistente.body);
  });

  it("conta já confirmada não ganha código novo", async () => {
    const { email, userId } = await contaPendente("222222", { verificada: true });
    const antes = await totalDeCodigos(userId);

    await api("/auth/verify-email/resend", { email });

    assert.equal(
      await totalDeCodigos(userId),
      antes,
      "reenviar para conta confirmada é emissão gasta à toa e superfície de graça",
    );
  });

  it("corpo malformado não derruba a rota nem responde diferente", async () => {
    const { email } = await contaPendente("111111");
    const referencia = await api("/auth/verify-email/resend", { email });

    for (const corpo of [{}, { email: "" }, { email: 42 }, { email: null }, { outra: "coisa" }]) {
      const res = await api("/auth/verify-email/resend", corpo);
      assert.equal(res.status, referencia.status, `corpo ${JSON.stringify(corpo)} respondeu diferente`);
      assert.deepEqual(res.body, referencia.body);
    }
  });
});

describe("Piso de tempo — Issue #84", () => {
  // Margem para baixo: `setTimeout` acorda com alguns milissegundos de atraso,
  // e o relógio do CI é mais ruidoso que o desta máquina. O que se mede aqui é
  // "não responde rápido demais", não o valor exato.
  const MINIMO_ACEITAVEL = PISO_DE_RESPOSTA_MS * 0.9;

  it("confirmação com conta INEXISTENTE respeita o piso", async () => {
    const res = await api("/auth/verify-email", {
      email: `nao-existe-${Date.now()}${SUFIXO}`,
      codigo: "000000",
    });

    assert.equal(res.status, 400);
    assert.ok(
      res.ms >= MINIMO_ACEITAVEL,
      `respondeu em ${res.ms.toFixed(0)}ms, abaixo do piso de ${PISO_DE_RESPOSTA_MS}ms — ` +
        "sem o piso, o relógio conta o que o corpo da resposta cala",
    );
  });

  it("confirmação com conta EXISTENTE e código errado respeita o mesmo piso", async () => {
    const { email } = await contaPendente("111111");
    const res = await api("/auth/verify-email", { email, codigo: "000000" });

    assert.equal(res.status, 400);
    assert.ok(res.ms >= MINIMO_ACEITAVEL, `respondeu em ${res.ms.toFixed(0)}ms`);
  });

  it("os dois caminhos ficam próximos — é o ponto do piso", async () => {
    const { email } = await contaPendente("111111");

    const inexistente = await api("/auth/verify-email", {
      email: `nao-existe-${Date.now()}${SUFIXO}`,
      codigo: "000000",
    });
    const existente = await api("/auth/verify-email", { email, codigo: "000000" });

    // Sem o piso, a diferença vinha da consulta a mais, do hash e do UPDATE.
    // Com ele, as duas encostam no mesmo chão. A folga é generosa de propósito:
    // isto é mitigação, não tempo constante — e tempo constante contra banco de
    // dados não existe.
    const diferenca = Math.abs(existente.ms - inexistente.ms);
    assert.ok(
      diferenca < PISO_DE_RESPOSTA_MS,
      `diferença de ${diferenca.toFixed(0)}ms entre os caminhos — o piso não está segurando`,
    );
  });

  it("o reenvio também respeita o piso", async () => {
    const res = await api("/auth/verify-email/resend", {
      email: `nao-existe-${Date.now()}${SUFIXO}`,
    });
    assert.ok(res.ms >= MINIMO_ACEITAVEL, `respondeu em ${res.ms.toFixed(0)}ms`);
  });
});

describe("Reenvio — o que fica no banco", () => {
  it("o código novo nunca é gravado em claro", async () => {
    const { email, userId } = await contaPendente("111111");
    await api("/auth/verify-email/resend", { email });

    const [maisNovo] = await db
      .select()
      .from(emailVerificationsTable)
      .where(eq(emailVerificationsTable.userId, userId))
      .orderBy(desc(emailVerificationsTable.id))
      .limit(1);

    assert.ok(maisNovo, "o código novo precisa existir");
    assert.match(maisNovo.tokenHash, /^[0-9a-f]{64}$/, "esperava SHA-256 em hex");
    assert.equal(maisNovo.attempts, 0, "código novo nasce com o contador zerado");
  });
});
