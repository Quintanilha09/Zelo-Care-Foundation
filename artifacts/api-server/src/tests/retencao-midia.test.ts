/**
 * Retenção de 90 dias, e o que a família quer guardar — QUI-11.
 *
 * **Isto é minimização de dado, que a LGPD exige.** Guardar foto de uma
 * pessoa vulnerável para sempre, sem motivo, é o oposto do que a lei pede.
 * O custo cair junto é consequência, não motivo.
 *
 * Os quatro pontos que estes testes existem para provar:
 *   1. momento com 91 dias é apagado, **e o objeto some do balde**
 *   2. momento guardado sobrevive — testado com o relógio congelado
 *   3. o job é idempotente: rodar duas vezes não quebra nada
 *   4. a exclusão de dados do titular (REQ-006) passa a incluir mídia
 */
import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  usersTable, caregiversTable, familiesTable, patientsTable,
  mediaAssetsTable, consentRecordsTable,
} from "@workspace/db";
import { generateAccessToken } from "../lib/tokens.ts";
import { hashPassword } from "../lib/password.ts";
import { boss } from "../lib/queue.ts";
import { Clock } from "../lib/clock.ts";
import { obterArmazenamento, novaChaveDeObjeto } from "../lib/media-storage.ts";
import {
  apagarMidiasVencidas, apagarMidiasDaFamilia, DIAS_DE_RETENCAO,
} from "../lib/media-cleanup.ts";
import app from "../app.ts";

let testPort: number;
let closeServer: () => Promise<void>;
let familyId: number;
let patientId: number;
let principalUserId: number;
let token: string;
let comumToken: string;
let outraFamilyId: number;
let outroPatientId: number;
let vizinhoToken: string;

interface ApiResult { status: number; body: unknown }

const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

const UM_DIA = 86_400_000;

async function bruto(
  method: string, path: string, corpo: Buffer | undefined, headers: Record<string, string>
): Promise<{ status: number; texto: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: "127.0.0.1", port: testPort, path: `/api${path}`, method,
        headers: { ...headers, ...(corpo ? { "Content-Length": corpo.length } : {}) },
      },
      (res) => {
        let data = "";
        res.on("data", (c: Buffer) => (data += c.toString()));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, texto: data }));
      }
    );
    req.on("error", reject);
    if (corpo) req.write(corpo);
    req.end();
  });
}

function json(r: { status: number; texto: string }): ApiResult {
  try { return { status: r.status, body: JSON.parse(r.texto) }; }
  catch { return { status: r.status, body: r.texto }; }
}

async function api(method: string, path: string, corpo?: unknown, authToken = token): Promise<ApiResult> {
  const payload = corpo !== undefined ? Buffer.from(JSON.stringify(corpo)) : undefined;
  return json(await bruto(method, path, payload, {
    Authorization: `Bearer ${authToken}`,
    "Content-Type": "application/json",
  }));
}

async function publicar(alvo = patientId, comoToken = token): Promise<number> {
  const boundary = `----zelo${crypto.randomBytes(8).toString("hex")}`;
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="patientId"\r\n\r\n${alvo}\r\n`),
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="arquivo"; filename="m.png"\r\n` +
      `Content-Type: image/png\r\n\r\n`
    ),
    PNG_1X1,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const r = json(await bruto("POST", "/media", body, {
    Authorization: `Bearer ${comoToken}`,
    "Content-Type": `multipart/form-data; boundary=${boundary}`,
  }));
  assert.equal(r.status, 201, `publicar deveria dar 201, deu ${r.status}: ${JSON.stringify(r.body)}`);
  return (r.body as { id: number }).id;
}

/** Envelhece uma mídia mexendo no createdAt — o expurgo compara com Clock.now(). */
async function envelhecer(id: number, dias: number): Promise<void> {
  await db
    .update(mediaAssetsTable)
    .set({ createdAt: new Date(Clock.now().getTime() - dias * UM_DIA) })
    .where(eq(mediaAssetsTable.id, id));
}

async function chaveDe(id: number): Promise<string> {
  const [linha] = await db
    .select({ objectKey: mediaAssetsTable.objectKey })
    .from(mediaAssetsTable)
    .where(eq(mediaAssetsTable.id, id));
  return linha.objectKey;
}

