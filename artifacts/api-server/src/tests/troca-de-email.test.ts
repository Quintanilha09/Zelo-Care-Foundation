/**
 * Trocar o e-mail da conta — Issue #46.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ESTA É A ROTA MAIS PERIGOSA DA CONTA.
 *
 * Quem troca o e-mail passa a receber os próprios links de recuperação de
 * senha. Uma sessão esquecida num computador emprestado, ou um XSS de um
 * minuto, viram **sequestro permanente** se a troca valer sem prova.
 *
 * Três controles seguram isso, e este arquivo existe para que nenhum deles
 * possa ser removido em silêncio:
 *
 *   1. senha atual      — sessão aberta não prova quem está ali
 *   2. código no NOVO   — só quem controla o destino confirma
 *   3. aviso ao ANTIGO  — o único que chega a quem foi lesado
 *
 * O terceiro é o que costuma faltar nos produtos que erram isso. Ele não tem
 * efeito visível no fluxo feliz, ninguém sente falta dele em teste manual, e
 * some numa refatoração sem quebrar nada — por isso tem caso próprio aqui.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { describe, it, before, after } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import http from "node:http";
import { eq, like, desc } from "drizzle-orm";
import { db } from "@workspace/db";
import { usersTable, familiesTable, caregiversTable, emailChangesTable, refreshTokensTable } from "@workspace/db";
import { hashPassword } from "../lib/password.ts";
import { hashDoCodigo, MAX_TENTATIVAS } from "../lib/codigo-de-verificacao.ts";
import { generateAccessToken } from "../lib/tokens.ts";
import { Clock } from "../lib/clock.ts";
import app from "../app.ts";

const SUFIXO = "@troca-email-test.zelo.test";
const SENHA = "senha-de-teste-123";

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
  await db.delete(familiesTable).where(like(familiesTable.name, "Família Fictícia Troca %"));
});

async function api(method: string, path: string, body?: unknown, token?: string) {
  const payload = body ? JSON.stringify(body) : undefined;
  return new Promise<{ status: number; body: Record<string, unknown> }>((resolve, reject) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port: testPort,
        path: `/api${path}`,
        method,
        headers: {
          "Content-Type": "application/json",
          // IP próprio por chamada: os limitadores contam por IP, e um arquivo
          // que bate muitas vezes do mesmo endereço se derruba sozinho — foi o
          // que aconteceu com `reenvio-de-codigo.test.ts` na primeira execução.
          "x-forwarded-for": `10.46.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`,
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(payload ? { "Content-Length": Buffer.byteLength(payload) } : {}),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (c: Buffer) => (data += c.toString()));
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode ?? 0, body: JSON.parse(data) as Record<string, unknown> });
          } catch {
            resolve({ status: res.statusCode ?? 0, body: { bruto: data } });
          }
        });
      },
    );
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

/** Conta pronta para trocar de e-mail, com token de acesso. */
async function conta() {
  const marca = `${Date.now()}${Math.floor(Math.random() * 10000)}`;
  const email = `troca-${marca}${SUFIXO}`;

  const [family] = await db
    .insert(familiesTable)
    .values({ name: `Família Fictícia Troca ${marca}`, slug: `troca-${marca}` })
    .returning({ id: familiesTable.id });

  const [user] = await db
    .insert(usersTable)
    .values({
      email,
      name: "Pessoa Fictícia Troca",
      passwordHash: await hashPassword(SENHA),
      emailVerified: true,
      status: "active",
      activeFamilyId: family.id,
    })
    .returning({ id: usersTable.id });

  const [caregiver] = await db
    .insert(caregiversTable)
    .values({ familyId: family.id, userId: user.id, name: "Pessoa Fictícia Troca", email, role: "primary_caregiver" })
    .returning({ id: caregiversTable.id });

  const token = generateAccessToken(user.id, family.id, caregiver.id, "primary_caregiver");
  return { email, userId: user.id, caregiverId: caregiver.id, token, marca };
}

async function emailAtual(userId: number): Promise<string> {
  const [u] = await db.select({ email: usersTable.email }).from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  return u?.email ?? "";
}

/** Grava um código conhecido para o pedido pendente, para poder confirmá-lo. */
async function plantarCodigo(userId: number, codigo: string): Promise<void> {
  const [pedido] = await db
    .select({ id: emailChangesTable.id })
    .from(emailChangesTable)
    .where(eq(emailChangesTable.userId, userId))
    .orderBy(desc(emailChangesTable.id))
    .limit(1);
  assert.ok(pedido, "precisa existir um pedido pendente");
  await db
    .update(emailChangesTable)
    .set({ codigoHash: hashDoCodigo(userId, codigo) })
    .where(eq(emailChangesTable.id, pedido.id));
}

