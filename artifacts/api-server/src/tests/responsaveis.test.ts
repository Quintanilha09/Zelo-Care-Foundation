/**
 * Quem é responsável por quem — Issue #120.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ESTE ARQUIVO GUARDA UMA LINHA DE ARQUITETURA, NÃO SÓ UM CRUD:
 * **VÍNCULO NÃO É AUTORIZAÇÃO.**
 *
 * Um cuidador SEM vínculo continua vendo e registrando dose do paciente,
 * exatamente como antes. Se alguém "melhorar" isso e passar a filtrar acesso
 * pelo vínculo, o app deixa de funcionar para toda família que ainda não
 * vinculou ninguém — e nenhuma tela mostraria o erro até uma dose não ser
 * registrada.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── O resto do que ele guarda ─────────────────────────────────────────────
 *
 *   1. o vínculo nunca atravessa família (invariante 2, nos dois lados)
 *   2. vincular duas vezes é o mesmo vínculo
 *   3. só o cuidador principal vincula
 *   4. excluir o paciente leva o vínculo junto
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { eq, like } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  usersTable,
  familiesTable,
  caregiversTable,
  patientsTable,
  caregiverPatientsTable,
} from "@workspace/db";
import { generateAccessToken } from "../lib/tokens.ts";
import app from "../app.ts";

const SUFIXO = "@responsaveis.zelo.test";

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
  await db.delete(familiesTable).where(like(familiesTable.name, "Família Fictícia Resp %"));
});

async function pedir(
  metodo: string,
  path: string,
  opcoes: { token?: string; json?: unknown } = {},
) {
  const corpo = opcoes.json === undefined ? undefined : JSON.stringify(opcoes.json);
  return new Promise<{ status: number; body: Record<string, unknown> }>((resolve, reject) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port: testPort,
        path: `/api${path}`,
        method: metodo,
        headers: {
          "Content-Type": "application/json",
          ...(opcoes.token ? { Authorization: `Bearer ${opcoes.token}` } : {}),
          ...(corpo ? { "Content-Length": Buffer.byteLength(corpo) } : {}),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (c: Buffer) => (data += c.toString()));
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode ?? 0, body: JSON.parse(data) as Record<string, unknown> });
          } catch {
            resolve({ status: res.statusCode ?? 0, body: {} });
          }
        });
      },
    );
    req.on("error", reject);
    if (corpo) req.write(corpo);
    req.end();
  });
}

/** Uma família com principal, um segundo cuidador e um paciente. */
async function cenario(rotulo: string) {
  const marca = `${Date.now()}${Math.floor(Math.random() * 10000)}`;

  const [family] = await db
    .insert(familiesTable)
    .values({ name: `Família Fictícia Resp ${rotulo} ${marca}`, slug: `resp-${rotulo}-${marca}` })
    .returning({ id: familiesTable.id });

  const criarCuidador = async (papel: "primary_caregiver" | "caregiver", sufixoNome: string) => {
    const email = `resp-${rotulo}-${sufixoNome}-${marca}${SUFIXO}`;
    const [user] = await db
      .insert(usersTable)
      .values({
        email,
        name: `Pessoa Fictícia ${sufixoNome}`,
        passwordHash: "hash-nao-usado",
        emailVerified: true,
        status: "active",
        activeFamilyId: family.id,
      })
      .returning({ id: usersTable.id });

    const [c] = await db
      .insert(caregiversTable)
      .values({
        familyId: family.id,
        userId: user.id,
        name: `Pessoa Fictícia ${sufixoNome}`,
        email,
        role: papel,
      })
      .returning({ id: caregiversTable.id });

    return { id: c.id, token: generateAccessToken(user.id, family.id, c.id, papel) };
  };

  const principal = await criarCuidador("primary_caregiver", "Principal");
  const comum = await criarCuidador("caregiver", "Comum");

  const [patient] = await db
    .insert(patientsTable)
    .values({
      familyId: family.id,
      name: "Dona Maria Teste",
      timezone: "America/Sao_Paulo",
    })
    .returning({ id: patientsTable.id });

  return { familyId: family.id, principal, comum, patientId: patient.id };
}

async function vinculos(patientId: number): Promise<number[]> {
  const linhas = await db
    .select({ c: caregiverPatientsTable.caregiverId })
    .from(caregiverPatientsTable)
    .where(eq(caregiverPatientsTable.patientId, patientId));
  return linhas.map((l) => l.c);
}

