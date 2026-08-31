/**
 * Momentos do paciente — QUI-7.
 *
 * A primeira história do projeto Momentos que entrega valor visível: um
 * filho em outra cidade abre o app e vê a mãe.
 *
 * O que estes testes provam, além do óbvio:
 *   1. o mural respeita o portão de consentimento da QUI-6
 *   2. a ordem é cronológica inversa, e o autor aparece
 *   3. **quem publicou apaga o seu; o cuidador principal apaga qualquer um**
 *      — e isso é conferido no SERVIDOR, não só no `podeApagar` da lista
 *   4. nada na resposta pode virar placar: sem total, sem contagem, sem
 *      "faz X dias sem foto" (CON-011, CON-012)
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
import { obterArmazenamento } from "../lib/media-storage.ts";
import app from "../app.ts";

let testPort: number;
let closeServer: () => Promise<void>;
let familyId: number;
let patientId: number;
let principalUserId: number;
let token: string;        // cuidador principal
let comumToken: string;   // cuidador comum
let _comumCaregiverId: number;
let otherFamilyId: number;
let otherToken: string;

interface ApiResult { status: number; body: unknown }

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

async function api(method: string, path: string, authToken = token): Promise<ApiResult> {
  const r = await bruto(method, path, undefined, {
    Authorization: `Bearer ${authToken}`,
    "Content-Type": "application/json",
  });
  try { return { status: r.status, body: JSON.parse(r.texto) }; }
  catch { return { status: r.status, body: r.texto }; }
}

async function publicar(legenda?: string, authToken = token): Promise<ApiResult> {
  const boundary = `----zelo${crypto.randomBytes(8).toString("hex")}`;
  const partes: Buffer[] = [
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="patientId"\r\n\r\n${patientId}\r\n`),
  ];
  if (legenda !== undefined) {
    partes.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="caption"\r\n\r\n${legenda}\r\n`));
  }
  partes.push(Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="arquivo"; filename="m.png"\r\n` +
    `Content-Type: image/png\r\n\r\n`
  ));
  partes.push(PNG_1X1);
  partes.push(Buffer.from(`\r\n--${boundary}--\r\n`));

  const r = await bruto("POST", "/media", Buffer.concat(partes), {
    Authorization: `Bearer ${authToken}`,
    "Content-Type": `multipart/form-data; boundary=${boundary}`,
  });
  try { return { status: r.status, body: JSON.parse(r.texto) }; }
  catch { return { status: r.status, body: r.texto }; }
}

async function darConsentimento(): Promise<void> {
  await db.insert(consentRecordsTable).values({
    userId: principalUserId, patientId, givenBy: "legal_representative",
    consentType: "image_capture", consentGiven: "true", version: "v1.0",
    ipAddress: "127.0.0.1",
  });
}

interface Mural {
  consentido: boolean;
  podeDecidirConsentimento: boolean;
  timezone: string;
  momentos: Array<{
    id: number; caption: string | null; criadoEm: string;
    autor: string | null; url: string; podeApagar: boolean;
  }>;
}

async function lerMural(authToken = token): Promise<Mural> {
  const r = await api("GET", `/patients/${patientId}/momentos`, authToken);
  assert.equal(r.status, 200, `mural deveria dar 200, deu ${r.status}`);
  return r.body as Mural;
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
    .values({ name: "Família Fictícia Momentos", slug: `mom-${marca}` }).returning();
  familyId = family.id;

  const [user] = await db.insert(usersTable).values({
    email: `mom-${marca}@zelo.test`, name: "Ana Fictícia",
    passwordHash: await hashPassword("x"), emailVerified: true, status: "active",
  }).returning();
  const [caregiver] = await db.insert(caregiversTable)
    .values({ familyId, userId: user.id, name: "Ana Fictícia", role: "primary_caregiver" }).returning();
  principalUserId = user.id;
  token = generateAccessToken(user.id, familyId, caregiver.id, "primary_caregiver");

  const [comum] = await db.insert(usersTable).values({
    email: `mom-comum-${marca}@zelo.test`, name: "Bruno Fictício",
    passwordHash: await hashPassword("x"), emailVerified: true, status: "active",
  }).returning();
  const [comumCaregiver] = await db.insert(caregiversTable)
    .values({ familyId, userId: comum.id, name: "Bruno Fictício", role: "caregiver" }).returning();
  _comumCaregiverId = comumCaregiver.id;
  comumToken = generateAccessToken(comum.id, familyId, comumCaregiver.id, "caregiver");

  // Fuso propositalmente diferente do de quem roda o teste: é o que permite
  // provar que o horário sai no fuso DO PACIENTE.
  const [patient] = await db.insert(patientsTable)
    .values({ familyId, name: "Dona Maria Teste", timezone: "America/Manaus" }).returning();
  patientId = patient.id;

  const [outra] = await db.insert(familiesTable)
    .values({ name: "Outra Família Fictícia", slug: `mom-outra-${marca}` }).returning();
  otherFamilyId = outra.id;
  const [outroUser] = await db.insert(usersTable).values({
    email: `mom-outra-${marca}@zelo.test`, name: "Cuidador de Outra Família",
    passwordHash: await hashPassword("x"), emailVerified: true, status: "active",
  }).returning();
  const [outroCaregiver] = await db.insert(caregiversTable)
    .values({ familyId: otherFamilyId, userId: outroUser.id, name: "Cuidador de Outra Família", role: "primary_caregiver" }).returning();
  otherToken = generateAccessToken(outroUser.id, otherFamilyId, outroCaregiver.id, "primary_caregiver");
});

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

describe("O portão de consentimento vale aqui também", () => {
  it("sem consentimento, o mural diz que não existe — e vem vazio", async () => {
    const mural = await lerMural();
    assert.equal(mural.consentido, false);
    assert.deepEqual(mural.momentos, [], "sem consentimento não pode vazar mídia nenhuma");
  });

  it("diz ao cuidador principal que ele pode decidir, e ao comum que não", async () => {
    assert.equal((await lerMural()).podeDecidirConsentimento, true);
    assert.equal((await lerMural(comumToken)).podeDecidirConsentimento, false);
  });

  it("com consentimento, o mural abre", async () => {
    await darConsentimento();
    const mural = await lerMural();
    assert.equal(mural.consentido, true);
  });
});

describe("O mural", () => {
  it("mostra a foto com legenda, autor e horário", async () => {
    await darConsentimento();
    const enviado = await publicar("tomou o café todinho hoje");
    assert.equal(enviado.status, 201);

    const mural = await lerMural();
    assert.equal(mural.momentos.length, 1);
    const [momento] = mural.momentos;
    assert.equal(momento.caption, "tomou o café todinho hoje");
    assert.equal(momento.autor, "Ana Fictícia");
    assert.match(momento.url, /^\/api\/media\/content\//);
    assert.ok(!Number.isNaN(Date.parse(momento.criadoEm)));
  });

  it("legenda é opcional", async () => {
    await darConsentimento();
    await publicar();
    const [momento] = (await lerMural()).momentos;
    assert.equal(momento.caption, null);
  });

  it("legenda gigante é recortada, não recusada — a foto já subiu", async () => {
    await darConsentimento();
    const enorme = "a".repeat(1000);
    const enviado = await publicar(enorme);
    assert.equal(enviado.status, 201, "legenda longa não pode custar a foto");
    const [momento] = (await lerMural()).momentos;
    assert.equal(momento.caption?.length, 300);
  });

  it("ordem é cronológica INVERSA — o mais novo primeiro", async () => {
    await darConsentimento();
    await publicar("primeira");
    await publicar("segunda");
    await publicar("terceira");

    const legendas = (await lerMural()).momentos.map((m) => m.caption);
    assert.deepEqual(legendas, ["terceira", "segunda", "primeira"]);
  });

  it("devolve o fuso DO PACIENTE, não o de quem está olhando", async () => {
    await darConsentimento();
    const mural = await lerMural();
    assert.equal(mural.timezone, "America/Manaus");
  });

  it("o link do mural abre a foto de verdade", async () => {
    await darConsentimento();
    await publicar();
    const [momento] = (await lerMural()).momentos;
    const r = await bruto("GET", momento.url.replace(/^\/api/, ""), undefined, {});
    assert.equal(r.status, 200);
  });

  it("cuidador de outra família não vê nada — 404", async () => {
    await darConsentimento();
    await publicar();
    const r = await api("GET", `/patients/${patientId}/momentos`, otherToken);
    assert.equal(r.status, 404, "responder 403 confirmaria que o paciente existe");
  });

  it("mural vazio é mural vazio — sem contagem e sem cobrança", async () => {
    await darConsentimento();
    const mural = await lerMural() as unknown as Record<string, unknown>;

    // CON-012: nada na resposta pode virar placar.
    for (const proibido of ["total", "count", "quantidade", "streak", "diasSemFoto", "ultimaFoto"]) {
      assert.equal(proibido in mural, false, `"${proibido}" na resposta abriria a porta para gamificação`);
    }
    assert.deepEqual(mural.momentos, []);
  });
});

describe("Quem pode apagar", () => {
  it("quem publicou apaga o seu", async () => {
    await darConsentimento();
    const enviado = await publicar(undefined, comumToken);
    const id = (enviado.body as { id: number }).id;

    const r = await api("DELETE", `/media/${id}`, comumToken);
    assert.equal(r.status, 204);
  });

  it("o cuidador principal apaga o de qualquer um", async () => {
    await darConsentimento();
    const enviado = await publicar(undefined, comumToken);
    const id = (enviado.body as { id: number }).id;

    const r = await api("DELETE", `/media/${id}`, token);
    assert.equal(r.status, 204);
  });

  it("cuidador comum NÃO apaga o de outro — 403, e a foto continua lá", async () => {
    await darConsentimento();
    const enviado = await publicar(undefined, token); // publicado pelo principal
    const id = (enviado.body as { id: number }).id;

    const r = await api("DELETE", `/media/${id}`, comumToken);
    assert.equal(r.status, 403);
    assert.equal((r.body as { code: string }).code, "MEDIA_DELETE_DENIED");

    const restantes = await db.select().from(mediaAssetsTable).where(eq(mediaAssetsTable.id, id));
    assert.equal(restantes.length, 1);
  });

  it("a regra vale no SERVIDOR, não só no podeApagar da lista", async () => {
    await darConsentimento();
    await publicar(undefined, token);

    const mural = await lerMural(comumToken);
    const [momento] = mural.momentos;
    assert.equal(momento.podeApagar, false, "a lista já avisa que ele não pode");

    // E mesmo ignorando o aviso e chamando direto, o servidor recusa.
    const r = await api("DELETE", `/media/${momento.id}`, comumToken);
    assert.equal(r.status, 403, "frontend não é fronteira de segurança");
  });

  it("podeApagar é verdadeiro para o autor e para o principal", async () => {
    await darConsentimento();
    await publicar(undefined, comumToken);

    assert.equal((await lerMural(comumToken)).momentos[0].podeApagar, true, "autor pode");
    assert.equal((await lerMural(token)).momentos[0].podeApagar, true, "cuidador principal pode");
  });

  it("apagar tira a foto do mural E o objeto do bucket", async () => {
    await darConsentimento();
    const enviado = await publicar();
    const id = (enviado.body as { id: number }).id;

    const [linha] = await db.select().from(mediaAssetsTable).where(eq(mediaAssetsTable.id, id));
    const armazenamento = obterArmazenamento();
    assert.ok(armazenamento);
    assert.equal(await armazenamento.existe(linha.objectKey), true);

    assert.equal((await api("DELETE", `/media/${id}`)).status, 204);

    assert.equal((await lerMural()).momentos.length, 0);
    assert.equal(await armazenamento.existe(linha.objectKey), false);
  });
});

describe("O autor some, o momento fica", () => {
  it("cuidador removido não apaga a foto que ele publicou", async () => {
    await darConsentimento();

    // Cuidador descartável só para este caso: apagar o `comumToken` global
    // deixaria os testes seguintes sem um cuidador comum, e a ordem dos
    // casos viraria pré-requisito escondido.
    const marca = Date.now();
    const [passageiro] = await db.insert(usersTable).values({
      email: `mom-passageiro-${marca}@zelo.test`, name: "Bruno Fictício",
      passwordHash: await hashPassword("x"), emailVerified: true, status: "active",
    }).returning();
    const [passageiroCaregiver] = await db.insert(caregiversTable)
      .values({ familyId, userId: passageiro.id, name: "Bruno Fictício", role: "caregiver" }).returning();
    const passageiroToken = generateAccessToken(passageiro.id, familyId, passageiroCaregiver.id, "caregiver");

    await publicar("foto do Bruno", passageiroToken);

    // `onDelete: "set null"` em uploaded_by_caregiver_id — a foto é da
    // família, não de quem apertou o botão.
    await db.delete(caregiversTable).where(eq(caregiversTable.id, passageiroCaregiver.id));

    const mural = await lerMural();
    assert.equal(mural.momentos.length, 1, "remover o cuidador não pode apagar a memória da família");
    assert.equal(mural.momentos[0].caption, "foto do Bruno");
    // Sem autor conhecido, o mural atribui ao próprio paciente — que é o
    // mesmo tratamento que o recado do paciente vai receber na QUI-8.
    assert.equal(mural.momentos[0].autor, "Dona Maria Teste");
  });
});

/**
 * Paginação por cursor — QUI-18.
 *
 * ── Por que deixou de ser "100 e pronto" ──────────────────────────────────
 *
 * Antes a rota devolvia até 100 momentos numa tacada, e o motivo declarado
 * era honesto: um teto de sanidade, não paginação. Com o mural em grade,
 * 100 miniaturas são 100 requisições de imagem no primeiro toque — num 3G,
 * a diferença entre "abriu" e "travou".
 *
 * ── O par (instante, id), e não só o instante ─────────────────────────────
 *
 * Três fotos enviadas de uma vez podem cair no MESMO `created_at`. Um cursor
 * que compara só o instante ou pula as irmãs, ou as repete para sempre. O
 * teste abaixo cria exatamente esse caso.
 */
