/**
 * Perfil do cuidador: foto, telefone e parentesco — Issue #116.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * A FOTO É SERVIDA POR UM LINK SEM SESSÃO, PORQUE `<img src>` NÃO MANDA
 * HEADER. QUEM AUTORIZA É A ROTA QUE EMITE O LINK — E É ISSO QUE ESTE
 * ARQUIVO GUARDA.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── O que este arquivo guarda ─────────────────────────────────────────────
 *
 *   1. o link abre sem sessão, e um token adulterado não abre nada
 *   2. token de MÍDIA não abre foto de perfil (chaves derivadas separadas)
 *   3. a lista de outra família não traz o link de ninguém daqui
 *   4. só JPEG, PNG e WebP entram — SVG é documento executável
 *   5. a chave do objeto nunca sai no JSON nem na URL
 *   6. telefone e parentesco são POR FAMÍLIA, não por pessoa
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import crypto from "node:crypto";
import { eq, like } from "drizzle-orm";
import { db } from "@workspace/db";
import { usersTable, familiesTable, caregiversTable } from "@workspace/db";
import { generateAccessToken } from "../lib/tokens.ts";
import { gerarTokenDeMidia } from "../lib/media-links.ts";
import app from "../app.ts";

const SUFIXO = "@perfil-cuidador.zelo.test";

/** PNG de 1×1. O servidor valida o TIPO declarado, não o conteúdo. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

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
  await db.delete(familiesTable).where(like(familiesTable.name, "Família Fictícia Perfil %"));
});

let contadorDeIp = 0;
function ipUnico(): string {
  contadorDeIp += 1;
  return `10.${(contadorDeIp >> 16) & 255}.${(contadorDeIp >> 8) & 255}.${contadorDeIp & 255}`;
}

function multipart(arquivo: { nome: string; tipo: string; bytes: Buffer }) {
  const boundary = `----zelo${crypto.randomBytes(8).toString("hex")}`;
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="arquivo"; filename="${arquivo.nome}"\r\n` +
        `Content-Type: ${arquivo.tipo}\r\n\r\n`,
    ),
    arquivo.bytes,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return { boundary, body };
}

async function pedir(
  metodo: string,
  path: string,
  opcoes: { token?: string; json?: unknown; arquivo?: { nome: string; tipo: string; bytes: Buffer } } = {},
) {
  let corpo: Buffer | undefined;
  const headers: Record<string, string> = { "x-forwarded-for": ipUnico() };
  if (opcoes.token) headers.Authorization = `Bearer ${opcoes.token}`;
  if (opcoes.arquivo) {
    const m = multipart(opcoes.arquivo);
    corpo = m.body;
    headers["Content-Type"] = `multipart/form-data; boundary=${m.boundary}`;
  } else if (opcoes.json !== undefined) {
    corpo = Buffer.from(JSON.stringify(opcoes.json));
    headers["Content-Type"] = "application/json";
  }

  return new Promise<{ status: number; body: Record<string, unknown>; bytes: Buffer; tipo?: string }>(
    (resolve, reject) => {
      const req = http.request(
        {
          hostname: "127.0.0.1",
          port: testPort,
          path: `/api${path}`,
          method: metodo,
          headers: { ...headers, ...(corpo ? { "Content-Length": corpo.length } : {}) },
        },
        (res) => {
          const pedacos: Buffer[] = [];
          res.on("data", (c: Buffer) => pedacos.push(c));
          res.on("end", () => {
            const bytes = Buffer.concat(pedacos);
            let body: Record<string, unknown> = {};
            try {
              body = JSON.parse(bytes.toString()) as Record<string, unknown>;
            } catch {
              /* resposta binária — os bytes é que importam */
            }
            resolve({
              status: res.statusCode ?? 0,
              body,
              bytes,
              tipo: res.headers["content-type"] as string | undefined,
            });
          });
        },
      );
      req.on("error", reject);
      if (corpo) req.write(corpo);
      req.end();
    },
  );
}

/** Uma família com um cuidador principal autenticado. */
async function familia(rotulo: string) {
  const marca = `${Date.now()}${Math.floor(Math.random() * 10000)}`;
  const email = `perfil-${rotulo}-${marca}${SUFIXO}`;

  const [family] = await db
    .insert(familiesTable)
    .values({ name: `Família Fictícia Perfil ${rotulo} ${marca}`, slug: `perfil-${rotulo}-${marca}` })
    .returning({ id: familiesTable.id });

  const [user] = await db
    .insert(usersTable)
    .values({
      email,
      name: "Pessoa Fictícia Perfil",
      passwordHash: "hash-nao-usado",
      emailVerified: true,
      status: "active",
      activeFamilyId: family.id,
    })
    .returning({ id: usersTable.id });

  const [caregiver] = await db
    .insert(caregiversTable)
    .values({
      familyId: family.id,
      userId: user.id,
      name: "Pessoa Fictícia Perfil",
      email,
      role: "primary_caregiver",
    })
    .returning({ id: caregiversTable.id });

  return {
    familyId: family.id,
    userId: user.id,
    caregiverId: caregiver.id,
    token: generateAccessToken(user.id, family.id, caregiver.id, "primary_caregiver"),
  };
}