describe("Vínculo entre cuidador e paciente", () => {
  it("vincula, lista, e desvincula", async () => {
    const c = await cenario("basico");

    const vinculo = await pedir("POST", `/patients/${c.patientId}/caregivers`, {
      token: c.principal.token,
      json: { caregiverId: c.comum.id },
    });
    assert.equal(vinculo.status, 201, JSON.stringify(vinculo.body));

    const lista = await pedir("GET", `/patients/${c.patientId}/caregivers`, {
      token: c.comum.token,
    });
    assert.equal(lista.status, 200);
    const ids = (lista.body as unknown as Array<{ id: number }>).map((r) => r.id);
    assert.deepEqual(ids, [c.comum.id]);

    const fora = await pedir(
      "DELETE",
      `/patients/${c.patientId}/caregivers/${c.comum.id}`,
      { token: c.principal.token },
    );
    assert.equal(fora.status, 204);
    assert.deepEqual(await vinculos(c.patientId), []);
  });

  it("NÃO muda o acesso: sem vínculo, o cuidador continua vendo o paciente", async () => {
    const c = await cenario("acesso");

    // Ninguém foi vinculado a este paciente. O cuidador comum tem que
    // continuar enxergando a ficha exatamente como antes desta Issue.
    const semVinculo = await pedir("GET", `/patients/${c.patientId}`, { token: c.comum.token });
    assert.equal(
      semVinculo.status,
      200,
      "vínculo é informativo — filtrar acesso por ele quebraria toda família que ainda não vinculou ninguém",
    );

    // E vincular OUTRA pessoa também não pode tirar o acesso de quem não foi
    // vinculado.
    await pedir("POST", `/patients/${c.patientId}/caregivers`, {
      token: c.principal.token,
      json: { caregiverId: c.principal.id },
    });

    const aindaVe = await pedir("GET", `/patients/${c.patientId}`, { token: c.comum.token });
    assert.equal(aindaVe.status, 200, "vincular alguém não desautoriza os outros");
  });

  it("vincular duas vezes é o mesmo vínculo", async () => {
    const c = await cenario("dobro");

    for (let i = 0; i < 2; i++) {
      const r = await pedir("POST", `/patients/${c.patientId}/caregivers`, {
        token: c.principal.token,
        json: { caregiverId: c.comum.id },
      });
      assert.equal(r.status, 201, `a ${i + 1}ª chamada devia passar`);
    }

    assert.deepEqual(
      await vinculos(c.patientId),
      [c.comum.id],
      "dois toques rápidos no botão não podem virar duas linhas",
    );
  });

  it("não atravessa família: nem pelo paciente, nem pelo cuidador", async () => {
    const daqui = await cenario("daqui");
    const dali = await cenario("dali");

    // Paciente de outra família: 404, nunca 403 — não confirmamos nem que ele
    // existe.
    const pacienteAlheio = await pedir("POST", `/patients/${dali.patientId}/caregivers`, {
      token: daqui.principal.token,
      json: { caregiverId: daqui.comum.id },
    });
    assert.equal(pacienteAlheio.status, 404);

    // Cuidador de outra família, paciente meu: também 404. Sem esta checagem,
    // o corpo da requisição escolheria alguém de fora e o vínculo
    // atravessaria a fronteira.
    const cuidadorAlheio = await pedir("POST", `/patients/${daqui.patientId}/caregivers`, {
      token: daqui.principal.token,
      json: { caregiverId: dali.comum.id },
    });
    assert.equal(cuidadorAlheio.status, 404);

    assert.deepEqual(await vinculos(daqui.patientId), [], "nada pode ter sido gravado");
    assert.deepEqual(await vinculos(dali.patientId), []);
  });

  it("só o cuidador principal vincula e desvincula", async () => {
    const c = await cenario("papel");

    const tentativa = await pedir("POST", `/patients/${c.patientId}/caregivers`, {
      token: c.comum.token,
      json: { caregiverId: c.comum.id },
    });
    assert.equal(tentativa.status, 403, JSON.stringify(tentativa.body));

    const remocao = await pedir(
      "DELETE",
      `/patients/${c.patientId}/caregivers/${c.comum.id}`,
      { token: c.comum.token },
    );
    assert.equal(remocao.status, 403);
  });

  it("excluir o paciente leva o vínculo junto", async () => {
    const c = await cenario("cascata");

    await pedir("POST", `/patients/${c.patientId}/caregivers`, {
      token: c.principal.token,
      json: { caregiverId: c.comum.id },
    });
    assert.equal((await vinculos(c.patientId)).length, 1);

    await db.delete(patientsTable).where(eq(patientsTable.id, c.patientId));

    assert.deepEqual(
      await vinculos(c.patientId),
      [],
      "linha órfã aqui viraria responsável apontando para ninguém",
    );
  });

  it("desvincular quem não estava vinculado não é erro", async () => {
    const c = await cenario("idempotente");

    const r = await pedir(
      "DELETE",
      `/patients/${c.patientId}/caregivers/${c.comum.id}`,
      { token: c.principal.token },
    );
    // O pedido era "que esta pessoa não seja mais responsável", e esse estado
    // está garantido de qualquer jeito.
    assert.equal(r.status, 204);
  });

  it("sem sessão, nenhuma das três rotas responde", async () => {
    const c = await cenario("anon");

    assert.equal((await pedir("GET", `/patients/${c.patientId}/caregivers`)).status, 401);
    assert.equal(
      (await pedir("POST", `/patients/${c.patientId}/caregivers`, { json: { caregiverId: 1 } })).status,
      401,
    );
    assert.equal(
      (await pedir("DELETE", `/patients/${c.patientId}/caregivers/1`)).status,
      401,
    );
  });
});
