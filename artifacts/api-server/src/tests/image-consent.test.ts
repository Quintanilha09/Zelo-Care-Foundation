/**
 * Consentimento de imagem — QUI-6.
 *
 * Esta é a história de MAIOR RISCO do projeto Momentos, e o refinamento diz
 * por quê: o mesmo recurso pode proteger o paciente (prova de bom cuidado)
 * ou expô-lo (vigilância de alguém que não pode consentir de verdade). O
 * que separa os dois é o rigor daqui.
 *
 * Os quatro pontos que estes testes existem para provar:
 *   1. sem consentimento, não sobe foto — e o padrão é NÃO ter consentimento
 *   2. consentir com dado de saúde NÃO libera imagem — os dois caminhos
 *   3. revogar APAGA o que já existe, do bucket, não só do banco
 *   4. a trilha de auditoria registra quem consentiu, em que papel, e quando
 *      revogou
 */
import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import crypto from "node:crypto";
import { and, eq, desc, gt } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  usersTable, caregiversTable, familiesTable, patientsTable,
  mediaAssetsTable, consentRecordsTable, auditLogTable,
} from "@workspace/db";
import { generateAccessToken } from "../lib/tokens.ts";
import { hashPassword } from "../lib/password.ts";
import { boss } from "../lib/queue.ts";
import { Clock } from "../lib/clock.ts";
import { obterArmazenamento } from "../lib/media-storage.ts";
import { lerEstadoDoConsentimento } from "../lib/image-consent.ts";
import app from "../app.ts";

let testPort: number;
let closeServer: () => Promise<void>;
let familyId: number;
let patientId: number;
let token: string;           // cuidador principal
let principalUserId: number;
let comumToken: string;      // cuidador comum, não principal
let otherFamilyId: number;
let otherPatientId: number;
let otherToken: string;

interface ApiResult { status: number; body: unknown }
interface BinResult { status: number; bytes: Buffer }

const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);
const OGG_FALSO = Buffer.from("OggS", "ascii");

async function bruto(
  method: string, path: string, corpo: Buffer | undefined, headers: Record<string, string>
): Promise<BinResult> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: "127.0.0.1", port: testPort, path: `/api${path}`, method,
        headers: { ...headers, ...(corpo ? { "Content-Length": corpo.length } : {}) },
      },
      (res) => {
        const pedacos: Buffer[] = [];
        res.on("data", (c: Buffer) => pedacos.push(c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, bytes: Buffer.concat(pedacos) }));
      }
    );
    req.on("error", reject);
    if (corpo) req.write(corpo);
    req.end();
  });
}

function comoJson(r: BinResult): ApiResult {
  const texto = r.bytes.toString("utf-8");
  try { return { status: r.status, body: JSON.parse(texto) }; }
  catch { return { status: r.status, body: texto }; }
}

async function api(method: string, path: string, corpo?: unknown, authToken = token): Promise<ApiResult> {
  const payload = corpo !== undefined ? Buffer.from(JSON.stringify(corpo)) : undefined;
  return comoJson(await bruto(method, path, payload, {
    Authorization: `Bearer ${authToken}`,
    "Content-Type": "application/json",
  }));
}

async function enviarMidia(
  arquivo: { nome: string; tipo: string; bytes: Buffer },
  alvo = patientId,
  authToken = token
): Promise<ApiResult> {
  const boundary = `----zelo${crypto.randomBytes(8).toString("hex")}`;
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="patientId"\r\n\r\n${alvo}\r\n`),
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="arquivo"; filename="${arquivo.nome}"\r\n` +
      `Content-Type: ${arquivo.tipo}\r\n\r\n`
    ),
    arquivo.bytes,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return comoJson(await bruto("POST", "/media", body, {
    Authorization: `Bearer ${authToken}`,
    "Content-Type": `multipart/form-data; boundary=${boundary}`,
  }));
}

const foto = { nome: "momento.png", tipo: "image/png", bytes: PNG_1X1 };
const audio = { nome: "recado.ogg", tipo: "audio/ogg", bytes: OGG_FALSO };

/** Concede o consentimento pela rota, como o cuidador principal faria. */
async function consentir(givenBy: "self" | "legal_representative" = "legal_representative"): Promise<ApiResult> {
  return api("POST", `/patients/${patientId}/image-consent`, {
    consentGiven: true, version: "v1.0", givenBy,
  });
}