describe("Paginação do mural — QUI-18", () => {
  /**
   * Insere direto no banco, sem passar pela rota de envio.
   *
   * De propósito: o volume aqui é dezenas de itens, e subir cada um por HTTP
   * significaria processar dezenas de imagens e bater no limitador de envio
   * — lentidão e instabilidade que não provam nada sobre paginação.
   */
  async function semear(quantos: number, instante?: Date) {
    const criados: number[] = [];
    for (let i = 0; i < quantos; i++) {
      const [linha] = await db
        .insert(mediaAssetsTable)
        .values({
          familyId,
          patientId,
          kind: "image",
          mimeType: "image/png",
          sizeBytes: 68,
          objectKey: `teste-paginacao-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          caption: `foto ${i}`,
          ...(instante ? { createdAt: instante } : {}),
        })
        .returning({ id: mediaAssetsTable.id });
      criados.push(linha.id);
    }
    return criados;
  }

  async function pagina(cursor?: string | null, limite?: number) {
    const busca = new URLSearchParams();
    if (cursor) busca.set("cursor", cursor);
    if (limite) busca.set("limite", String(limite));
    const sufixo = busca.toString() ? `?${busca}` : "";
    const r = await api("GET", `/patients/${patientId}/momentos${sufixo}`);
    assert.equal(r.status, 200, `mural deveria dar 200, deu ${r.status}`);
    return r.body as {
      momentos: Array<{ id: number; caption: string | null }>;
      proximoCursor: string | null;
    };
  }

  // `beforeEach`, e não `before`: o hook global deste arquivo APAGA o
  // consentimento antes de cada teste (linha ~182), justamente para que cada
  // caso declare o que precisa. Dar consentimento uma vez só no `before`
  // deixava todos os testes daqui lendo um mural sem consentimento — que
  // responde 200 com lista vazia, e por isso falhava com "0 momentos" em vez
  // de dizer o que estava errado. Os hooks aninhados rodam de fora para
  // dentro, então este vem depois da limpeza.
  beforeEach(async () => {
    await darConsentimento();
  });

  it("quando tudo cabe numa página, não oferece cursor", async () => {
    await semear(3);
    const primeira = await pagina();
    assert.equal(primeira.momentos.length, 3);
    assert.equal(
      primeira.proximoCursor,
      null,
      "cursor não-nulo aqui faria a tela oferecer um 'ver mais' que não traz nada"
    );
  });

  it("entrega a página pedida e um cursor para a seguinte", async () => {
    // Sem `instante` fixo: cada linha nasce com o `now()` do Postgres, em
    // MICROSSEGUNDOS. É este teste que pegou o defeito de arredondamento —
    // o `Date` do JavaScript só tem milissegundos, o driver arredonda para
    // cima, e o cursor passava a apontar DEPOIS da linha que marcava. As
    // páginas devolviam 3, 3 e 3 de um mural de 7, repetindo para sempre.
    await semear(7);

    const primeira = await pagina(null, 3);
    assert.equal(primeira.momentos.length, 3, "o limite pedido tem que ser respeitado");
    assert.ok(primeira.proximoCursor, "com mais itens adiante, o cursor precisa existir");

    const segunda = await pagina(primeira.proximoCursor, 3);
    assert.equal(segunda.momentos.length, 3);

    const terceira = await pagina(segunda.proximoCursor, 3);
    assert.equal(terceira.momentos.length, 1, "a última página traz o que sobrou");
    assert.equal(terceira.proximoCursor, null, "e fecha a paginação");

    // Nem repetido, nem perdido: as três páginas somam exatamente o mural.
    const vistos = [...primeira.momentos, ...segunda.momentos, ...terceira.momentos].map((m) => m.id);
    assert.equal(new Set(vistos).size, 7, "nenhum momento pode aparecer em duas páginas");
  });

  it("não perde momentos publicados no mesmo instante", async () => {
    // O caso real: alguém manda três fotos de uma vez. Um cursor que compara
    // só `created_at` pularia as irmãs da fronteira — ou as devolveria para
    // sempre, num laço infinito de "ver mais".
    const mesmoInstante = new Date("2026-08-20T12:00:00.000Z");
    await semear(5, mesmoInstante);

    const primeira = await pagina(null, 2);
    const segunda = await pagina(primeira.proximoCursor, 2);
    const terceira = await pagina(segunda.proximoCursor, 2);

    const vistos = [...primeira.momentos, ...segunda.momentos, ...terceira.momentos].map((m) => m.id);
    assert.equal(vistos.length, 5, "as cinco do mesmo segundo precisam sair, e uma vez cada");
    assert.equal(new Set(vistos).size, 5);
    assert.equal(terceira.proximoCursor, null);
  });

  it("cursor inválido não quebra nem vaza — devolve a primeira página", async () => {
    await semear(2);
    for (const lixo of ["", "banana", "2026-13-45|abc", "|", "não é data|1"]) {
      const r = await pagina(lixo);
      assert.equal(r.momentos.length, 2, `cursor "${lixo}" deveria cair no começo da lista`);
    }
  });

  it("o limite tem teto, e entrada inválida cai no padrão", async () => {
    await semear(3);
    // Um `limite` gigante não pode virar um jeito de pedir o mural inteiro
    // numa requisição — é justamente o que a paginação veio evitar.
    const enorme = await pagina(null, 5000);
    assert.equal(enorme.momentos.length, 3, "com 3 no mural, 3 saem — o teto não some com dados");

    const negativo = await api("GET", `/patients/${patientId}/momentos?limite=-4`);
    assert.equal(negativo.status, 200, "limite inválido não pode virar erro na cara do usuário");
  });

  it("a resposta paginada continua sem nenhuma contagem", async () => {
    await semear(5);
    const corpo = (await pagina(null, 2)) as unknown as Record<string, unknown>;

    // CON-012 de novo, agora na porta que a paginação abriu: é muito fácil
    // um "total" ou "restantes" entrar junto com o cursor, e aí o mural vira
    // placar sem ninguém ter decidido isso.
    for (const proibido of ["total", "count", "quantidade", "restantes", "totalPaginas", "paginas"]) {
      assert.equal(
        proibido in corpo,
        false,
        `a resposta não pode ter "${proibido}" — o mural não conta nada (CON-012)`
      );
    }
  });
});