async function existe(id: number): Promise<boolean> {
  const linhas = await db.select({ id: mediaAssetsTable.id }).from(mediaAssetsTable).where(eq(mediaAssetsTable.id, id));
  return linhas.length > 0;
}

async function darConsentimento(alvo: number, userId = principalUserId): Promise<void> {
  await db.insert(consentRecordsTable).values({
    userId, patientId: alvo, givenBy: "legal_representative",
    consentType: "image_capture", consentGiven: "true", version: "v1.0",
    ipAddress: "127.0.0.1",
  });
}

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

  const marca = Date.now();

  const [family] = await db.insert(familiesTable)
    .values({ name: "Família Fictícia Retenção", slug: `ret-${marca}` }).returning();
  familyId = family.id;

  const [user] = await db.insert(usersTable).values({
    email: `ret-${marca}@zelo.test`, name: "Ana Fictícia",
    passwordHash: await hashPassword("x"), emailVerified: true, status: "active",
  }).returning();
  const [caregiver] = await db.insert(caregiversTable)
    .values({ familyId, userId: user.id, name: "Ana Fictícia", role: "primary_caregiver" }).returning();
  principalUserId = user.id;
  token = generateAccessToken(user.id, familyId, caregiver.id, "primary_caregiver");

  const [comum] = await db.insert(usersTable).values({
    email: `ret-comum-${marca}@zelo.test`, name: "Bruno Fictício",
    passwordHash: await hashPassword("x"), emailVerified: true, status: "active",
  }).returning();
  const [comumCaregiver] = await db.insert(caregiversTable)
    .values({ familyId, userId: comum.id, name: "Bruno Fictício", role: "caregiver" }).returning();
  comumToken = generateAccessToken(comum.id, familyId, comumCaregiver.id, "caregiver");

  const [patient] = await db.insert(patientsTable)
    .values({ familyId, name: "Dona Maria Teste", timezone: "America/Sao_Paulo" }).returning();
  patientId = patient.id;
  await darConsentimento(patientId);

  // Família vizinha: prova que o expurgo e a exclusão não atravessam fronteira.
  const [outra] = await db.insert(familiesTable)
    .values({ name: "Outra Família Fictícia", slug: `ret-outra-${marca}` }).returning();
  outraFamilyId = outra.id;
  const [outroUser] = await db.insert(usersTable).values({
    email: `ret-outra-${marca}@zelo.test`, name: "Cuidador Vizinho",
    passwordHash: await hashPassword("x"), emailVerified: true, status: "active",
  }).returning();
  const [vizinhoCaregiver] = await db.insert(caregiversTable)
    .values({ familyId: outraFamilyId, userId: outroUser.id, name: "Cuidador Vizinho", role: "primary_caregiver" })
    .returning();
  vizinhoToken = generateAccessToken(outroUser.id, outraFamilyId, vizinhoCaregiver.id, "primary_caregiver");
  const [outroPatient] = await db.insert(patientsTable)
    .values({ familyId: outraFamilyId, name: "Seu João Teste", timezone: "America/Sao_Paulo" }).returning();
  outroPatientId = outroPatient.id;
  await darConsentimento(outroPatientId, outroUser.id);
});

beforeEach(async () => {
  Clock.reset();
  await db.delete(mediaAssetsTable).where(eq(mediaAssetsTable.patientId, patientId));
  await db.delete(mediaAssetsTable).where(eq(mediaAssetsTable.patientId, outroPatientId));
});

after(async () => {
  Clock.reset();
  await closeServer();
  await boss.stop({ graceful: false });
  await db.delete(familiesTable).where(eq(familiesTable.id, familyId));
  await db.delete(familiesTable).where(eq(familiesTable.id, outraFamilyId));
});