async function chaveGravada(userId: number): Promise<string | null> {
  const [u] = await db
    .select({ k: usersTable.avatarObjectKey })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);
  return u?.k ?? null;
}

describe("Foto de perfil do cuidador", () => {
  it("guarda a foto, devolve um link assinado, e nunca a chave do objeto", async () => {
    const a = await familia("foto");

    const envio = await pedir("POST", "/account/avatar", {
      token: a.token,
      arquivo: { nome: "rosto.png", tipo: "image/png", bytes: PNG },
    });
    assert.equal(envio.status, 201, JSON.stringify(envio.body));

    const url = String(envio.body.fotoUrl ?? "");
    assert.ok(url.startsWith("/api/caregivers/foto/"), `URL inesperada: ${url}`);

    // A chave é o endereço do objeto no bucket. Ela existe no banco...
    const chave = await chaveGravada(a.userId);
    assert.ok(chave, "a chave tem que ficar gravada");
    // ...e não pode aparecer em resposta nenhuma, nem dentro do link.
    const me = await pedir("GET", "/account/me", { token: a.token });
    assert.ok(
      !JSON.stringify(me.body).includes(chave as string),
      "a chave do armazenamento não pode vazar para o cliente",
    );
    assert.ok(!url.includes(chave as string), "nem dentro da URL");
  });

  it("o link serve os bytes SEM header de sessão — é o ponto dele", async () => {
    const a = await familia("serve");
    const envio = await pedir("POST", "/account/avatar", {
      token: a.token,
      arquivo: { nome: "rosto.png", tipo: "image/png", bytes: PNG },
    });
    const url = String(envio.body.fotoUrl ?? "").replace("/api", "");

    // Sem `token:` de propósito. `<img src>` não manda `Authorization`, e uma
    // rota de imagem atrás de `requireAuth` simplesmente não renderiza.
    const r = await pedir("GET", url);
    assert.equal(r.status, 200, "o link tem que abrir sem sessão");
    assert.ok(r.tipo?.startsWith("image/"), `Content-Type inesperado: ${r.tipo}`);
    assert.deepEqual(r.bytes, PNG, "os bytes servidos são os que subiram");
  });

  it("token adulterado não abre nada", async () => {
    const a = await familia("adulterado");
    const envio = await pedir("POST", "/account/avatar", {
      token: a.token,
      arquivo: { nome: "rosto.png", tipo: "image/png", bytes: PNG },
    });
    const url = String(envio.body.fotoUrl ?? "").replace("/api", "");

    // Troca o último caractere da assinatura.
    const quebrado = url.slice(0, -1) + (url.endsWith("A") ? "B" : "A");
    const r = await pedir("GET", quebrado);
    assert.equal(r.status, 410, "assinatura inválida é link inválido");
  });

  it("token de MÍDIA não abre foto de perfil — chaves separadas", async () => {
    const a = await familia("dominio");
    await pedir("POST", "/account/avatar", {
      token: a.token,
      arquivo: { nome: "rosto.png", tipo: "image/png", bytes: PNG },
    });

    // Mesmo id, mesmo formato `id.exp.assinatura` — só a chave derivada muda.
    // Sem a separação de domínio, este token abriria a foto do cuidador de id
    // igual ao do asset, e vice-versa.
    const { token: deMidia } = gerarTokenDeMidia(a.caregiverId);
    const r = await pedir("GET", `/caregivers/foto/${deMidia}`);
    assert.equal(r.status, 410, "um token assinado para mídia não pode valer aqui");
  });

  it("recusa SVG, que é documento executável", async () => {
    const a = await familia("svg");
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');

    const r = await pedir("POST", "/account/avatar", {
      token: a.token,
      arquivo: { nome: "x.svg", tipo: "image/svg+xml", bytes: svg },
    });

    assert.equal(r.status, 415, JSON.stringify(r.body));
    assert.equal(r.body.code, "FOTO_TIPO_INVALIDO");
    assert.equal(await chaveGravada(a.userId), null, "nada pode ter sido gravado");
  });

  it("trocar a foto troca a chave, e remover limpa a coluna", async () => {
    const a = await familia("troca");

    await pedir("POST", "/account/avatar", {
      token: a.token,
      arquivo: { nome: "um.png", tipo: "image/png", bytes: PNG },
    });
    const primeira = await chaveGravada(a.userId);

    await pedir("POST", "/account/avatar", {
      token: a.token,
      arquivo: { nome: "dois.png", tipo: "image/png", bytes: PNG },
    });
    const segunda = await chaveGravada(a.userId);

    assert.notEqual(segunda, primeira, "cada foto tem chave própria");

    const remocao = await pedir("DELETE", "/account/avatar", { token: a.token });
    assert.equal(remocao.status, 204);
    assert.equal(await chaveGravada(a.userId), null);

    const me = await pedir("GET", "/account/me", { token: a.token });
    assert.equal(
      (me.body.caregiver as Record<string, unknown>).fotoUrl,
      null,
      "sem foto, não há link para servir",
    );
  });

  it("a lista de OUTRA família não traz o link da foto de ninguém daqui", async () => {
    const dona = await familia("dona");
    const outra = await familia("outra");

    await pedir("POST", "/account/avatar", {
      token: dona.token,
      arquivo: { nome: "rosto.png", tipo: "image/png", bytes: PNG },
    });

    // Quem autoriza é a rota que EMITE o link. A família vizinha nunca recebe
    // o token, então não tem como montar a URL — invariante 2 aplicado ao
    // ponto onde a autorização de fato acontece.
    const lista = await pedir("GET", "/caregivers", { token: outra.token });
    const ids = (lista.body as unknown as Array<Record<string, unknown>>).map((c) => c.id);
    assert.ok(!ids.includes(dona.caregiverId), "cuidador de outra família não aparece");
  });

  it("sem sessão não sobe foto nenhuma", async () => {
    const sobe = await pedir("POST", "/account/avatar", {
      arquivo: { nome: "x.png", tipo: "image/png", bytes: PNG },
    });
    assert.equal(sobe.status, 401);
  });
});

