/**
 * Recado do paciente, em áudio — QUI-8.
 *
 * O lado que nenhum concorrente faz: a pessoa cuidada manda um recado do
 * aparelho DELA, sem digitar nada.
 *
 * O núcleo destes testes é NEGATIVO, no mesmo rigor da ZELO-58: provar que a
 * terceira rota do token de paciente continua sendo **só a terceira** —
 * que ela não alcança outro paciente, não vira sessão de cuidador, e que o
 * caminho inverso também não existe.
 */
import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  usersTable, caregiversTable, familiesTable, patientsTable,
  mediaAssetsTable, consentRecordsTable, patientAccessTokensTable,
} from "@workspace/db";
import { generateAccessToken, generateOneTimeToken, hashToken } from "../lib/tokens.ts";
import { hashPassword } from "../lib/password.ts";
import { boss } from "../lib/queue.ts";
import { Clock } from "../lib/clock.ts";
import app from "../app.ts";

let testPort: number;
let closeServer: () => Promise<void>;
let familyId: number;
let patientId: number;
let outroPatientId: number;      // mesmo família, paciente diferente
let principalUserId: number;
let caregiverId: number;
let token: string;               // cuidador principal
let patientToken: string;        // aparelho do paciente
let outroPatientToken: string;   // aparelho do OUTRO paciente

interface ApiResult { status: number; body: unknown }

const OGG_FALSO = Buffer.from("OggS recado ficticio", "ascii");
const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

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