describe("O que vence, some", () => {
  it("momento com 91 dias é apagado, E o objeto some do balde", async () => {
    const id = await publicar();
    const chave = await chaveDe(id);
    const armazenamento = obterArmazenamento();
    assert.ok(armazenamento);
    assert.equal(await armazenamento.existe(chave), true, "o objeto tem que existir antes");

    await envelhecer(id, DIAS_DE_RETENCAO + 1);
    const r = await apagarMidiasVencidas();

    assert.equal(r.apagadas, 1);
    assert.equal(await existe(id), false, "a linha tem que sumir");
    assert.equal(
      await armazenamento.existe(chave), false,
      "apagar a linha sem apagar o arquivo não é retenção — é ilusão de retenção"
    );
  });

  it("momento com 89 dias NÃO é apagado", async () => {
    const id = await publicar();
    await envelhecer(id, DIAS_DE_RETENCAO - 1);
    await apagarMidiasVencidas();
    assert.equal(await existe(id), true);
  });

  it("momento de hoje não é tocado", async () => {
    const id = await publicar();
    const r = await apagarMidiasVencidas();
    assert.equal(r.apagadas, 0);
    assert.equal(await existe(id), true);
  });

  it("com o relógio andando 91 dias, o momento de hoje vence sozinho", async () => {
    const id = await publicar();

    // Nada de mexer no createdAt aqui: quem anda é o RELÓGIO, que é como o
    // tempo passa de verdade em produção.
    Clock.advance((DIAS_DE_RETENCAO + 1) * UM_DIA);
    await apagarMidiasVencidas();

    assert.equal(await existe(id), false);
    Clock.reset();
  });
});

describe("O que a família guarda, fica", () => {
  it("momento guardado sobrevive ao expurgo, com o relógio andando", async () => {
    const guardado = await publicar();
    const comum = await publicar();

    const r = await api("PATCH", `/media/${guardado}/guardar`, { guardar: true });
    assert.equal(r.status, 200);
    assert.equal((r.body as { guardado: boolean }).guardado, true);

    Clock.advance((DIAS_DE_RETENCAO + 1) * UM_DIA);
    await apagarMidiasVencidas();

    assert.equal(await existe(guardado), true, "guardado não pode expirar");
    assert.equal(await existe(comum), false, "o que não foi guardado tem que sumir");
    Clock.reset();
  });

  it("desmarcar devolve o momento à contagem", async () => {
    const id = await publicar();
    await api("PATCH", `/media/${id}/guardar`, { guardar: true });
    await api("PATCH", `/media/${id}/guardar`, { guardar: false });

    Clock.advance((DIAS_DE_RETENCAO + 1) * UM_DIA);
    await apagarMidiasVencidas();
    assert.equal(await existe(id), false);
    Clock.reset();
  });

  it("QUALQUER cuidador da família pode guardar, não só o principal", async () => {
    const id = await publicar();
    const r = await api("PATCH", `/media/${id}/guardar`, { guardar: true }, comumToken);
    assert.equal(r.status, 200, "exigir hierarquia aqui faria alguém perder uma memória esperando aprovação");
  });

  it("sem limite de quantos podem ser guardados", async () => {
    const ids = [await publicar(), await publicar(), await publicar()];
    for (const id of ids) {
      assert.equal((await api("PATCH", `/media/${id}/guardar`, { guardar: true })).status, 200);
    }
    Clock.advance((DIAS_DE_RETENCAO + 1) * UM_DIA);
    await apagarMidiasVencidas();
    for (const id of ids) assert.equal(await existe(id), true);
    Clock.reset();
  });

  it("mídia de outra família — 404, nunca 403", async () => {
    const id = await publicar();
    // Token da família certa, mas o cuidador vizinho não alcança.
    const r = await api("PATCH", `/media/${id}/guardar`, { guardar: true }, vizinhoToken);
    assert.equal(r.status, 404);
  });

  it("sem o campo `guardar`, 400", async () => {
    const id = await publicar();
    const r = await api("PATCH", `/media/${id}/guardar`, {});
    assert.equal(r.status, 400);
    assert.equal((r.body as { code: string }).code, "KEEP_FLAG_REQUIRED");
  });
});

describe("O mural avisa antes", () => {
  it("a resposta diz quantos dias e quando cada momento expira", async () => {
    const id = await publicar();
    const r = await api("GET", `/patients/${patientId}/momentos`);
    const mural = r.body as {
      diasDeRetencao: number;
      momentos: Array<{ id: number; guardado: boolean; expiraEm: string | null }>;
    };

    assert.equal(mural.diasDeRetencao, DIAS_DE_RETENCAO, "a tela precisa do número para avisar");
    const momento = mural.momentos.find((m) => m.id === id)!;
    assert.equal(momento.guardado, false);
    assert.ok(momento.expiraEm, "momento comum precisa dizer quando some");

    // 90 dias depois de criado, com folga de um minuto para o tempo do teste.
    const criado = Clock.now().getTime();
    const expira = Date.parse(momento.expiraEm!);
    assert.ok(Math.abs(expira - (criado + DIAS_DE_RETENCAO * UM_DIA)) < 60_000);
  });

  it("guardado não mostra data de expiração", async () => {
    const id = await publicar();
    await api("PATCH", `/media/${id}/guardar`, { guardar: true });

    const r = await api("GET", `/patients/${patientId}/momentos`);
    const momento = (r.body as { momentos: Array<{ id: number; guardado: boolean; expiraEm: string | null }> })
      .momentos.find((m) => m.id === id)!;
    assert.equal(momento.guardado, true);
    assert.equal(momento.expiraEm, null);
  });
});