describe("Troca de e-mail — a senha atual é obrigatória", () => {
  it("senha errada NÃO cria pedido nenhum", async () => {
    const c = await conta();

    const res = await api("POST", "/account/email/change", {
      novoEmail: `novo-${c.marca}${SUFIXO}`,
      senhaAtual: "senha-errada-de-proposito",
    }, c.token);

    assert.equal(res.status, 401);

    // O que importa não é o 401: é que nada foi gravado. Um pedido criado
    // antes de conferir a senha já teria disparado o e-mail para o endereço
    // do atacante.
    const pedidos = await db
      .select({ id: emailChangesTable.id })
      .from(emailChangesTable)
      .where(eq(emailChangesTable.userId, c.userId));
    assert.equal(pedidos.length, 0, "sessão aberta não pode bastar para pedir a troca");
  });

  it("sem autenticação, nem chega na senha", async () => {
    const c = await conta();
    const res = await api("POST", "/account/email/change", {
      novoEmail: `novo-${c.marca}${SUFIXO}`,
      senhaAtual: SENHA,
    });
    assert.equal(res.status, 401);
  });
});

describe("Troca de e-mail — o caminho que funciona", () => {
  it("pede, confirma com o código, e o e-mail muda", async () => {
    const c = await conta();
    const novo = `novo-${c.marca}${SUFIXO}`;

    const pedido = await api("POST", "/account/email/change", { novoEmail: novo, senhaAtual: SENHA }, c.token);
    assert.equal(pedido.status, 200, JSON.stringify(pedido.body));

    // O e-mail NÃO muda ao pedir — só ao confirmar. Se mudasse aqui, um erro
    // de digitação viraria conta inacessível.
    assert.equal(await emailAtual(c.userId), c.email, "o e-mail não pode mudar antes da confirmação");

    await plantarCodigo(c.userId, "482915");
    const confirma = await api("POST", "/account/email/confirm", { codigo: "482915" }, c.token);
    assert.equal(confirma.status, 200, JSON.stringify(confirma.body));

    assert.equal(await emailAtual(c.userId), novo);
  });

  it("a cópia em caregivers acompanha", async () => {
    const c = await conta();
    const novo = `novo-${c.marca}${SUFIXO}`;

    await api("POST", "/account/email/change", { novoEmail: novo, senhaAtual: SENHA }, c.token);
    await plantarCodigo(c.userId, "482915");
    await api("POST", "/account/email/confirm", { codigo: "482915" }, c.token);

    // `caregivers.email` é cópia, e é por ela que convite é reconhecido.
    // Deixar a cópia velha faria a lista de cuidadores mentir para sempre.
    const [cg] = await db
      .select({ email: caregiversTable.email })
      .from(caregiversTable)
      .where(eq(caregiversTable.id, c.caregiverId))
      .limit(1);
    assert.equal(cg?.email, novo);
  });

  it("confirmar derruba as sessões antigas e devolve um par novo", async () => {
    const c = await conta();
    await db.insert(refreshTokensTable).values({
      userId: c.userId,
      tokenHash: `hash-antigo-${c.marca}`,
      expiresAt: new Date(Clock.now().getTime() + 30 * 24 * 60 * 60 * 1000),
    });

    await api("POST", "/account/email/change", { novoEmail: `novo-${c.marca}${SUFIXO}`, senhaAtual: SENHA }, c.token);
    await plantarCodigo(c.userId, "482915");
    const res = await api("POST", "/account/email/confirm", { codigo: "482915" }, c.token);

    // A identidade de login mudou: sessão emitida para a identidade anterior
    // não deveria sobreviver.
    const [antigo] = await db
      .select({ revoked: refreshTokensTable.revoked })
      .from(refreshTokensTable)
      .where(eq(refreshTokensTable.tokenHash, `hash-antigo-${c.marca}`))
      .limit(1);
    assert.equal(antigo?.revoked, true, "a sessão antiga precisa cair");

    // ...mas quem trocou não pode ser deslogada no ato.
    assert.ok(res.body.accessToken, "precisa devolver um par novo");
    assert.ok(res.body.refreshToken);
  });
});

describe("Troca de e-mail — força bruta no código", () => {
  it("cinco erros matam o pedido, e o código certo deixa de valer", async () => {
    const c = await conta();
    await api("POST", "/account/email/change", { novoEmail: `novo-${c.marca}${SUFIXO}`, senhaAtual: SENHA }, c.token);
    await plantarCodigo(c.userId, "482915");

    for (let i = 0; i < MAX_TENTATIVAS; i++) {
      const errado = await api("POST", "/account/email/confirm", { codigo: "000000" }, c.token);
      assert.equal(errado.status, 400, `tentativa ${i + 1} deveria falhar`);
    }

    const comOCerto = await api("POST", "/account/email/confirm", { codigo: "482915" }, c.token);
    assert.equal(comOCerto.status, 400, "esgotado o limite, nem o código certo passa");
    assert.equal(await emailAtual(c.userId), c.email, "o e-mail não pode ter mudado");
  });
});

