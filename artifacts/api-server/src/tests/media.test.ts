/**
 * Fundação de mídia — QUI-5.
 *
 * O núcleo destes testes é de SEGURANÇA e de INTEGRIDADE, não de recurso:
 * a história não tem tela, então o que ela precisa provar é que o arquivo
 * sobe, é servido só por link válido, não cruza família, e some de verdade
 * quando alguém manda apagar.
 *
 * Os quatro pontos que mais importam:
 *   1. o link expira — de verdade, com o relógio andando
 *   2. cuidador de outra família não alcança a mídia (404, nunca 403)
 *   3. apagar remove o OBJETO, não só a linha
 *   4. o token de mídia e o token de sessão não se confundem nos dois sentidos
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  usersTable, caregiversTable, familiesTable, patientsTable, mediaAssetsTable,
} from "@workspace/db";
import { generateAccessToken, verifyAccessToken } from "../lib/tokens.ts";
import { hashPassword } from "../lib/password.ts";
import { boss } from "../lib/queue.ts";
import { Clock } from "../lib/clock.ts";
import { obterArmazenamento, novaChaveDeObjeto } from "../lib/media-storage.ts";
import {
  gerarTokenDeMidia, lerTokenDeMidia, VALIDADE_DO_LINK_SEGUNDOS,
} from "../lib/media-links.ts";
import app from "../app.ts";

let testPort: number;
let closeServer: () => Promise<void>;
let familyId: number;
let patientId: number;
let token: string;
let otherFamilyId: number;
let otherPatientId: number;
let otherToken: string;

interface ApiResult { status: number; body: unknown }
interface BinResult { status: number; headers: http.IncomingHttpHeaders; bytes: Buffer }

/** PNG mínimo de verdade — 1x1, para o MIME não ser mentira. */
const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