describe("O job é idempotente", () => {
  it("rodar duas vezes seguidas não quebra nada", async () => {
    const id = await publicar();
    await envelhecer(id, DIAS_DE_RETENCAO + 5);

    const primeira = await apagarMidiasVencidas();
    const segunda = await apagarMidiasVencidas();

    assert.equal(primeira.apagadas, 1);
    assert.equal(segunda.apagadas, 0, "a segunda passada não acha nada — e isso não é erro");
    assert.equal(segunda.falhas, 0);
  });

  it("com o balde vazio, não faz nada e não reclama", async () => {
    const r = await apagarMidiasVencidas();
    assert.equal(r.apagadas, 0);
    assert.equal(r.falhas, 0);
  });

  it("não atravessa família: o vencido de uma não apaga o novo da outra", async () => {
    const meu = await publicar();
    const vizinho = await publicar(outroPatientId, vizinhoToken);
    await envelhecer(meu, DIAS_DE_RETENCAO + 1);

    await apagarMidiasVencidas();

    assert.equal(await existe(meu), false);
    assert.equal(await existe(vizinho), true, "o expurgo é por IDADE, não por família — e o novo fica");
  });
});

describe("REQ-006 — a exclusão do titular passa a incluir mídia", () => {
  it("apagar as mídias de uma família limpa o balde", async () => {
    const a = await publicar();
    const b = await publicar();
    const chaves = [await chaveDe(a), await chaveDe(b)];

    const armazenamento = obterArmazenamento();
    assert.ok(armazenamento);
    for (const chave of chaves) assert.equal(await armazenamento.existe(chave), true);

    const r = await apagarMidiasDaFamilia(familyId);
    assert.equal(r.apagadas, 2);

    for (const chave of chaves) {
      assert.equal(
        await armazenamento.existe(chave), false,
        "exclusão do titular que deixa a foto no balde não é exclusão"
      );
    }
  });

  it("apagar as mídias de uma família NÃO toca na outra", async () => {
    await publicar();
    const vizinho = await publicar(outroPatientId, vizinhoToken);
    const chaveVizinha = await chaveDe(vizinho);

    await apagarMidiasDaFamilia(familyId);

    const armazenamento = obterArmazenamento();
    assert.ok(armazenamento);
    assert.equal(await existe(vizinho), true);
    assert.equal(await armazenamento.existe(chaveVizinha), true);
  });

  it("apagar o PACIENTE apaga a mídia dele do balde", async () => {
    // Paciente descartável: apagar o principal quebraria os casos seguintes.
    const [passageiro] = await db.insert(patientsTable)
      .values({ familyId, name: "Paciente Fictício Passageiro", timezone: "America/Sao_Paulo" }).returning();
    await darConsentimento(passageiro.id);

    const id = await publicar(passageiro.id);
    const chave = await chaveDe(id);
    const armazenamento = obterArmazenamento();
    assert.ok(armazenamento);
    assert.equal(await armazenamento.existe(chave), true);

    const r = await api("DELETE", `/patients/${passageiro.id}`, {
      confirmName: "Paciente Fictício Passageiro",
      reason: "teste de exclusao",
    });
    assert.equal(r.status, 200, JSON.stringify(r.body));

    assert.equal(await existe(id), false, "o cascade derruba a linha");
    assert.equal(
      await armazenamento.existe(chave), false,
      "e o código precisa derrubar o OBJETO — o cascade não faz isso sozinho"
    );
  });
});

describe("O armazenamento em si", () => {
  it("apagar um objeto que não existe não é erro", async () => {
    const armazenamento = obterArmazenamento();
    assert.ok(armazenamento);
    await armazenamento.apagar(novaChaveDeObjeto("image"));
  });
});