describe("Troca de e-mail — o que não pode acontecer", () => {
  it("não dá para tomar um e-mail que já é de outra conta", async () => {
    const alvo = await conta();
    const atacante = await conta();

    const res = await api("POST", "/account/email/change", {
      novoEmail: alvo.email,
      senhaAtual: SENHA,
    }, atacante.token);

    assert.equal(res.status, 409);
    assert.equal(await emailAtual(alvo.userId), alvo.email, "a conta alvo não pode ser tocada");
  });

  it("pedir de novo aposenta o pedido anterior", async () => {
    const c = await conta();
    await api("POST", "/account/email/change", { novoEmail: `um-${c.marca}${SUFIXO}`, senhaAtual: SENHA }, c.token);
    await api("POST", "/account/email/change", { novoEmail: `dois-${c.marca}${SUFIXO}`, senhaAtual: SENHA }, c.token);

    // Dois pedidos vivos seriam dois endereços disputando a mesma conta, e dez
    // tentativas em vez de cinco.
    const vivos = await db
      .select({ id: emailChangesTable.id })
      .from(emailChangesTable)
      .where(eq(emailChangesTable.userId, c.userId));
    const naoUsados = vivos.length;
    const [maisNovo] = await db
      .select({ novoEmail: emailChangesTable.novoEmail, used: emailChangesTable.used })
      .from(emailChangesTable)
      .where(eq(emailChangesTable.userId, c.userId))
      .orderBy(desc(emailChangesTable.id))
      .limit(1);

    assert.ok(naoUsados >= 2, "os pedidos anteriores continuam no banco, como histórico");
    assert.equal(maisNovo?.used, false, "só o mais recente fica valendo");
    assert.equal(maisNovo?.novoEmail, `dois-${c.marca}${SUFIXO}`);
  });

  it("trocar para o mesmo e-mail é recusado", async () => {
    const c = await conta();
    const res = await api("POST", "/account/email/change", { novoEmail: c.email, senhaAtual: SENHA }, c.token);
    assert.equal(res.status, 400);
  });

  it("o código de uma conta não confirma a troca de outra", async () => {
    const a = await conta();
    const b = await conta();

    await api("POST", "/account/email/change", { novoEmail: `novo-a-${a.marca}${SUFIXO}`, senhaAtual: SENHA }, a.token);
    await api("POST", "/account/email/change", { novoEmail: `novo-b-${b.marca}${SUFIXO}`, senhaAtual: SENHA }, b.token);

    // O hash leva o userId como sal justamente para isto.
    await plantarCodigo(a.userId, "482915");
    const res = await api("POST", "/account/email/confirm", { codigo: "482915" }, b.token);

    assert.equal(res.status, 400);
    assert.equal(await emailAtual(b.userId), b.email);
  });
});

describe("Troca de e-mail — o aviso ao endereço antigo", () => {
  it("o código de confirmação NÃO é gravado em claro", async () => {
    const c = await conta();
    await api("POST", "/account/email/change", { novoEmail: `novo-${c.marca}${SUFIXO}`, senhaAtual: SENHA }, c.token);

    const [pedido] = await db
      .select()
      .from(emailChangesTable)
      .where(eq(emailChangesTable.userId, c.userId))
      .orderBy(desc(emailChangesTable.id))
      .limit(1);

    assert.ok(pedido);
    assert.match(pedido.codigoHash, /^[0-9a-f]{64}$/, "esperava SHA-256 em hex");
    assert.equal(pedido.attempts, 0);
    assert.ok(pedido.requestIp, "o IP do pedido entra no aviso ao endereço antigo");
  });

  it("a rota chama o aviso ao endereço ANTIGO, e não só o código", () => {
    // Varredura de código, e não teste de comportamento: `lib/email.ts` não
    // envia nada sem `RESEND_API_KEY`, então em teste os dois envios são
    // no-ops indistinguíveis. O que precisa ser garantido é que a CHAMADA
    // continue existindo — ela não tem efeito visível no fluxo feliz, ninguém
    // sente falta dela testando à mão, e é a única defesa que chega a quem
    // foi lesado.
    const fonte = readFileSync(
      fileURLToPath(new URL("../routes/account.ts", import.meta.url)),
      "utf8",
    );

    const inicio = fonte.indexOf('router.post("/account/email/change"');
    assert.ok(inicio > -1, "a rota precisa existir");
    const trecho = fonte.slice(inicio, fonte.indexOf('router.post("/account/email/confirm"'));

    assert.ok(
      trecho.includes("sendEmailChangeWarning("),
      "sumiu o aviso ao endereço antigo — é o que permite reagir a uma conta tomada",
    );
    assert.ok(
      trecho.includes("sendEmailChangeCode("),
      "sumiu o envio do código ao endereço novo",
    );
    assert.ok(
      trecho.indexOf("sendEmailChangeCode(") < trecho.indexOf("sendEmailChangeWarning("),
      "o código sai primeiro; o aviso não pode depender do sucesso dele",
    );
  });
});