describe("Telefone e parentesco", () => {
  it("são por FAMÍLIA, e a lista da família os devolve", async () => {
    const a = await familia("contato");

    const salvo = await pedir("PATCH", "/account/me", {
      token: a.token,
      json: { phone: "(21) 99999-1234", relationship: "filho_filha" },
    });
    assert.equal(salvo.status, 200, JSON.stringify(salvo.body));

    const lista = await pedir("GET", "/caregivers", { token: a.token });
    assert.equal(lista.status, 200);
    const eu = (lista.body as unknown as Array<Record<string, unknown>>).find(
      (c) => c.id === a.caregiverId,
    );
    assert.ok(eu, "o próprio cuidador tem que estar na lista");
    assert.equal(eu.phone, "(21) 99999-1234");
    assert.equal(eu.relationship, "filho_filha");
  });

  it("salvar só o telefone não exige reenviar o nome", async () => {
    const a = await familia("soTelefone");

    const r = await pedir("PATCH", "/account/me", { token: a.token, json: { phone: "11912345678" } });
    assert.equal(r.status, 200, JSON.stringify(r.body));

    const me = await pedir("GET", "/account/me", { token: a.token });
    assert.equal((me.body.caregiver as Record<string, unknown>).phone, "11912345678");
    assert.equal(me.body.name, "Pessoa Fictícia Perfil", "o nome não podia ter sido apagado");
  });

  it("string vazia limpa o telefone", async () => {
    const a = await familia("limpa");
    await pedir("PATCH", "/account/me", { token: a.token, json: { phone: "11912345678" } });

    const r = await pedir("PATCH", "/account/me", { token: a.token, json: { phone: "" } });
    assert.equal(r.status, 200, JSON.stringify(r.body));

    const me = await pedir("GET", "/account/me", { token: a.token });
    assert.equal((me.body.caregiver as Record<string, unknown>).phone, null);
  });

  it("recusa telefone com letra, e não grava nada", async () => {
    const a = await familia("ruim");

    const r = await pedir("PATCH", "/account/me", {
      token: a.token,
      json: { phone: "liga pra mim" },
    });
    assert.equal(r.status, 400, JSON.stringify(r.body));

    const me = await pedir("GET", "/account/me", { token: a.token });
    assert.equal((me.body.caregiver as Record<string, unknown>).phone, null);
  });

  it("a lista nunca conta em que outras famílias a pessoa cuida", async () => {
    const a = await familia("umaFamilia");

    const lista = await pedir("GET", "/caregivers", { token: a.token });
    const bruto = JSON.stringify(lista.body);

    // Se um dia alguém acrescentar "familias" ou "outrasFamilias" ao payload,
    // este teste cai — e é para cair. Expor onde mais a pessoa trabalha é
    // relação de terceiro que esta família não tem direito de conhecer.
    assert.ok(!bruto.includes("familias"), "a lista não pode dizer em que outras famílias a pessoa está");
    assert.ok(!bruto.includes("outrasFamilias"), "idem");
  });
});