async function revogar(): Promise<ApiResult> {
  return api("POST", `/patients/${patientId}/image-consent`, {
    consentGiven: false, version: "v1.0", givenBy: "legal_representative",
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
    .values({ name: "Família Fictícia Consentimento", slug: `consimg-${marca}` }).returning();
  familyId = family.id;

  const [user] = await db.insert(usersTable).values({
    email: `consimg-${marca}@zelo.test`, name: "Cuidador Principal Fictício",
    passwordHash: await hashPassword("x"), emailVerified: true, status: "active",
  }).returning();
  const [caregiver] = await db.insert(caregiversTable)
    .values({ familyId, userId: user.id, name: "Cuidador Principal Fictício", role: "primary_caregiver" }).returning();
  principalUserId = user.id;
  token = generateAccessToken(user.id, familyId, caregiver.id, "primary_caregiver");

  const [comum] = await db.insert(usersTable).values({
    email: `consimg-comum-${marca}@zelo.test`, name: "Cuidador Comum Fictício",
    passwordHash: await hashPassword("x"), emailVerified: true, status: "active",
  }).returning();
  const [comumCaregiver] = await db.insert(caregiversTable)
    .values({ familyId, userId: comum.id, name: "Cuidador Comum Fictício", role: "caregiver" }).returning();
  comumToken = generateAccessToken(comum.id, familyId, comumCaregiver.id, "caregiver");

  const [patient] = await db.insert(patientsTable)
    .values({ familyId, name: "Dona Maria Teste", timezone: "America/Sao_Paulo" }).returning();
  patientId = patient.id;

  const [outra] = await db.insert(familiesTable)
    .values({ name: "Outra Família Fictícia", slug: `consimg-outra-${marca}` }).returning();
  otherFamilyId = outra.id;
  const [outroUser] = await db.insert(usersTable).values({
    email: `consimg-outra-${marca}@zelo.test`, name: "Cuidador de Outra Família",
    passwordHash: await hashPassword("x"), emailVerified: true, status: "active",
  }).returning();
  const [outroCaregiver] = await db.insert(caregiversTable)
    .values({ familyId: otherFamilyId, userId: outroUser.id, name: "Cuidador de Outra Família", role: "primary_caregiver" }).returning();
  otherToken = generateAccessToken(outroUser.id, otherFamilyId, outroCaregiver.id, "primary_caregiver");
  const [outroPatient] = await db.insert(patientsTable)
    .values({ familyId: otherFamilyId, name: "Paciente de Outra Família", timezone: "America/Sao_Paulo" }).returning();
  otherPatientId = outroPatient.id;
});

// Cada caso começa do zero: sem consentimento e sem mídia. É o único jeito
// de "o padrão é NÃO ter consentimento" ser testado de verdade em vez de
// depender da ordem em que os casos rodam.
beforeEach(async () => {
  await db.delete(mediaAssetsTable).where(eq(mediaAssetsTable.patientId, patientId));
  await db.delete(consentRecordsTable).where(eq(consentRecordsTable.patientId, patientId));
});

after(async () => {
  Clock.reset();
  await closeServer();
  await boss.stop({ graceful: false });
  await db.delete(familiesTable).where(eq(familiesTable.id, familyId));
  await db.delete(familiesTable).where(eq(familiesTable.id, otherFamilyId));
});

describe("O padrão é NÃO ter consentimento", () => {
  it("paciente novo começa sem consentimento, e a rota diz isso", async () => {
    const r = await api("GET", `/patients/${patientId}/image-consent`);
    assert.equal(r.status, 200);
    const corpo = r.body as { consentido: boolean; jaDecidido: boolean; givenBy: string | null };
    assert.equal(corpo.consentido, false, "ausência de registro NÃO pode significar permissão");
    assert.equal(corpo.jaDecidido, false);
    assert.equal(corpo.givenBy, null);
  });

  it("sem consentimento, enviar foto responde 403 com motivo claro", async () => {
    const r = await enviarMidia(foto);
    assert.equal(r.status, 403);
    assert.equal((r.body as { code: string }).code, "IMAGE_CONSENT_REQUIRED");
  });

  it("sem consentimento, enviar vídeo também é recusado", async () => {
    const r = await enviarMidia({ nome: "v.mp4", tipo: "video/mp4", bytes: Buffer.from("mp4 falso") });
    assert.equal(r.status, 403);
    assert.equal((r.body as { code: string }).code, "IMAGE_CONSENT_REQUIRED");
  });

  it("nada foi gravado no bucket na tentativa recusada", async () => {
    await enviarMidia(foto);
    const linhas = await db.select().from(mediaAssetsTable).where(eq(mediaAssetsTable.patientId, patientId));
    assert.equal(linhas.length, 0, "recusa tem que acontecer ANTES de gravar qualquer byte");
  });
});

describe("Consentir com dado de saúde NÃO libera imagem", () => {
  it("os dois caminhos são independentes", async () => {
    // Consentimento de SAÚDE deste paciente — é exatamente o que a criação
    // do paciente grava (routes/patients.ts). Existe, é válido, é do mesmo
    // titular. E não vale para imagem.
    await db.insert(consentRecordsTable).values({
      userId: principalUserId,
      patientId,
      givenBy: "legal_representative",
      consentType: "health_data_processing",
      consentGiven: "true",
      version: "v1.0",
      ipAddress: "127.0.0.1",
    });

    const estado = await lerEstadoDoConsentimento(patientId);
    assert.equal(estado.consentido, false, "consentimento de saúde não pode contar como de imagem");

    const r = await enviarMidia(foto);
    assert.equal(r.status, 403);
    assert.equal((r.body as { code: string }).code, "IMAGE_CONSENT_REQUIRED");
  });

  it("e o contrário também: consentir imagem não cria consentimento de saúde", async () => {
    await consentir();
    const [saude] = await db
      .select()
      .from(consentRecordsTable)
      .where(and(
        eq(consentRecordsTable.patientId, patientId),
        eq(consentRecordsTable.consentType, "health_data_processing")
      ))
      .orderBy(desc(consentRecordsTable.id))
      .limit(1);
    assert.equal(saude, undefined, "registrar imagem não pode gravar consentimento de saúde por tabela");
  });
});

describe("Áudio não é imagem", () => {
  it("sem consentimento de imagem, o áudio continua permitido", async () => {
    const r = await enviarMidia(audio);
    assert.equal(
      r.status, 201,
      "voz não é imagem: exigir consentimento de imagem bloquearia o recado do paciente sem motivo"
    );
  });

  it("revogar a imagem não apaga o áudio", async () => {
    await consentir();
    const audioEnviado = await enviarMidia(audio);
    const fotoEnviada = await enviarMidia(foto);
    assert.equal(audioEnviado.status, 201);
    assert.equal(fotoEnviada.status, 201);

    await revogar();

    const restantes = await db.select().from(mediaAssetsTable).where(eq(mediaAssetsTable.patientId, patientId));
    assert.equal(restantes.length, 1, "só a foto deveria ter sido apagada");
    assert.equal(restantes[0].kind, "audio");
  });
});

describe("Conceder", () => {
  it("cuidador principal concede, e a foto passa a subir", async () => {
    const c = await consentir("self");
    assert.equal(c.status, 201);
    assert.equal((c.body as { consentido: boolean }).consentido, true);

    const r = await enviarMidia(foto);
    assert.equal(r.status, 201);
  });

  it("o estado passa a dizer quem consentiu e em que papel", async () => {
    await consentir("self");
    const r = await api("GET", `/patients/${patientId}/image-consent`);
    const corpo = r.body as { consentido: boolean; givenBy: string; version: string; jaDecidido: boolean };
    assert.equal(corpo.consentido, true);
    assert.equal(corpo.givenBy, "self");
    assert.equal(corpo.version, "v1.0");
    assert.equal(corpo.jaDecidido, true);
  });

  it("cuidador NÃO principal não decide — 403", async () => {
    const r = await api("POST", `/patients/${patientId}/image-consent`, {
      consentGiven: true, version: "v1.0", givenBy: "self",
    }, comumToken);
    assert.equal(r.status, 403);
  });

  it("cuidador comum ainda LÊ o estado, e a resposta diz que ele não pode decidir", async () => {
    const r = await api("GET", `/patients/${patientId}/image-consent`, undefined, comumToken);
    assert.equal(r.status, 200);
    assert.equal((r.body as { podeDecidir: boolean }).podeDecidir, false);
  });

  it("sem givenBy, recusa — 'quem está consentindo' não tem valor padrão", async () => {
    const r = await api("POST", `/patients/${patientId}/image-consent`, {
      consentGiven: true, version: "v1.0",
    });
    assert.equal(r.status, 400);
    assert.equal((r.body as { code: string }).code, "IMAGE_CONSENT_INVALID");
  });

  it("sem versão do termo, recusa — é a prova de QUAL texto foi aceito", async () => {
    const r = await api("POST", `/patients/${patientId}/image-consent`, {
      consentGiven: true, givenBy: "self",
    });
    assert.equal(r.status, 400);
  });

  it("paciente de outra família — 404, nunca 403", async () => {
    const r = await api("POST", `/patients/${otherPatientId}/image-consent`, {
      consentGiven: true, version: "v1.0", givenBy: "self",
    });
    assert.equal(r.status, 404, "responder 403 confirmaria que o paciente existe");
  });

  it("cuidador de outra família não lê o estado deste paciente — 404", async () => {
    const r = await api("GET", `/patients/${patientId}/image-consent`, undefined, otherToken);
    assert.equal(r.status, 404);
  });
});

describe("Revogar apaga o que já existe", () => {
  it("revogar remove as fotos do BUCKET, não só do banco", async () => {
    await consentir();
    const a = await enviarMidia(foto);
    const b = await enviarMidia(foto);
    assert.equal(a.status, 201);
    assert.equal(b.status, 201);

    const linhas = await db.select().from(mediaAssetsTable).where(eq(mediaAssetsTable.patientId, patientId));
    assert.equal(linhas.length, 2);

    const armazenamento = obterArmazenamento();
    assert.ok(armazenamento);
    for (const linha of linhas) {
      assert.equal(await armazenamento.existe(linha.objectKey), true, "os objetos precisam existir antes");
    }

    const r = await revogar();
    assert.equal(r.status, 201);
    assert.equal((r.body as { midiasApagadas: number }).midiasApagadas, 2);

    const restantes = await db.select().from(mediaAssetsTable).where(eq(mediaAssetsTable.patientId, patientId));
    assert.equal(restantes.length, 0, "as linhas têm que sumir");
    for (const linha of linhas) {
      assert.equal(
        await armazenamento.existe(linha.objectKey),
        false,
        "revogar sem apagar o arquivo não é revogar — é promessa"
      );
    }
  });

  it("depois de revogar, enviar foto volta a ser 403", async () => {
    await consentir();
    assert.equal((await enviarMidia(foto)).status, 201);
    await revogar();
    const r = await enviarMidia(foto);
    assert.equal(r.status, 403);
    assert.equal((r.body as { code: string }).code, "IMAGE_CONSENT_REQUIRED");
  });

  it("dá para consentir de novo depois de revogar, e volta a funcionar", async () => {
    await consentir();
    await revogar();
    await consentir();
    assert.equal((await enviarMidia(foto)).status, 201);
  });

  it("o histórico inteiro fica no banco — a tabela é imutável", async () => {
    await consentir("self");
    await revogar();
    await consentir("legal_representative");

    const historico = await db
      .select({ consentGiven: consentRecordsTable.consentGiven, givenBy: consentRecordsTable.givenBy })
      .from(consentRecordsTable)
      .where(and(
        eq(consentRecordsTable.patientId, patientId),
        eq(consentRecordsTable.consentType, "image_capture")
      ))
      .orderBy(consentRecordsTable.id);

    assert.deepEqual(
      historico,
      [
        { consentGiven: "true", givenBy: "self" },
        { consentGiven: "false", givenBy: "legal_representative" },
        { consentGiven: "true", givenBy: "legal_representative" },
      ],
      "revogar é INSERT, nunca UPDATE — o histórico é a prova para a ANPD"
    );
  });
});

describe("Trilha de auditoria", () => {
  it("registra conceder e revogar, com quem e em que papel", async () => {
    // A trilha é IMUTÁVEL — o beforeEach não consegue limpá-la, e nem
    // deveria. Então marcamos onde ela estava e olhamos só o que veio
    // depois; sem isso, este caso leria os eventos de todos os anteriores.
    const [antes] = await db
      .select({ id: auditLogTable.id })
      .from(auditLogTable)
      .orderBy(desc(auditLogTable.id))
      .limit(1);
    const marcador = antes?.id ?? 0;

    await consentir("self");
    await revogar();

    const trilha = await db
      .select({ action: auditLogTable.action, actorType: auditLogTable.actorType, diff: auditLogTable.diff })
      .from(auditLogTable)
      .where(and(
        eq(auditLogTable.entityType, "image_consent"),
        eq(auditLogTable.entityId, String(patientId)),
        gt(auditLogTable.id, marcador)
      ))
      .orderBy(auditLogTable.id);

    // A tabela de consentimento só cresce, então os dois eventos entram como
    // "created". Quem distingue concessão de revogação é o `consentGiven` do
    // diff — ver a nota em routes/image-consent.ts.
    const decisoes = trilha.map((t) => JSON.parse(t.diff ?? "{}") as { consentGiven?: boolean; givenBy?: string });
    assert.deepEqual(
      decisoes.map((d) => d.consentGiven),
      [true, false],
      "a trilha tem que registrar a concessão E a revogação, nessa ordem"
    );
    assert.equal(decisoes[0].givenBy, "self", "a trilha precisa dizer EM QUE PAPEL se consentiu");
    assert.equal(decisoes[1].givenBy, "legal_representative");
    assert.equal(trilha[0].actorType, "caregiver");
  });

  it("a trilha não carrega nome de paciente nem dado de saúde", async () => {
    await consentir();
    const trilha = await db
      .select({ diff: auditLogTable.diff })
      .from(auditLogTable)
      .where(and(
        eq(auditLogTable.entityType, "image_consent"),
        eq(auditLogTable.entityId, String(patientId))
      ));
    for (const linha of trilha) {
      assert.ok(!(linha.diff ?? "").includes("Maria"), "CON-008: nada que identifique o paciente na trilha");
    }
  });
});
