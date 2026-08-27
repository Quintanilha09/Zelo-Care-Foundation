/**
 * Aviso de momento novo, e o coração — QUI-10 (Issue #24).
 *
 * ── O que esta suíte existe para provar ───────────────────────────────────
 *
 *   1. **o aviso nunca carrega o conteúdo do momento.** A legenda plantada
 *      aqui contém nome de medicamento de propósito: se um dia alguém
 *      interpolar `caption` no texto, este teste vira vermelho antes de a
 *      frase chegar à tela bloqueada de alguém;
 *   2. quem publicou não é avisado do próprio gesto;
 *   3. o silêncio noturno cancela o aviso — testado com o relógio congelado,
 *      não esperando a madrugada;
 *   4. **a reação não é contada em lugar nenhum.** Uma varredura de chaves
 *      falha se qualquer campo de total aparecer na resposta (CON-012);
 *   5. o coração alterna, e nada disso atravessa a fronteira da família.
 */
import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import crypto from "node:crypto";
import { eq, and } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  usersTable, caregiversTable, familiesTable, patientsTable,
  mediaAssetsTable, mediaReactionsTable, consentRecordsTable,
  notificationsTable, notificationPreferencesTable,
} from "@workspace/db";
import { generateAccessToken } from "../lib/tokens.ts";
import { hashPassword } from "../lib/password.ts";
import { boss } from "../lib/queue.ts";
import { Clock } from "../lib/clock.ts";
import { textoDoAviso, avisarMomentoNovo } from "../lib/momento-aviso.ts";
import app from "../app.ts";

let testPort: number;
let closeServer: () => Promise<void>;

let familyId: number;
/** Paciente dos testes do coração — publicações passam pela rota HTTP. */
let patientId: number;
/** Paciente dos testes do aviso — publicações entram direto e são aguardadas. */
let pacienteDoAviso: number;

/** Ana publica. */
let anaToken: string;
let anaCaregiverId: number;
/** Bruno é cuidador comum e recebe. */
let brunoToken: string;
let brunoCaregiverId: number;
/** Carla só observa — e mesmo assim pode reagir. */
let carlaToken: string;
let carlaCaregiverId: number;
/** Davi foi convidado e nunca criou conta: não tem aparelho para receber. */
let daviCaregiverId: number;

let outraFamilyId: number;
let vizinhoToken: string;

const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

/** WebM mínimo — o servidor valida o MIME, não o conteúdo. */
const AUDIO_FALSO = Buffer.from("1a45dfa3", "hex");

interface ApiResult { status: number; body: unknown }

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

async function api(method: string, path: string, corpo?: unknown, authToken = anaToken): Promise<ApiResult> {
  const payload = corpo !== undefined ? Buffer.from(JSON.stringify(corpo)) : undefined;
  return json(await bruto(method, path, payload, {
    Authorization: `Bearer ${authToken}`,
    "Content-Type": "application/json",
  }));
}

/**
 * Publica um momento e **espera o aviso terminar**.
 *
 * O aviso sai sem bloquear a resposta do envio (ver media-upload.ts), então
 * consultar a tabela logo depois do 201 seria uma corrida. A rota devolve
 * apenas o id; quem espera de verdade é o `avisoEnviado` — e como o teste
 * fala HTTP, não dá para segurar a promessa. A saída é consultar a tabela
 * até a linha aparecer, com teto curto.
 */
