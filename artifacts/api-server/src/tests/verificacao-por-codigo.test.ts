/**
 * Confirmar a conta com código de 6 dígitos — Issue #77.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O QUE ESTE ARQUIVO EXISTE PARA IMPEDIR
 *
 * Seis dígitos são um milhão de combinações. O token que isto substituiu tinha
 * 2^256. A troca só não é um rebaixamento de segurança porque o servidor
 * **conta as tentativas e desiste na quinta**. Se alguém, um dia, "simplificar"
 * a rota e tirar o `UPDATE attempts`, nada na tela muda, nenhum outro teste
 * quebra, e o código passa a ser adivinhável em minutos.
 *
 * É esse `UPDATE` que os testes abaixo guardam.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * O segundo tema é **anti-enumeração**: código errado, expirado, já usado,
 * esgotado e conta inexistente respondem exatamente a mesma coisa. Num app de
 * saúde, "esta pessoa tem conta aqui" já é informação sensível.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { eq, like, and, desc } from "drizzle-orm";
import { db } from "@workspace/db";
import { usersTable, familiesTable, emailVerificationsTable } from "@workspace/db";
import { hashDoCodigo, MAX_TENTATIVAS } from "../lib/codigo-de-verificacao.ts";
import { Clock } from "../lib/clock.ts";
import app from "../app.ts";

const SUFIXO = "@codigo-test.zelo.test";

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
  // Por padrão de nome, não por id: recolhe também o lixo de execuções que
  // morreram antes de chegar aqui. Mesma regra do `auth.test.ts`.
  await db.delete(usersTable).where(like(usersTable.email, `%${SUFIXO}`));
  await db.delete(familiesTable).where(like(familiesTable.name, "Família Fictícia Código %"));
});

async function api(method: string, path: string, body?: unknown) {
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
          ...(payload ? { "Content-Length": Buffer.byteLength(payload) } : {}),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk: Buffer) => (data += chunk.toString()));
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

/**
 * Cria uma conta pendente com um código conhecido.
 *
 * Direto no banco de propósito: passar pelo `/auth/register` faria o código ser
 * sorteado, e o teste não teria como saber qual é — nem deveria, porque em
 * desenvolvimento a conta se auto-verifica antes de qualquer código valer.
 */
async function contaPendente(codigo: string, opcoes: { expirado?: boolean; usado?: boolean } = {}) {
  const marca = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const email = `codigo-${marca}${SUFIXO}`;

  await db
    .insert(familiesTable)
    .values({ name: `Família Fictícia Código ${marca}`, slug: `cod-${marca}` });

  const [user] = await db
    .insert(usersTable)
    .values({
      email,
      name: "Pessoa Fictícia Código",
      passwordHash: "nao-usado-neste-teste",
      emailVerified: false,
      status: "pending_verification",
    })
    .returning({ id: usersTable.id });

  const agora = Clock.now();
  await db.insert(emailVerificationsTable).values({
    userId: user.id,
    tokenHash: hashDoCodigo(user.id, codigo),
    expiresAt: opcoes.expirado
      ? new Date(agora.getTime() - 60 * 1000)
      : new Date(agora.getTime() + 10 * 60 * 1000),
    used: opcoes.usado ?? false,
  });

  return { email, userId: user.id };
}

async function estaVerificado(userId: number): Promise<boolean> {
  const [u] = await db
    .select({ v: usersTable.emailVerified })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);
  return u?.v ?? false;
}

async function tentativas(userId: number): Promise<number> {
  const [r] = await db
    .select({ n: emailVerificationsTable.attempts })
    .from(emailVerificationsTable)
    .where(eq(emailVerificationsTable.userId, userId))
    .orderBy(desc(emailVerificationsTable.id))
    .limit(1);
  return r?.n ?? -1;
}