function multipart(
  arquivo: { nome: string; tipo: string; bytes: Buffer },
  campos: Record<string, string> = {}
): { boundary: string; body: Buffer } {
  const boundary = `----zelo${crypto.randomBytes(8).toString("hex")}`;
  const partes: Buffer[] = [];
  for (const [chave, valor] of Object.entries(campos)) {
    partes.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${chave}"\r\n\r\n${valor}\r\n`));
  }
  partes.push(Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="arquivo"; filename="${arquivo.nome}"\r\n` +
    `Content-Type: ${arquivo.tipo}\r\n\r\n`
  ));
  partes.push(arquivo.bytes);
  partes.push(Buffer.from(`\r\n--${boundary}--\r\n`));
  return { boundary, body: Buffer.concat(partes) };
}

/** Envia como PACIENTE — header X-Patient-Access, nunca Authorization. */
async function mandarRecado(
  arquivo = { nome: "recado.ogg", tipo: "audio/ogg", bytes: OGG_FALSO },
  acesso = patientToken,
  campos: Record<string, string> = {}
): Promise<ApiResult> {
  const { boundary, body } = multipart(arquivo, campos);
  return json(await bruto("POST", "/patient-access/momento", body, {
    "X-Patient-Access": acesso,
    "Content-Type": `multipart/form-data; boundary=${boundary}`,
  }));
}

async function api(method: string, path: string, authToken = token): Promise<ApiResult> {
  return json(await bruto(method, path, undefined, {
    Authorization: `Bearer ${authToken}`,
    "Content-Type": "application/json",
  }));
}

/** Cria e ativa um aparelho de paciente, devolvendo o token de dispositivo. */
async function ativarAparelho(alvo: number): Promise<string> {
  const { raw, hash } = generateOneTimeToken();
  await db.insert(patientAccessTokensTable).values({
    patientId: alvo, familyId, createdByCaregiverId: caregiverId,
    tokenHash: hash, status: "pending",
    expiresAt: new Date(Clock.now().getTime() + 86_400_000),
  });
  const r = json(await bruto("POST", "/patient-access/activate", Buffer.from(JSON.stringify({ token: raw })), {
    "Content-Type": "application/json",
  }));
  assert.equal(r.status, 200, `ativação deveria dar 200, deu ${r.status}: ${JSON.stringify(r.body)}`);
  return (r.body as { accessToken: string }).accessToken;
}

async function darConsentimento(alvo: number): Promise<void> {
  await db.insert(consentRecordsTable).values({
    userId: principalUserId, patientId: alvo, givenBy: "legal_representative",
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
    .values({ name: "Família Fictícia Recado", slug: `recado-${marca}` }).returning();
  familyId = family.id;

  const [user] = await db.insert(usersTable).values({
    email: `recado-${marca}@zelo.test`, name: "Ana Fictícia",
    passwordHash: await hashPassword("x"), emailVerified: true, status: "active",
  }).returning();
  const [caregiver] = await db.insert(caregiversTable)
    .values({ familyId, userId: user.id, name: "Ana Fictícia", role: "primary_caregiver" }).returning();
  principalUserId = user.id;
  caregiverId = caregiver.id;
  token = generateAccessToken(user.id, familyId, caregiver.id, "primary_caregiver");

  const [patient] = await db.insert(patientsTable)
    .values({ familyId, name: "Dona Maria Teste", timezone: "America/Sao_Paulo", elderModeEnabled: true }).returning();
  patientId = patient.id;

  const [outro] = await db.insert(patientsTable)
    .values({ familyId, name: "Seu João Teste", timezone: "America/Sao_Paulo", elderModeEnabled: true }).returning();
  outroPatientId = outro.id;

  patientToken = await ativarAparelho(patientId);
  outroPatientToken = await ativarAparelho(outroPatientId);
});

beforeEach(async () => {
  await db.delete(mediaAssetsTable).where(eq(mediaAssetsTable.patientId, patientId));
  await db.delete(mediaAssetsTable).where(eq(mediaAssetsTable.patientId, outroPatientId));
  await db.delete(consentRecordsTable).where(eq(consentRecordsTable.patientId, patientId));
});

after(async () => {
  Clock.reset();
  await closeServer();
  await boss.stop({ graceful: false });
  await db.delete(familiesTable).where(eq(familiesTable.id, familyId));
});

describe("O paciente manda um recado", () => {
  it("áudio sobe e fica atribuído ao PACIENTE, não a um cuidador", async () => {
    const r = await mandarRecado();
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal((r.body as { kind: string }).kind, "audio");

    const [linha] = await db.select().from(mediaAssetsTable).where(eq(mediaAssetsTable.patientId, patientId));
    assert.equal(linha.uploadedByCaregiverId, null, "recado do paciente não pode ficar no nome de um cuidador");
    assert.equal(linha.kind, "audio");
  });

  it("o recado aparece no mural da família, com o nome do paciente", async () => {
    await darConsentimento(patientId);
    await mandarRecado();

    const r = await api("GET", `/patients/${patientId}/momentos`);
    const mural = r.body as { momentos: Array<{ kind: string; autor: string }> };
    assert.equal(mural.momentos.length, 1);
    assert.equal(mural.momentos[0].kind, "audio");
    assert.equal(mural.momentos[0].autor, "Dona Maria Teste");
  });

  it("áudio NÃO exige consentimento de imagem — voz não é imagem", async () => {
    // Sem nenhum consentimento registrado (o beforeEach limpou).
    const r = await mandarRecado();
    assert.equal(
      r.status, 201,
      "exigir consentimento de imagem para áudio bloquearia o único canal que funciona para quem não enxerga bem"
    );
  });

  it("foto pelo aparelho do paciente EXIGE consentimento de imagem", async () => {
    const semConsentimento = await mandarRecado({ nome: "f.png", tipo: "image/png", bytes: PNG_1X1 });
    assert.equal(semConsentimento.status, 403);
    assert.equal((semConsentimento.body as { code: string }).code, "IMAGE_CONSENT_REQUIRED");

    await darConsentimento(patientId);
    const comConsentimento = await mandarRecado({ nome: "f.png", tipo: "image/png", bytes: PNG_1X1 });
    assert.equal(comConsentimento.status, 201);
  });

  it("formato fora do allowlist é recusado com 415", async () => {
    const r = await mandarRecado({ nome: "x.txt", tipo: "text/plain", bytes: Buffer.from("oi") });
    assert.equal(r.status, 415);
  });

  it("áudio acima de 1 MB é recusado com 413", async () => {
    const grande = crypto.randomBytes(1_200_000);
    const r = await mandarRecado({ nome: "longo.ogg", tipo: "audio/ogg", bytes: grande });
    assert.equal(r.status, 413);
    assert.equal((r.body as { code: string }).code, "MEDIA_TOO_LARGE");
  });

  it("sem arquivo, 400", async () => {
    const boundary = `----zelo${crypto.randomBytes(8).toString("hex")}`;
    const body = Buffer.from(`--${boundary}--\r\n`);
    const r = json(await bruto("POST", "/patient-access/momento", body, {
      "X-Patient-Access": patientToken,
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
    }));
    assert.equal(r.status, 400);
  });
});

describe("O token do paciente publica SÓ no próprio mural", () => {
  it("mandar patientId no corpo NÃO redireciona o recado", async () => {
    // O aparelho tenta apontar para o outro paciente. A rota nem lê esse
    // campo — o paciente vem do token.
    const r = await mandarRecado(undefined, patientToken, { patientId: String(outroPatientId) });
    assert.equal(r.status, 201);

    const doOutro = await db.select().from(mediaAssetsTable).where(eq(mediaAssetsTable.patientId, outroPatientId));
    assert.equal(doOutro.length, 0, "o corpo da requisição não pode escolher o paciente");

    const doDono = await db.select().from(mediaAssetsTable).where(eq(mediaAssetsTable.patientId, patientId));
    assert.equal(doDono.length, 1);
  });

  it("cada aparelho publica no seu, e um não vê o do outro", async () => {
    await mandarRecado(undefined, patientToken);
    await mandarRecado(undefined, outroPatientToken);

    const a = await db.select().from(mediaAssetsTable).where(eq(mediaAssetsTable.patientId, patientId));
    const b = await db.select().from(mediaAssetsTable).where(eq(mediaAssetsTable.patientId, outroPatientId));
    assert.equal(a.length, 1);
    assert.equal(b.length, 1);
    assert.notEqual(a[0].id, b[0].id);
  });
});

describe("O token do paciente NÃO vira sessão de cuidador", () => {
  const rotasDeCuidador: Array<[string, string]> = [
    ["POST", "/media"],
    ["GET", "/media/1/link"],
    ["DELETE", "/media/1"],
    ["GET", "/patients"],
  ];

  for (const [metodo, caminho] of rotasDeCuidador) {
    it(`${metodo} ${caminho} recusa o token de paciente`, async () => {
      // Mandado no header de CUIDADOR, que é a tentativa mais óbvia.
      const r = json(await bruto(metodo, caminho, undefined, {
        Authorization: `Bearer ${patientToken}`,
        "Content-Type": "application/json",
      }));
      assert.equal(r.status, 401, "token de dispositivo não é JWT e não pode passar por requireAuth");
    });
  }

  it("o mural do próprio paciente também não abre pelo token dele", async () => {
    // Ler o mural é rota de CUIDADOR. O paciente manda recado; quem vê o
    // mural é a família.
    const r = json(await bruto("GET", `/patients/${patientId}/momentos`, undefined, {
      "X-Patient-Access": patientToken,
    }));
    assert.equal(r.status, 401);
  });
});

describe("O caminho inverso também não existe", () => {
  it("o JWT do cuidador NÃO abre a rota do paciente", async () => {
    const { boundary, body } = multipart({ nome: "r.ogg", tipo: "audio/ogg", bytes: OGG_FALSO });
    const r = json(await bruto("POST", "/patient-access/momento", body, {
      Authorization: `Bearer ${token}`,
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
    }));
    assert.equal(r.status, 401, "cada middleware lê um header diferente — não há confusão possível");
    assert.equal((r.body as { code: string }).code, "PATIENT_ACCESS_MISSING");
  });

  it("o JWT do cuidador mandado no header do PACIENTE também não passa", async () => {
    const r = await mandarRecado(undefined, token);
    assert.equal(r.status, 401);
    assert.equal((r.body as { code: string }).code, "PATIENT_ACCESS_INVALID");
  });
});

describe("Revogar derruba o recado na requisição seguinte", () => {
  it("aparelho revogado recebe 401", async () => {
    const descartavel = await ativarAparelho(patientId);
    assert.equal((await mandarRecado(undefined, descartavel)).status, 201);

    await db.update(patientAccessTokensTable)
      .set({ status: "revoked" })
      .where(eq(patientAccessTokensTable.tokenHash, hashToken(descartavel)));

    const r = await mandarRecado(undefined, descartavel);
    assert.equal(r.status, 401);
    assert.equal((r.body as { code: string }).code, "PATIENT_ACCESS_INVALID");
  });

  it("token de link ainda não ativado não serve como credencial", async () => {
    const { raw, hash } = generateOneTimeToken();
    await db.insert(patientAccessTokensTable).values({
      patientId, familyId, createdByCaregiverId: caregiverId,
      tokenHash: hash, status: "pending",
      expiresAt: new Date(Clock.now().getTime() + 86_400_000),
    });

    const r = await mandarRecado(undefined, raw);
    assert.equal(r.status, 401, "'pending' é um link, não uma credencial");
  });

  it("sem header nenhum, 401", async () => {
    const { boundary, body } = multipart({ nome: "r.ogg", tipo: "audio/ogg", bytes: OGG_FALSO });
    const r = json(await bruto("POST", "/patient-access/momento", body, {
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
    }));
    assert.equal(r.status, 401);
    assert.equal((r.body as { code: string }).code, "PATIENT_ACCESS_MISSING");
  });

  it("token inventado, 401", async () => {
    const r = await mandarRecado(undefined, crypto.randomBytes(32).toString("hex"));
    assert.equal(r.status, 401);
  });
});

describe("O cuidador continua no controle", () => {
  it("o cuidador principal apaga o recado do paciente", async () => {
    const enviado = await mandarRecado();
    const id = (enviado.body as { id: number }).id;
    const r = await api("DELETE", `/media/${id}`);
    assert.equal(r.status, 204);
  });

  it("revogar o consentimento de imagem NÃO apaga o recado em áudio", async () => {
    await darConsentimento(patientId);
    await mandarRecado();
    await mandarRecado({ nome: "f.png", tipo: "image/png", bytes: PNG_1X1 });

    const r = json(await bruto("POST", `/patients/${patientId}/image-consent`,
      Buffer.from(JSON.stringify({ consentGiven: false, version: "v1.0", givenBy: "legal_representative" })),
      { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }
    ));
    assert.equal(r.status, 201);

    const restantes = await db.select().from(mediaAssetsTable).where(eq(mediaAssetsTable.patientId, patientId));
    assert.equal(restantes.length, 1, "só a foto deveria ter sido apagada");
    assert.equal(restantes[0].kind, "audio", "a voz da pessoa não é coberta pelo consentimento de imagem");
  });
});