async function publicar(opcoes: {
  comoToken?: string;
  legenda?: string;
  audio?: boolean;
} = {}): Promise<number> {
  const boundary = `----zelo${crypto.randomBytes(8).toString("hex")}`;
  const partes: Buffer[] = [
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="patientId"\r\n\r\n${patientId}\r\n`),
  ];
  if (opcoes.legenda) {
    partes.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="caption"\r\n\r\n${opcoes.legenda}\r\n`));
  }
  const nome = opcoes.audio ? "recado.webm" : "m.png";
  const tipo = opcoes.audio ? "audio/webm" : "image/png";
  partes.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="arquivo"; filename="${nome}"\r\n` +
      `Content-Type: ${tipo}\r\n\r\n`
    ),
    opcoes.audio ? AUDIO_FALSO : PNG_1X1,
    Buffer.from(`\r\n--${boundary}--\r\n`)
  );

  const r = json(await bruto("POST", "/media", Buffer.concat(partes), {
    Authorization: `Bearer ${opcoes.comoToken ?? anaToken}`,
    "Content-Type": `multipart/form-data; boundary=${boundary}`,
  }));
  assert.equal(r.status, 201, `publicar deveria dar 201, deu ${r.status}: ${JSON.stringify(r.body)}`);
  return (r.body as { id: number }).id;
}

/**
 * Publica direto no banco e **espera o aviso terminar de verdade**.
 *
 * ── Por que não pela rota, e por que isto importa ─────────────────────────
 *
 * A primeira versão publicava por HTTP e consultava a tabela em laço até a
 * primeira linha aparecer. Passava sozinha, passava no arquivo, e **falhou
 * duas vezes na suíte completa** — o pior tipo de teste, porque ensina a
 * ignorar vermelho.
 *
 * A causa: o aviso sai sem bloquear a resposta do envio (de propósito, ver
 * media-upload.ts). "Apareceu a primeira linha" não é "o aviso acabou" — o
 * laço voltava no meio, o `beforeEach` do teste seguinte apagava tudo, e as
 * inserções atrasadas do teste ANTERIOR caíam depois da limpeza. O teste
 * seguinte então via avisos que ele não tinha causado.
 *
 * Aqui a mídia entra direto no catálogo e o aviso é **aguardado**. Não há
 * corrida possível: quando esta função retorna, acabou. O caminho por HTTP
 * continua coberto — em "a rota de envio dispara o aviso", que é o único
 * teste que precisa provar aquela ligação.
 */
async function publicarEAvisar(opcoes: { kind?: "image" | "audio"; autor?: number | null } = {}): Promise<number> {
  const [asset] = await db
    .insert(mediaAssetsTable)
    .values({
      familyId,
      patientId: pacienteDoAviso,
      uploadedByCaregiverId: opcoes.autor === undefined ? anaCaregiverId : opcoes.autor,
      kind: opcoes.kind ?? "image",
      mimeType: opcoes.kind === "audio" ? "audio/webm" : "image/png",
      sizeBytes: 68,
      objectKey: `teste/${crypto.randomBytes(12).toString("hex")}`,
      caption: "Tomando Losartana 50mg hoje, a pressão estava alta",
    })
    .returning({ id: mediaAssetsTable.id });

  await avisarMomentoNovo(asset.id);
  return asset.id;
}

/**
 * Os avisos do PACIENTE DO AVISO — nunca os do paciente do coração.
 *
 * Os dois pacientes existem para separar o que é assíncrono do que não é. As
 * publicações por HTTP (dos testes do coração) deixam avisos em voo que podem
 * cair a qualquer momento; filtrar por paciente isola um bloco do outro sem
 * precisar sincronizar nada.
 */
async function avisosDoPaciente(): Promise<Array<{ caregiverId: number | null; body: string | null }>> {
  return db
    .select({ caregiverId: notificationsTable.caregiverId, body: notificationsTable.body })
    .from(notificationsTable)
    .where(
      and(
        eq(notificationsTable.familyId, familyId),
        eq(notificationsTable.patientId, pacienteDoAviso),
        eq(notificationsTable.type, "moment_new")
      )
    );
}

/** Confere que NENHUMA chave da resposta parece contagem. */
function nenhumContador(valor: unknown, caminho = "resposta"): void {
  if (Array.isArray(valor)) {
    valor.forEach((item, i) => nenhumContador(item, `${caminho}[${i}]`));
    return;
  }
  if (valor === null || typeof valor !== "object") return;

  for (const [chave, dentro] of Object.entries(valor as Record<string, unknown>)) {
    const suspeita = /total|count|quantidade|quantos|curtidas|reacoes|reações|numero|número/i.test(chave);
    assert.equal(
      suspeita, false,
      `${caminho}.${chave} parece contagem de reação — a regra é mostrar QUEM, nunca QUANTOS (CON-012)`
    );
    nenhumContador(dentro, `${caminho}.${chave}`);
  }
}

type Papel = "primary_caregiver" | "caregiver" | "hired_caregiver" | "observer";

async function criarCuidador(
  marca: string, apelido: string, papel: Papel, comConta = true
): Promise<{ caregiverId: number; token: string | null }> {
  let userId: number | null = null;
  if (comConta) {
    const [user] = await db.insert(usersTable).values({
      email: `${apelido}-${marca}@zelo.test`, name: `${apelido} Fictício`,
      passwordHash: await hashPassword("x"), emailVerified: true, status: "active",
    }).returning();
    userId = user.id;
  }
  const [caregiver] = await db.insert(caregiversTable)
    .values({ familyId, userId, name: `${apelido} Fictício`, role: papel }).returning();

  return {
    caregiverId: caregiver.id,
    token: userId !== null ? generateAccessToken(userId, familyId, caregiver.id, papel) : null,
  };
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

  const marca = String(Date.now());

  // Silêncio noturno DESLIGADO por padrão nesta família: o padrão do produto
  // é 22:00–07:00 ligado, e com ele ligado o aviso dependeria da hora em que
  // a suíte roda. O teste do silêncio liga explicitamente.
  const [family] = await db.insert(familiesTable)
    .values({ name: "Família Fictícia Coração", slug: `cor-${marca}`, quietHoursEnabled: false }).returning();
  familyId = family.id;

  const ana = await criarCuidador(marca, "Ana", "primary_caregiver");
  anaCaregiverId = ana.caregiverId;
  anaToken = ana.token!;

  const bruno = await criarCuidador(marca, "Bruno", "caregiver");
  brunoCaregiverId = bruno.caregiverId;
  brunoToken = bruno.token!;

  const carla = await criarCuidador(marca, "Carla", "observer");
  carlaCaregiverId = carla.caregiverId;
  carlaToken = carla.token!;

  const davi = await criarCuidador(marca, "Davi", "caregiver", false);
  daviCaregiverId = davi.caregiverId;

  const [patient] = await db.insert(patientsTable)
    .values({ familyId, name: "Dona Maria Teste", timezone: "America/Sao_Paulo" }).returning();
  patientId = patient.id;

  // QUI-6 — sem consentimento de imagem não se publica foto nenhuma.
  await db.insert(consentRecordsTable).values({
    userId: (await db.select({ userId: caregiversTable.userId }).from(caregiversTable)
      .where(eq(caregiversTable.id, anaCaregiverId)))[0].userId!,
    patientId, givenBy: "legal_representative",
    consentType: "image_capture", consentGiven: "true", version: "v1.0",
    ipAddress: "127.0.0.1",
  });

  // Segundo paciente, só para os testes do aviso. Ver `avisosDoPaciente`:
  // separar os dois é o que impede o assíncrono de um bloco de contaminar o
  // outro, sem precisar sincronizar nada.
  const [doAviso] = await db.insert(patientsTable)
    .values({ familyId, name: "Dona Maria Teste (aviso)", timezone: "America/Sao_Paulo" }).returning();
  pacienteDoAviso = doAviso.id;

  const [outra] = await db.insert(familiesTable)
    .values({ name: "Outra Família Fictícia", slug: `cor-outra-${marca}` }).returning();
  outraFamilyId = outra.id;
  const [vizinhoUser] = await db.insert(usersTable).values({
    email: `cor-vizinho-${marca}@zelo.test`, name: "Cuidador Vizinho",
    passwordHash: await hashPassword("x"), emailVerified: true, status: "active",
  }).returning();
  const [vizinhoCaregiver] = await db.insert(caregiversTable)
    .values({ familyId: outraFamilyId, userId: vizinhoUser.id, name: "Cuidador Vizinho", role: "primary_caregiver" })
    .returning();
  vizinhoToken = generateAccessToken(vizinhoUser.id, outraFamilyId, vizinhoCaregiver.id, "primary_caregiver");
});

beforeEach(async () => {
  Clock.reset();
  await db.delete(notificationsTable).where(eq(notificationsTable.familyId, familyId));
  await db.delete(mediaAssetsTable).where(eq(mediaAssetsTable.familyId, familyId));
  await db.delete(notificationPreferencesTable).where(eq(notificationPreferencesTable.patientId, patientId));
  await db.delete(notificationPreferencesTable).where(eq(notificationPreferencesTable.patientId, pacienteDoAviso));
});

after(async () => {
  Clock.reset();
  await closeServer();
  await boss.stop({ graceful: false });
  await db.delete(familiesTable).where(eq(familiesTable.id, familyId));
  await db.delete(familiesTable).where(eq(familiesTable.id, outraFamilyId));
});

describe("O aviso não carrega o conteúdo", () => {
  it("a legenda NUNCA entra no texto do aviso", async () => {
    // Legenda plantada com nome de medicamento. Se alguém trocar o template
    // por interpolação, isto vaza — e é o que este teste impede.
    await publicarEAvisar();

    const avisos = await avisosDoPaciente();
    assert.ok(avisos.length > 0, "a família precisa ser avisada");

    for (const aviso of avisos) {
      assert.ok(aviso.body, "todo aviso tem texto");
      assert.equal(aviso.body!.includes("Losartana"), false, "nome de medicamento no aviso");
      assert.equal(aviso.body!.includes("pressão"), false, "condição de saúde no aviso");
      assert.equal(aviso.body!.includes("50mg"), false, "dose no aviso");
    }
  });

  it("o texto é template fixo, e a função nem recebe a legenda", async () => {
    // Prova direta: não existe parâmetro por onde a legenda entre.
    assert.equal(
      textoDoAviso("image", "Dona Maria Teste", "Ana Fictícia"),
      "Ana Fictícia publicou uma foto de Dona Maria Teste."
    );
    assert.equal(
      textoDoAviso("audio", "Dona Maria Teste", null),
      "Dona Maria Teste mandou um recado."
    );
  });
});

describe("Quem recebe o aviso", () => {
  it("quem publicou NÃO é avisado do próprio momento", async () => {
    await publicarEAvisar();
    const avisos = await avisosDoPaciente();

    assert.ok(avisos.length > 0);
    assert.equal(
      avisos.some((a) => a.caregiverId === anaCaregiverId), false,
      "Ana publicou; avisar Ana do gesto dela seria ruído"
    );
    assert.ok(avisos.some((a) => a.caregiverId === brunoCaregiverId), "Bruno precisa saber");
  });

  it("o observador recebe — é justamente quem não abre o app todo dia", async () => {
    await publicarEAvisar();
    const avisos = await avisosDoPaciente();
    assert.ok(
      avisos.some((a) => a.caregiverId === carlaCaregiverId),
      "ver a mãe não exige capacidade de registrar dose"
    );
  });

  it("cuidador sem conta vinculada não gera aviso", async () => {
    await publicarEAvisar();
    const avisos = await avisosDoPaciente();
    assert.equal(
      avisos.some((a) => a.caregiverId === daviCaregiverId), false,
      "convite pendente não tem aparelho — a linha registraria um envio que não houve"
    );
  });

  it("quem desligou a categoria moment não recebe", async () => {
    await db.insert(notificationPreferencesTable).values({
      caregiverId: brunoCaregiverId, patientId: pacienteDoAviso, category: "moment", enabled: false,
    });

    await publicarEAvisar();
    const avisos = await avisosDoPaciente();

    assert.equal(
      avisos.some((a) => a.caregiverId === brunoCaregiverId), false,
      "Bruno desligou avisos de momento"
    );
    assert.ok(avisos.some((a) => a.caregiverId === carlaCaregiverId), "Carla não desligou nada");
  });

  it("o recado do próprio paciente avisa em nome dela", async () => {
    // Autor nulo = publicado do aparelho do paciente (QUI-8). É o caso em que
    // ninguém pode ficar sem saber, e o texto muda para a voz dela.
    await publicarEAvisar({ kind: "audio", autor: null });
    const avisos = await avisosDoPaciente();

    assert.ok(avisos.length > 0, "recado do paciente avisa a família inteira");
    for (const aviso of avisos) {
      assert.equal(aviso.body, "Dona Maria Teste (aviso) mandou um recado.");
    }
    assert.ok(
      avisos.some((a) => a.caregiverId === anaCaregiverId),
      "sem cuidador autor, ninguém é excluído — nem a Ana"
    );
  });

  it("a outra família nunca é avisada", async () => {
    await publicarEAvisar();

    const dosVizinhos = await db
      .select({ id: notificationsTable.id })
      .from(notificationsTable)
      .where(and(eq(notificationsTable.familyId, outraFamilyId), eq(notificationsTable.type, "moment_new")));

    assert.deepEqual(dosVizinhos, [], "aviso não atravessa fronteira de família");
  });
});

describe("A rota de envio dispara o aviso", () => {
  it("publicar por HTTP avisa a família, sem a rota esperar por isso", async () => {
    // O único teste que passa pela rota de verdade. Os outros do aviso entram
    // direto no catálogo para poder AGUARDAR — ver `publicarEAvisar`.
    //
    // Aqui o laço é inevitável: o envio responde 201 antes de o aviso sair, e
    // é exatamente esse comportamento que se quer provar.
    await publicar();

    let avisos: Array<{ id: number }> = [];
    for (let tentativa = 0; tentativa < 100 && avisos.length === 0; tentativa++) {
      avisos = await db
        .select({ id: notificationsTable.id })
        .from(notificationsTable)
        .where(
          and(
            eq(notificationsTable.familyId, familyId),
            eq(notificationsTable.patientId, patientId),
            eq(notificationsTable.type, "moment_new")
          )
        );
      if (avisos.length === 0) await new Promise((r) => setTimeout(r, 20));
    }

    assert.ok(avisos.length > 0, "a rota POST /media precisa disparar o aviso");
  });
});

describe("Silêncio noturno", () => {
  it("dentro da janela, ninguém é acordado por uma foto", async () => {
    await db.update(familiesTable)
      .set({ quietHoursEnabled: true, quietHoursStart: "22:00", quietHoursEnd: "07:00" })
      .where(eq(familiesTable.id, familyId));

    // 03:00 em São Paulo, congelado. Sem congelar o relógio, este teste
    // passaria ou falharia conforme a hora em que a suíte rodasse.
    Clock.freezeAt(new Date("2026-08-27T06:00:00.000Z")); // 03:00 BRT

    // Aguardado, não esperado por tempo. "Não apareceu em 300ms" não prova
    // nada — só que ainda não tinha aparecido. Aqui o aviso já terminou
    // quando esta linha retorna, então lista vazia é conclusão, não palpite.
    await publicarEAvisar();

    assert.deepEqual(
      await avisosDoPaciente(),
      [],
      "uma foto no mural não é urgência: ela continua lá de manhã"
    );

    await db.update(familiesTable).set({ quietHoursEnabled: false }).where(eq(familiesTable.id, familyId));
  });

  it("fora da janela, o aviso sai normalmente", async () => {
    await db.update(familiesTable)
      .set({ quietHoursEnabled: true, quietHoursStart: "22:00", quietHoursEnd: "07:00" })
      .where(eq(familiesTable.id, familyId));

    Clock.freezeAt(new Date("2026-08-27T18:00:00.000Z")); // 15:00 BRT

    await publicarEAvisar();
    const avisos = await avisosDoPaciente();
    assert.ok(avisos.length > 0, "às 15h da tarde o aviso tem que sair");

    await db.update(familiesTable).set({ quietHoursEnabled: false }).where(eq(familiesTable.id, familyId));
  });
});

describe("O coração", () => {
  it("alterna: manda e tira", async () => {
    const momentoId = await publicar();

    const primeiro = await api("POST", `/media/${momentoId}/coracao`, undefined, brunoToken);
    assert.equal(primeiro.status, 200);
    assert.equal((primeiro.body as { euReagi: boolean }).euReagi, true);
    assert.deepEqual((primeiro.body as { quemReagiu: string[] }).quemReagiu, ["Bruno Fictício"]);

    const segundo = await api("POST", `/media/${momentoId}/coracao`, undefined, brunoToken);
    assert.equal(segundo.status, 200);
    assert.equal((segundo.body as { euReagi: boolean }).euReagi, false);
    assert.deepEqual((segundo.body as { quemReagiu: string[] }).quemReagiu, []);
  });

  it("mostra QUEM reagiu — e a resposta não tem contagem nenhuma", async () => {
    const momentoId = await publicar();

    await api("POST", `/media/${momentoId}/coracao`, undefined, brunoToken);
    const resposta = await api("POST", `/media/${momentoId}/coracao`, undefined, carlaToken);

    assert.equal(resposta.status, 200);
    const corpo = resposta.body as { quemReagiu: string[] };
    assert.deepEqual(
      [...corpo.quemReagiu].sort(),
      ["Bruno Fictício", "Carla Fictício"],
      "a resposta traz nomes, que é o ponto inteiro do recurso"
    );

    nenhumContador(resposta.body);
  });

  it("o observador pode reagir", async () => {
    const momentoId = await publicar();
    const r = await api("POST", `/media/${momentoId}/coracao`, undefined, carlaToken);
    assert.equal(r.status, 200, "tirar isso do observador esvaziaria o recurso para quem ele mais serve");
    assert.equal((r.body as { euReagi: boolean }).euReagi, true);
  });

  it("dois toques rápidos não quebram — o estado final é um coração só", async () => {
    const momentoId = await publicar();

    // As duas partem do mesmo estado (sem reação), então as duas tentam
    // INSERIR. A UNIQUE decide, e `onConflictDoNothing` faz a perdedora
    // passar sem erro.
    const [a, b] = await Promise.all([
      api("POST", `/media/${momentoId}/coracao`, undefined, brunoToken),
      api("POST", `/media/${momentoId}/coracao`, undefined, brunoToken),
    ]);
    assert.ok(a.status < 500 && b.status < 500, `nenhuma pode dar erro de servidor: ${a.status}/${b.status}`);

    const linhas = await db
      .select({ id: mediaReactionsTable.id })
      .from(mediaReactionsTable)
      .where(and(
        eq(mediaReactionsTable.mediaAssetId, momentoId),
        eq(mediaReactionsTable.caregiverId, brunoCaregiverId)
      ));
    assert.ok(linhas.length <= 1, "nunca duas reações da mesma pessoa no mesmo momento");
  });

  it("momento de outra família responde 404, nunca 403", async () => {
    const momentoId = await publicar();
    const r = await api("POST", `/media/${momentoId}/coracao`, undefined, vizinhoToken);
    assert.equal(r.status, 404, "invariante 2: recurso de outra família não existe, não é proibido");
  });

  it("apagar o momento leva as reações junto", async () => {
    const momentoId = await publicar();
    await api("POST", `/media/${momentoId}/coracao`, undefined, brunoToken);

    const apagou = await api("DELETE", `/media/${momentoId}`);
    assert.equal(apagou.status, 204);

    const sobrou = await db
      .select({ id: mediaReactionsTable.id })
      .from(mediaReactionsTable)
      .where(eq(mediaReactionsTable.mediaAssetId, momentoId));
    assert.deepEqual(sobrou, [], "não sobra carinho órfão apontando para nada");
  });
});

describe("O mural devolve quem reagiu", () => {
  it("cada momento traz os nomes e o meu estado, sem nenhum total", async () => {
    const momentoId = await publicar();
    await api("POST", `/media/${momentoId}/coracao`, undefined, brunoToken);

    const mural = await api("GET", `/patients/${patientId}/momentos`, undefined, brunoToken);
    assert.equal(mural.status, 200);

    const momentos = (mural.body as { momentos: Array<{ id: number; quemReagiu: string[]; euReagi: boolean }> }).momentos;
    const alvo = momentos.find((m) => m.id === momentoId);
    assert.ok(alvo, "o momento publicado precisa estar no mural");
    assert.deepEqual(alvo.quemReagiu, ["Bruno Fictício"]);
    assert.equal(alvo.euReagi, true, "Bruno reagiu, então o coração dele aparece cheio");

    // A varredura vale para a resposta INTEIRA: um campo de total escondido
    // em qualquer nível reprova.
    nenhumContador(mural.body);
  });

  it("para quem não reagiu, euReagi é falso — mas os nomes dos outros aparecem", async () => {
    const momentoId = await publicar();
    await api("POST", `/media/${momentoId}/coracao`, undefined, brunoToken);

    const mural = await api("GET", `/patients/${patientId}/momentos`, undefined, carlaToken);
    const alvo = (mural.body as { momentos: Array<{ id: number; quemReagiu: string[]; euReagi: boolean }> })
      .momentos.find((m) => m.id === momentoId);

    assert.ok(alvo);
    assert.equal(alvo.euReagi, false);
    assert.deepEqual(alvo.quemReagiu, ["Bruno Fictício"], "Carla vê que o Bruno se importou");
  });
});