function multipart(
  campos: Record<string, string>,
  arquivo: { nome: string; tipo: string; bytes: Buffer } | null
): { boundary: string; body: Buffer } {
  const boundary = `----zelo${crypto.randomBytes(8).toString("hex")}`;
  const partes: Buffer[] = [];
  // Os campos vêm ANTES do arquivo de propósito: o multer preenche req.body
  // na ordem em que as partes chegam, e patientId precisa existir quando o
  // handler roda.
  for (const [chave, valor] of Object.entries(campos)) {
    partes.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${chave}"\r\n\r\n${valor}\r\n`
    ));
  }
  if (arquivo) {
    partes.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="arquivo"; filename="${arquivo.nome}"\r\n` +
      `Content-Type: ${arquivo.tipo}\r\n\r\n`
    ));
    partes.push(arquivo.bytes);
    partes.push(Buffer.from("\r\n"));
  }
  partes.push(Buffer.from(`--${boundary}--\r\n`));
  return { boundary, body: Buffer.concat(partes) };
}

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
        res.on("end", () => resolve({
          status: res.statusCode ?? 0, headers: res.headers, bytes: Buffer.concat(pedacos),
        }));
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

async function api(method: string, path: string, authToken = token): Promise<ApiResult> {
  return comoJson(await bruto(method, path, undefined, { Authorization: `Bearer ${authToken}` }));
}

async function enviar(
  arquivo: { nome: string; tipo: string; bytes: Buffer } | null,
  campos: Record<string, string>,
  authToken = token
): Promise<ApiResult> {
  const { boundary, body } = multipart(campos, arquivo);
  return comoJson(await bruto("POST", "/media", body, {
    Authorization: `Bearer ${authToken}`,
    "Content-Type": `multipart/form-data; boundary=${boundary}`,
  }));
}

/** Envia uma foto válida e devolve o que a rota respondeu. */
async function enviarFoto(): Promise<{ id: number; url: string }> {
  const r = await enviar(
    { nome: "momento.png", tipo: "image/png", bytes: PNG_1X1 },
    { patientId: String(patientId) }
  );
  assert.equal(r.status, 201, `envio deveria dar 201, deu ${r.status}: ${JSON.stringify(r.body)}`);
  return r.body as { id: number; url: string };
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
    .values({ name: "Família Fictícia Mídia", slug: `midia-${marca}` }).returning();
  familyId = family.id;
  const [user] = await db.insert(usersTable).values({
    email: `midia-${marca}@zelo.test`, name: "Cuidador Fictício",
    passwordHash: await hashPassword("x"), emailVerified: true, status: "active",
  }).returning();
  const [caregiver] = await db.insert(caregiversTable)
    .values({ familyId, userId: user.id, name: "Cuidador Fictício", role: "primary_caregiver" }).returning();
  token = generateAccessToken(user.id, familyId, caregiver.id, "primary_caregiver");
  const [patient] = await db.insert(patientsTable)
    .values({ familyId, name: "Dona Maria Teste", timezone: "America/Sao_Paulo" }).returning();
  patientId = patient.id;

  const [outra] = await db.insert(familiesTable)
    .values({ name: "Outra Família Fictícia", slug: `midia-outra-${marca}` }).returning();
  otherFamilyId = outra.id;
  const [outroUser] = await db.insert(usersTable).values({
    email: `midia-outra-${marca}@zelo.test`, name: "Cuidador de Outra Família",
    passwordHash: await hashPassword("x"), emailVerified: true, status: "active",
  }).returning();
  const [outroCaregiver] = await db.insert(caregiversTable)
    .values({ familyId: otherFamilyId, userId: outroUser.id, name: "Cuidador de Outra Família", role: "primary_caregiver" }).returning();
  otherToken = generateAccessToken(outroUser.id, otherFamilyId, outroCaregiver.id, "primary_caregiver");
  const [outroPatient] = await db.insert(patientsTable)
    .values({ familyId: otherFamilyId, name: "Paciente de Outra Família", timezone: "America/Sao_Paulo" }).returning();
  otherPatientId = outroPatient.id;
});

after(async () => {
  Clock.reset();
  await closeServer();
  await boss.stop({ graceful: false });
  await db.delete(familiesTable).where(eq(familiesTable.id, familyId));
  await db.delete(familiesTable).where(eq(familiesTable.id, otherFamilyId));
});

describe("Enviar", () => {
  it("sobe uma foto, cataloga e devolve link — e o BINÁRIO não está no banco", async () => {
    const enviada = await enviarFoto();

    const [linha] = await db.select().from(mediaAssetsTable).where(eq(mediaAssetsTable.id, enviada.id));
    assert.equal(linha.familyId, familyId);
    assert.equal(linha.patientId, patientId);
    assert.equal(linha.kind, "image");
    assert.equal(linha.mimeType, "image/png");
    assert.equal(linha.sizeBytes, PNG_1X1.length);

    // Nenhuma coluna pode conter os bytes, nem em base64. É a diferença
    // entre esta tabela e photo_extractions.photo_data.
    const base64 = PNG_1X1.toString("base64");
    for (const valor of Object.values(linha)) {
      if (typeof valor !== "string") continue;
      assert.ok(!valor.includes(base64), "nenhuma coluna pode guardar o binário da mídia");
    }
  });

  it("a chave do objeto é aleatória e não conta nada sobre o paciente", async () => {
    const enviada = await enviarFoto();
    const [linha] = await db.select().from(mediaAssetsTable).where(eq(mediaAssetsTable.id, enviada.id));

    assert.ok(!linha.objectKey.includes("Maria"), "a chave não pode conter o nome do paciente");

    // NÃO se testa "a chave não contém o id do paciente" por substring: um id
    // de um dígito aparece por acaso em quase todo hex de 64 caracteres, e o
    // teste falharia sem nada estar errado. A propriedade de verdade é
    // estrutural — prefixo do tipo e 32 bytes aleatórios, nada mais:
    assert.match(linha.objectKey, /\/image\/[0-9a-f]{64}$/);

    const outra = await enviarFoto();
    const [linha2] = await db.select().from(mediaAssetsTable).where(eq(mediaAssetsTable.id, outra.id));
    assert.notEqual(linha.objectKey, linha2.objectKey, "duas mídias nunca compartilham chave");
  });

  it("formato fora do allowlist é recusado com 415, não com 'faltou arquivo'", async () => {
    const r = await enviar(
      { nome: "evil.svg", tipo: "image/svg+xml", bytes: Buffer.from("<svg onload=alert(1)>") },
      { patientId: String(patientId) }
    );
    assert.equal(r.status, 415);
    assert.equal((r.body as { code: string }).code, "MEDIA_TYPE_REJECTED");
  });

  it("sem arquivo, 400", async () => {
    const r = await enviar(null, { patientId: String(patientId) });
    assert.equal(r.status, 400);
    assert.equal((r.body as { code: string }).code, "MEDIA_FILE_MISSING");
  });

  it("sem patientId, 400", async () => {
    const r = await enviar({ nome: "m.png", tipo: "image/png", bytes: PNG_1X1 }, {});
    assert.equal(r.status, 400);
    assert.equal((r.body as { code: string }).code, "PATIENT_ID_REQUIRED");
  });

  it("paciente de outra família — 404, nunca 403", async () => {
    const r = await enviar(
      { nome: "m.png", tipo: "image/png", bytes: PNG_1X1 },
      { patientId: String(otherPatientId) }
    );
    assert.equal(r.status, 404);
  });

  it("imagem acima do teto de 2 MB é recusada com 413", async () => {
    // O teto do multer é 8 MB (o do vídeo); este arquivo passa por ele e é
    // barrado pelo teto POR TIPO, que é o comportamento que importa.
    const grande = Buffer.concat([PNG_1X1, crypto.randomBytes(3 * 1024 * 1024)]);
    const r = await enviar(
      { nome: "grande.png", tipo: "image/png", bytes: grande },
      { patientId: String(patientId) }
    );
    assert.equal(r.status, 413);
    assert.equal((r.body as { code: string }).code, "MEDIA_TOO_LARGE");
  });

  it("sem sessão, 401", async () => {
    const { boundary, body } = multipart({ patientId: String(patientId) }, { nome: "m.png", tipo: "image/png", bytes: PNG_1X1 });
    const r = comoJson(await bruto("POST", "/media", body, {
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
    }));
    assert.equal(r.status, 401);
  });
});

describe("Ler pelo link assinado", () => {
  it("o link devolve exatamente os bytes enviados, com nosniff", async () => {
    const enviada = await enviarFoto();
    const r = await bruto("GET", enviada.url.replace(/^\/api/, ""), undefined, {});

    assert.equal(r.status, 200);
    assert.equal(r.headers["content-type"], "image/png");
    assert.equal(r.headers["x-content-type-options"], "nosniff");
    assert.match(String(r.headers["cache-control"]), /private/);
    assert.ok(r.bytes.equals(PNG_1X1), "os bytes de volta têm que ser os mesmos que subiram");
  });

  it("o link EXPIRA — depois da validade, 410", async () => {
    const enviada = await enviarFoto();

    const antes = await bruto("GET", enviada.url.replace(/^\/api/, ""), undefined, {});
    assert.equal(antes.status, 200, "antes de expirar, tem que abrir");

    Clock.advance((VALIDADE_DO_LINK_SEGUNDOS + 1) * 1000);
    const depois = comoJson(await bruto("GET", enviada.url.replace(/^\/api/, ""), undefined, {}));
    assert.equal(depois.status, 410, "depois da validade, o link não pode mais servir nada");
    Clock.reset();
  });

  it("token adulterado não abre", async () => {
    const enviada = await enviarFoto();
    const caminho = enviada.url.replace(/^\/api/, "");
    // Troca o id no corpo do token mantendo a assinatura: a assinatura
    // deixa de bater e o link morre.
    const adulterado = caminho.replace(/conteudo\/\d+/, "conteudo/999999");
    const r = comoJson(await bruto("GET", adulterado, undefined, {}));
    assert.equal(r.status, 410);
  });

  it("token de mídia de OUTRA mídia não serve a primeira", async () => {
    const a = await enviarFoto();
    const b = await enviarFoto();
    const tokenDeB = b.url.split("/").pop()!;
    const idDeA = lerTokenDeMidia(tokenDeB);
    assert.equal(idDeA, b.id, "o token carrega o id da mídia dele, e só dele");
    assert.notEqual(idDeA, a.id);
  });

  it("mídia cuja linha sumiu responde 404, não 500", async () => {
    const enviada = await enviarFoto();
    await db.delete(mediaAssetsTable).where(eq(mediaAssetsTable.id, enviada.id));
    const r = comoJson(await bruto("GET", enviada.url.replace(/^\/api/, ""), undefined, {}));
    assert.equal(r.status, 404);
  });
});

describe("Renovar o link", () => {
  it("o dono renova e o link novo funciona", async () => {
    const enviada = await enviarFoto();
    const r = await api("GET", `/media/${enviada.id}/link`);
    assert.equal(r.status, 200);
    const corpo = r.body as { url: string; expiraEm: string };
    const lido = await bruto("GET", corpo.url.replace(/^\/api/, ""), undefined, {});
    assert.equal(lido.status, 200);
  });

  it("cuidador de OUTRA família recebe 404 — não 403", async () => {
    const enviada = await enviarFoto();
    const r = await api("GET", `/media/${enviada.id}/link`, otherToken);
    assert.equal(r.status, 404, "responder 403 confirmaria que a mídia existe");
  });

  it("sem sessão, 401", async () => {
    const enviada = await enviarFoto();
    const r = comoJson(await bruto("GET", `/media/${enviada.id}/link`, undefined, {}));
    assert.equal(r.status, 401);
  });
});

describe("Apagar", () => {
  it("apagar remove a linha E o objeto do bucket", async () => {
    const enviada = await enviarFoto();
    const [linha] = await db.select().from(mediaAssetsTable).where(eq(mediaAssetsTable.id, enviada.id));

    const armazenamento = obterArmazenamento();
    assert.ok(armazenamento, "em teste sempre existe armazenamento (em memória)");
    assert.equal(await armazenamento.existe(linha.objectKey), true, "o objeto tem que existir antes");

    const r = await api("DELETE", `/media/${enviada.id}`);
    assert.equal(r.status, 204);

    const restantes = await db.select().from(mediaAssetsTable).where(eq(mediaAssetsTable.id, enviada.id));
    assert.equal(restantes.length, 0, "a linha tem que sumir");
    assert.equal(
      await armazenamento.existe(linha.objectKey),
      false,
      "apagar precisa remover o OBJETO, não só a linha — senão o arquivo pessoal continua existindo"
    );
  });

  it("cuidador de outra família não apaga — 404, e a mídia continua lá", async () => {
    const enviada = await enviarFoto();
    const r = await api("DELETE", `/media/${enviada.id}`, otherToken);
    assert.equal(r.status, 404);

    const restantes = await db.select().from(mediaAssetsTable).where(eq(mediaAssetsTable.id, enviada.id));
    assert.equal(restantes.length, 1, "a mídia não pode ter sido apagada por quem não é da família");
  });
});

describe("O token de mídia e o de sessão não se confundem", () => {
  it("token de mídia NÃO é aceito como sessão de cuidador", () => {
    const { token: midia } = gerarTokenDeMidia(1);
    assert.equal(
      verifyAccessToken(midia),
      null,
      "foi exatamente assim que ADMIN_PANEL_SECRET === SESSION_SECRET virou falha em 23/08"
    );
  });

  it("JWT de sessão NÃO é aceito como token de mídia", () => {
    assert.equal(lerTokenDeMidia(token), null);
  });

  it("token de mídia vale, e vira nulo ao expirar", () => {
    const { token: midia, expiraEm } = gerarTokenDeMidia(42);
    assert.equal(lerTokenDeMidia(midia), 42);
    assert.ok(expiraEm.getTime() > Clock.now().getTime());

    Clock.advance((VALIDADE_DO_LINK_SEGUNDOS + 1) * 1000);
    assert.equal(lerTokenDeMidia(midia), null);
    Clock.reset();
  });

  it("lixo não derruba o verificador", () => {
    for (const entrada of ["", "a", "a.b", "a.b.c", "1.2.3.4", "....", "1..x"]) {
      assert.equal(lerTokenDeMidia(entrada), null, `entrada ${JSON.stringify(entrada)} deveria dar null`);
    }
  });
});

describe("O armazenamento em si", () => {
  it("guardar, ler, apagar e conferir existência", async () => {
    const armazenamento = obterArmazenamento();
    assert.ok(armazenamento);
    const chave = novaChaveDeObjeto("audio");
    const bytes = crypto.randomBytes(128);

    assert.equal(await armazenamento.existe(chave), false);
    await armazenamento.guardar(chave, bytes, "audio/webm");
    assert.equal(await armazenamento.existe(chave), true);
    assert.ok((await armazenamento.ler(chave))?.equals(bytes));

    await armazenamento.apagar(chave);
    assert.equal(await armazenamento.existe(chave), false);
    assert.equal(await armazenamento.ler(chave), null);
  });

  it("apagar duas vezes não é erro — o expurgo por job precisa ser idempotente", async () => {
    const armazenamento = obterArmazenamento();
    assert.ok(armazenamento);
    const chave = novaChaveDeObjeto("image");
    await armazenamento.guardar(chave, PNG_1X1, "image/png");
    await armazenamento.apagar(chave);
    await armazenamento.apagar(chave);
  });

  it("cada tipo vai para o seu próprio prefixo", () => {
    assert.match(novaChaveDeObjeto("image"), /\/image\//);
    assert.match(novaChaveDeObjeto("video"), /\/video\//);
    assert.match(novaChaveDeObjeto("audio"), /\/audio\//);
  });
});
