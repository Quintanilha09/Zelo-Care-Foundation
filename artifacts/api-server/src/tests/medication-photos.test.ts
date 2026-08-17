/**
 * Testes de extração de medicamento por foto — ZELO (ZELO-21).
 *
 * Os testes que exigem chamar a Claude Vision de verdade são condicionados
 * a ANTHROPIC_API_KEY estar presente no ambiente (pulados, não falhos, sem
 * a chave — este ambiente local não tem uma configurada; roda de verdade
 * onde a chave existir, ex: Replit).
 *
 * O resto — a garantia central da história, "impossível salvar sem passar
 * pela tela de confirmação" — não depende da API e roda sempre: prova que
 * este router nunca escreve em treatments/medications, e que confirmar e
 * descartar se comportam certo usando uma extração inserida direto no banco.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { eq, count } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  usersTable, caregiversTable, familiesTable, treatmentsTable, medicationsTable, photoExtractionsTable,
} from "@workspace/db";
import { generateAccessToken } from "../lib/tokens.ts";
import { hashPassword } from "../lib/password.ts";
import app from "../app.ts";

// PNG 1x1 transparente válido — "foto ilegível" de propósito: prova que uma
// imagem sem nenhum texto legível não trava o fluxo, só volta tudo vazio.
const TINY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

let testPort: number;
let closeServer: () => Promise<void>;
let familyId: number;
let caregiverId: number;
let token: string;

async function api(method: string, path: string, body?: unknown) {
  const payload = body !== undefined ? JSON.stringify(body) : undefined;
  return new Promise<{ status: number; body: unknown }>((resolve, reject) => {
    const req = http.request(
      {
        hostname: "127.0.0.1", port: testPort, path: `/api${path}`, method,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          ...(payload ? { "Content-Length": Buffer.byteLength(payload) } : {}),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (c: Buffer) => (data += c.toString()));
        res.on("end", () => {
          try { resolve({ status: res.statusCode ?? 0, body: JSON.parse(data) }); }
          catch { resolve({ status: res.statusCode ?? 0, body: data }); }
        });
      }
    );
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

/** multipart/form-data manual — só um campo de arquivo, sem dependência extra. */
async function uploadPhoto(base64: string, mimeType: string) {
  const boundary = "----zeloTestBoundary";
  const buffer = Buffer.from(base64, "base64");
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="photo"; filename="test.png"\r\nContent-Type: ${mimeType}\r\n\r\n`),
    buffer,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return new Promise<{ status: number; body: unknown }>((resolve, reject) => {
    const req = http.request(
      {
        hostname: "127.0.0.1", port: testPort, path: "/api/medication-photos/extract", method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
          "Content-Length": body.length,
        },
      },
      (res) => {
        let data = "";
        res.on("data", (c: Buffer) => (data += c.toString()));
        res.on("end", () => {
          try { resolve({ status: res.statusCode ?? 0, body: JSON.parse(data) }); }
          catch { resolve({ status: res.statusCode ?? 0, body: data }); }
        });
      }
    );
    req.on("error", reject);
    req.write(body);
    req.end();
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

  const [family] = await db
    .insert(familiesTable)
    .values({ name: "Família Foto Teste", slug: `photo-test-${Date.now()}` })
    .returning();
  familyId = family.id;

  const [user] = await db
    .insert(usersTable)
    .values({ email: `photo-${Date.now()}@zelo.test`, name: "Cuidador Teste", passwordHash: await hashPassword("x"), emailVerified: true, status: "active" })
    .returning();
  const [caregiver] = await db
    .insert(caregiversTable)
    .values({ familyId, userId: user.id, name: "Cuidador Teste", role: "primary_caregiver" })
    .returning();
  caregiverId = caregiver.id;
  token = generateAccessToken(user.id, familyId, caregiver.id, "primary_caregiver");
});

after(async () => {
  await closeServer();
  await db.delete(familiesTable).where(eq(familiesTable.id, familyId));
});

describe("Guarda estrutural: impossível salvar tratamento sem confirmação — ZELO-21", () => {
  it("uma extração pendente nunca cria linha em treatments ou medications", async () => {
    const [before] = await db.select({ n: count() }).from(treatmentsTable);
    const [beforeMeds] = await db.select({ n: count() }).from(medicationsTable);

    const [extraction] = await db
      .insert(photoExtractionsTable)
      .values({
        familyId, uploadedByCaregiverId: caregiverId,
        photoData: TINY_PNG_BASE64, mimeType: "image/png", sizeBytes: 100,
        extractedFields: { name: "Paracetamol", concentration: "500mg", form: "comprimido", posologyText: null },
        confidence: { name: 0.9, concentration: 0.85, form: 0.7, posologyText: 0 },
      })
      .returning();

    const [after] = await db.select({ n: count() }).from(treatmentsTable);
    const [afterMeds] = await db.select({ n: count() }).from(medicationsTable);
    assert.equal(after.n, before.n, "inserir uma extração não pode criar tratamento");
    assert.equal(afterMeds.n, beforeMeds.n, "inserir uma extração não pode criar medicamento");

    // Confirmar também não cria — só registra o que o cuidador manteve, pra calibração.
    const confirmRes = await api("POST", `/medication-photos/${extraction.id}/confirm`, {
      confirmedFields: { name: "Paracetamol", concentration: "500mg", form: "comprimido", posologyText: null },
      retainPhoto: false,
    });
    assert.equal(confirmRes.status, 200);

    const [afterConfirm] = await db.select({ n: count() }).from(treatmentsTable);
    assert.equal(afterConfirm.n, before.n, "confirmar a extração não cria tratamento — quem cria é POST /patients/:id/treatments, chamado à parte pelo formulário");

    await db.delete(photoExtractionsTable).where(eq(photoExtractionsTable.id, extraction.id));
  });

  it("confirmedFields fica nulo até o cuidador confirmar — resposta do modelo nunca é gravada sozinha", async () => {
    const [extraction] = await db
      .insert(photoExtractionsTable)
      .values({
        familyId, uploadedByCaregiverId: caregiverId,
        photoData: TINY_PNG_BASE64, mimeType: "image/png", sizeBytes: 100,
        extractedFields: { name: "Dipirona", concentration: "1g", form: "comprimido", posologyText: null },
        confidence: { name: 0.9, concentration: 0.9, form: 0.9, posologyText: 0 },
      })
      .returning();

    assert.equal(extraction.confirmedFields, null);
    assert.equal(extraction.status, "pending_confirmation");

    await db.delete(photoExtractionsTable).where(eq(photoExtractionsTable.id, extraction.id));
  });
});

describe("Descarte remove o arquivo de fato — ZELO-21", () => {
  it("POST /discard zera photoData/mimeType/sizeBytes no banco", async () => {
    const [extraction] = await db
      .insert(photoExtractionsTable)
      .values({
        familyId, uploadedByCaregiverId: caregiverId,
        photoData: TINY_PNG_BASE64, mimeType: "image/png", sizeBytes: 100,
        extractedFields: { name: "Losartana", concentration: "50mg", form: "comprimido", posologyText: null },
        confidence: { name: 0.8, concentration: 0.8, form: 0.8, posologyText: 0 },
      })
      .returning();
    assert.ok(extraction.photoData, "sanity check: a foto existe antes de descartar");

    const res = await api("POST", `/medication-photos/${extraction.id}/discard`);
    assert.equal(res.status, 200);

    const [afterDiscard] = await db.select().from(photoExtractionsTable).where(eq(photoExtractionsTable.id, extraction.id));
    assert.equal(afterDiscard.photoData, null, "photoData deve estar nulo — o arquivo foi removido de fato");
    assert.equal(afterDiscard.mimeType, null);
    assert.equal(afterDiscard.sizeBytes, null);
    assert.equal(afterDiscard.status, "discarded");

    await db.delete(photoExtractionsTable).where(eq(photoExtractionsTable.id, extraction.id));
  });

  it("confirmar com retainPhoto=false (padrão) também descarta o binário", async () => {
    const [extraction] = await db
      .insert(photoExtractionsTable)
      .values({
        familyId, uploadedByCaregiverId: caregiverId,
        photoData: TINY_PNG_BASE64, mimeType: "image/png", sizeBytes: 100,
        extractedFields: { name: "Omeprazol", concentration: "20mg", form: "cápsula", posologyText: null },
        confidence: { name: 0.9, concentration: 0.9, form: 0.9, posologyText: 0 },
      })
      .returning();

    await api("POST", `/medication-photos/${extraction.id}/confirm`, {
      confirmedFields: { name: "Omeprazol", concentration: "20mg", form: "cápsula", posologyText: null },
      // retainPhoto omitido — o padrão é descartar
    });

    const [afterConfirm] = await db.select().from(photoExtractionsTable).where(eq(photoExtractionsTable.id, extraction.id));
    assert.equal(afterConfirm.photoData, null, "padrão é descartar a foto ao confirmar, mesmo sem pedir discard explícito");
    assert.equal(afterConfirm.retained, false);

    await db.delete(photoExtractionsTable).where(eq(photoExtractionsTable.id, extraction.id));
  });

  it("confirmar com retainPhoto=true mantém o binário", async () => {
    const [extraction] = await db
      .insert(photoExtractionsTable)
      .values({
        familyId, uploadedByCaregiverId: caregiverId,
        photoData: TINY_PNG_BASE64, mimeType: "image/png", sizeBytes: 100,
        extractedFields: { name: "Metformina", concentration: "850mg", form: "comprimido", posologyText: null },
        confidence: { name: 0.9, concentration: 0.9, form: 0.9, posologyText: 0 },
      })
      .returning();

    await api("POST", `/medication-photos/${extraction.id}/confirm`, {
      confirmedFields: { name: "Metformina", concentration: "850mg", form: "comprimido", posologyText: null },
      retainPhoto: true,
    });

    const [afterConfirm] = await db.select().from(photoExtractionsTable).where(eq(photoExtractionsTable.id, extraction.id));
    assert.ok(afterConfirm.photoData, "cuidador pediu pra reter — a foto deve continuar existindo");
    assert.equal(afterConfirm.retained, true);

    await db.delete(photoExtractionsTable).where(eq(photoExtractionsTable.id, extraction.id));
  });
});

describe("Upload — validações que não precisam da API (rodam sempre)", () => {
  it("sem arquivo retorna 400 com mensagem calma", async () => {
    const res = await new Promise<{ status: number; body: unknown }>((resolve, reject) => {
      const req = http.request(
        { hostname: "127.0.0.1", port: testPort, path: "/api/medication-photos/extract", method: "POST", headers: { Authorization: `Bearer ${token}` } },
        (r) => {
          let data = "";
          r.on("data", (c: Buffer) => (data += c.toString()));
          r.on("end", () => resolve({ status: r.statusCode ?? 0, body: JSON.parse(data || "{}") }));
        }
      );
      req.on("error", reject);
      req.end();
    });
    assert.equal(res.status, 400);
  });
});

describe("Extração real via Claude Vision — precisa de ANTHROPIC_API_KEY", () => {
  it("foto ilegível (sem texto) não trava — volta campos vazios com confiança baixa, ou 422 calmo", async (t) => {
    if (!process.env.ANTHROPIC_API_KEY) {
      t.skip("ANTHROPIC_API_KEY não configurada neste ambiente local — roda de verdade onde a chave existir (Replit)");
      return;
    }

    const res = await uploadPhoto(TINY_PNG_BASE64, "image/png");
    // Ou extrai com tudo vazio/baixa confiança, ou falha com 422 calmo — os
    // dois são "não travou". O que não pode acontecer é 500 ou timeout.
    assert.ok(res.status === 201 || res.status === 422, `esperava 201 ou 422, recebeu ${res.status}`);

    if (res.status === 201) {
      const body = res.body as { extractionId: number; fields: Record<string, unknown>; confidence: Record<string, number> };
      assert.ok(body.extractionId > 0);
      await db.delete(photoExtractionsTable).where(eq(photoExtractionsTable.id, body.extractionId));
    }
  });
});