describe("Confirmação por código — o caminho que funciona", () => {
  it("código certo confirma a conta", async () => {
    const { email, userId } = await contaPendente("482915");

    const res = await api("POST", "/auth/verify-email", { email, codigo: "482915" });

    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(await estaVerificado(userId), true, "a conta precisa ficar verificada");
  });

  it("aceita o código como ele costuma chegar colado — com espaço", async () => {
    const { email, userId } = await contaPendente("482915");
    const res = await api("POST", "/auth/verify-email", { email, codigo: " 482 915 " });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(await estaVerificado(userId), true);
  });

  it("o e-mail não precisa vir com a caixa certa", async () => {
    const { email, userId } = await contaPendente("482915");
    const res = await api("POST", "/auth/verify-email", {
      email: email.toUpperCase(),
      codigo: "482915",
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(await estaVerificado(userId), true);
  });

  it("o mesmo código não serve duas vezes", async () => {
    const { email } = await contaPendente("482915");
    assert.equal((await api("POST", "/auth/verify-email", { email, codigo: "482915" })).status, 200);
    const segunda = await api("POST", "/auth/verify-email", { email, codigo: "482915" });
    assert.equal(segunda.status, 400, "código de uso único não pode ser reaproveitado");
  });
});

describe("Confirmação por código — força bruta", () => {
  it("CADA erro é contado — é isto que torna um milhão de combinações inviável", async () => {
    const { email, userId } = await contaPendente("482915");

    await api("POST", "/auth/verify-email", { email, codigo: "000000" });
    assert.equal(await tentativas(userId), 1, "o primeiro erro precisa ser gravado");

    await api("POST", "/auth/verify-email", { email, codigo: "111111" });
    assert.equal(await tentativas(userId), 2, "o contador não pode parar de subir");
  });

  it("na quinta tentativa o código morre — e o certo deixa de valer", async () => {
    const { email, userId } = await contaPendente("482915");

    for (let i = 0; i < MAX_TENTATIVAS; i++) {
      const res = await api("POST", "/auth/verify-email", { email, codigo: "000000" });
      assert.equal(res.status, 400, `tentativa ${i + 1} deveria falhar`);
    }

    // O ponto do teste: mesmo com o código CORRETO, depois do teto acabou.
    const comOCerto = await api("POST", "/auth/verify-email", { email, codigo: "482915" });
    assert.equal(comOCerto.status, 400, "esgotado o limite, nem o código certo passa");
    assert.equal(await estaVerificado(userId), false, "a conta não pode ter sido verificada");
  });

  it("acertar não deixa o contador subir — quem erra é que paga", async () => {
    const { email, userId } = await contaPendente("482915");
    await api("POST", "/auth/verify-email", { email, codigo: "482915" });
    assert.equal(await tentativas(userId), 0);
  });
});

describe("Confirmação por código — anti-enumeração", () => {
  it("conta que não existe responde igualzinho a código errado", async () => {
    const { email } = await contaPendente("482915");

    const inexistente = await api("POST", "/auth/verify-email", {
      email: `nao-existe-${Date.now()}${SUFIXO}`,
      codigo: "482915",
    });
    const codigoErrado = await api("POST", "/auth/verify-email", { email, codigo: "000000" });

    assert.equal(inexistente.status, codigoErrado.status, "o status não pode distinguir");
    assert.deepEqual(
      inexistente.body,
      codigoErrado.body,
      "o corpo também não — senão descobre-se quem tem conta aqui testando e-mails",
    );
  });

  it("código expirado responde igual a código errado", async () => {
    const expirada = await contaPendente("482915", { expirado: true });
    const normal = await contaPendente("482915");

    const comExpirado = await api("POST", "/auth/verify-email", {
      email: expirada.email,
      codigo: "482915",
    });
    const comErrado = await api("POST", "/auth/verify-email", {
      email: normal.email,
      codigo: "000000",
    });

    assert.equal(comExpirado.status, comErrado.status);
    assert.deepEqual(comExpirado.body, comErrado.body);
    assert.equal(await estaVerificado(expirada.userId), false);
  });

  it("corpo malformado não derruba a rota nem responde diferente", async () => {
    const { email } = await contaPendente("482915");
    const referencia = await api("POST", "/auth/verify-email", { email, codigo: "000000" });

    // `timingSafeEqual` LANÇA com tamanhos diferentes; sem a guarda no
    // `conferirHash`, alguns destes virariam 500 — e um 500 no meio de 400s é
    // exatamente o tipo de diferença que se usa para mapear o sistema.
    for (const corpo of [
      {},
      { email },
      { codigo: "482915" },
      { email, codigo: 482915 },
      { email, codigo: "" },
      { email, codigo: "abcdef" },
      { email, codigo: "4829155555" },
      { email, codigo: null },
    ]) {
      const res = await api("POST", "/auth/verify-email", corpo);
      assert.equal(res.status, referencia.status, `corpo ${JSON.stringify(corpo)} respondeu diferente`);
    }
  });
});

describe("Confirmação por código — isolamento entre contas", () => {
  it("o código de uma conta NÃO confirma a de outra", async () => {
    // Com um milhão de combinações, duas contas sorteando o mesmo código é
    // rotina. O hash leva o userId como sal justamente para que isso não
    // signifique nada — este teste é o que prova que o sal está lá.
    const a = await contaPendente("482915");
    const b = await contaPendente("482915");

    const res = await api("POST", "/auth/verify-email", { email: b.email, codigo: "482915" });
    assert.equal(res.status, 200, "cada conta confirma com o próprio código");

    assert.equal(await estaVerificado(a.userId), false, "a conta A não podia ser tocada");
    assert.equal(await estaVerificado(b.userId), true);
  });

  it("errar numa conta não gasta a tentativa da outra", async () => {
    const a = await contaPendente("482915");
    const b = await contaPendente("111111");

    await api("POST", "/auth/verify-email", { email: a.email, codigo: "000000" });

    assert.equal(await tentativas(a.userId), 1);
    assert.equal(await tentativas(b.userId), 0, "o contador é por código, não global");
  });
});

describe("Confirmação por código — só o código mais recente vale", () => {
  it("emitir um código novo aposenta o anterior", async () => {
    const { email, userId } = await contaPendente("111111");

    // Um segundo código, como um reenvio faria.
    await db.insert(emailVerificationsTable).values({
      userId,
      tokenHash: hashDoCodigo(userId, "222222"),
      expiresAt: new Date(Clock.now().getTime() + 10 * 60 * 1000),
    });

    // Cada código vivo é mais cinco tentativas oferecidas ao atacante. A rota
    // olha só o mais recente.
    const antigo = await api("POST", "/auth/verify-email", { email, codigo: "111111" });
    assert.equal(antigo.status, 400, "o código anterior não pode continuar valendo");

    const novo = await api("POST", "/auth/verify-email", { email, codigo: "222222" });
    assert.equal(novo.status, 200, JSON.stringify(novo.body));
  });
});

describe("Confirmação por código — o que fica no banco", () => {
  it("o código NUNCA é gravado em claro", async () => {
    const { userId } = await contaPendente("482915");

    const [linha] = await db
      .select()
      .from(emailVerificationsTable)
      .where(and(eq(emailVerificationsTable.userId, userId)))
      .limit(1);

    assert.ok(linha, "a linha precisa existir");
    assert.ok(!linha.tokenHash.includes("482915"), "o código não pode aparecer no banco");
    assert.match(linha.tokenHash, /^[0-9a-f]{64}$/, "esperava SHA-256 em hex");
  });
});
