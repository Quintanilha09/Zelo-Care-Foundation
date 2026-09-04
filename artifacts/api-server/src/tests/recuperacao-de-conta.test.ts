/**
 * E-mail de recuperação: o que ele PODE e o que ele NÃO PODE — Issue #87.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ESTE ARQUIVO EXISTE PARA AS TRÊS NEGATIVAS.
 *
 * O e-mail de recuperação só é uma boa ideia porque o poder dele é MENOR que o
 * do e-mail principal: ele recebe o código de aparelho novo (#79) e nada mais.
 * Se um dia ele puder redefinir senha, trocar o e-mail principal ou entrar
 * sozinho, cadastrar um reserva passa a DOBRAR a superfície de ataque com o
 * mesmo poder — e o que parecia rede de proteção vira a porta mais fácil.
 *
 * O limite não está escrito como regra em lugar nenhum. Ele é consequência de
 * `login`, `password-reset/request` e `account/email/change` procurarem por
 * `users.email` e nunca por `users.recoveryEmail`. Uma consulta trocada por
 * engano no futuro devolveria o poder inteiro **sem nenhum sintoma visível**:
 * nenhuma tela mudaria, nenhum outro teste quebraria.
 *
 * É exatamente o tipo de defeito que só um teste dedicado pega.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { eq, like, and, desc } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  usersTable,
  familiesTable,
  caregiversTable,
  passwordResetsTable,
  recoveryEmailsTable,
} from "@workspace/db";
import { hashPassword } from "../lib/password.ts";
import { generateAccessToken } from "../lib/tokens.ts";
import { hashDoCodigo, MAX_TENTATIVAS } from "../lib/codigo-de-verificacao.ts";
import { Clock } from "../lib/clock.ts";
import app from "../app.ts";

const SUFIXO = "@recuperacao-test.zelo.test";
const SENHA = "senha-do-teste-987";

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
  await db.delete(familiesTable).where(like(familiesTable.name, "Família Fictícia Recuperacao %"));
});

/** Um IP por chamada — os limitadores contam por IP, e a suíte estoura o teto. */
let contadorDeIp = 0;
function ipUnico(): string {
  contadorDeIp += 1;
  return `10.${(contadorDeIp >> 16) & 255}.${(contadorDeIp >> 8) & 255}.${contadorDeIp & 255}`;
}

async function api(
  metodo: string,
  path: string,
  body?: unknown,
  token?: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const payload = body ? JSON.stringify(body) : undefined;
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port: testPort,
        path: `/api${path}`,
        method: metodo,
        headers: {
          "Content-Type": "application/json",
          "x-forwarded-for": ipUnico(),
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

/** Conta ativa, com família e cuidador, e opcionalmente um reserva confirmado. */
async function conta(opcoes: { reserva?: string } = {}) {
  const marca = `${Date.now()}${Math.floor(Math.random() * 100000)}`;
  const email = `titular-${marca}${SUFIXO}`;

  const [familia] = await db
    .insert(familiesTable)
    .values({ name: `Família Fictícia Recuperacao ${marca}`, slug: `recup-${marca}` })
    .returning({ id: familiesTable.id });

  const [user] = await db
    .insert(usersTable)
    .values({
      email,
      name: "Pessoa Fictícia Recuperacao",
      passwordHash: await hashPassword(SENHA),
      emailVerified: true,
      status: "active",
      activeFamilyId: familia!.id,
      recoveryEmail: opcoes.reserva ?? null,
      recoveryEmailAt: opcoes.reserva ? Clock.now() : null,
    })
    .returning({ id: usersTable.id });

  const [cuidador] = await db
    .insert(caregiversTable)
    .values({
      familyId: familia!.id,
      userId: user!.id,
      name: "Pessoa Fictícia Recuperacao",
      role: "primary_caregiver",
    })
    .returning({ id: caregiversTable.id });

  const token = generateAccessToken(user!.id, familia!.id, cuidador!.id, "primary_caregiver");

  return { email, userId: user!.id, familyId: familia!.id, token };
}

// ═══════════════════════════════════════════════════════════════════════════
// AS TRÊS NEGATIVAS
// ═══════════════════════════════════════════════════════════════════════════

describe("O e-mail de recuperação NÃO redefine a senha", () => {
  it("pedir redefinição pelo endereço reserva não gera código nenhum", async () => {
    const reserva = `reserva-${Date.now()}${SUFIXO}`;
    const { userId } = await conta({ reserva });

    const res = await api("POST", "/auth/password-reset/request", { email: reserva });

    // A resposta é a genérica de sempre — antienumeração vale aqui como em
    // qualquer outro endereço desconhecido.
    assert.equal(res.status, 200);

    const codigos = await db
      .select({ id: passwordResetsTable.id })
      .from(passwordResetsTable)
      .where(eq(passwordResetsTable.userId, userId));

    assert.equal(
      codigos.length,
      0,
      "o endereço reserva gerou um código de redefinição — ele virou uma segunda chave da mesma porta, e a Issue #87 inteira depende de ele NÃO ser isso",
    );
  });

  it("pelo endereço principal, o código é gerado normalmente", async () => {
    // Caso de controle. Sem ele, o teste acima passaria com a rota de
    // redefinição quebrada por completo.
    const { email, userId } = await conta({ reserva: `reserva-c-${Date.now()}${SUFIXO}` });

    await api("POST", "/auth/password-reset/request", { email });

    const codigos = await db
      .select({ id: passwordResetsTable.id })
      .from(passwordResetsTable)
      .where(eq(passwordResetsTable.userId, userId));

    assert.equal(codigos.length, 1, "o endereço principal precisa continuar funcionando");
  });
});

describe("O e-mail de recuperação NÃO entra sozinho", () => {
  it("login com o endereço reserva e a senha certa é recusado", async () => {
    const reserva = `reserva-login-${Date.now()}${SUFIXO}`;
    await conta({ reserva });

    const res = await api("POST", "/auth/login", { email: reserva, password: SENHA });

    assert.notEqual(res.status, 200, "o endereço reserva não pode abrir sessão");
    assert.equal(res.body.accessToken, undefined, "nenhum token pode sair daqui");
  });

  it("com o endereço principal e a mesma senha, entra", async () => {
    // Controle: prova que a recusa acima é do endereço, e não da senha.
    const { email } = await conta({ reserva: `reserva-l2-${Date.now()}${SUFIXO}` });

    const res = await api("POST", "/auth/login", { email, password: SENHA });

    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.ok(res.body.accessToken, "o endereço principal precisa continuar entrando");
  });
});

describe("O e-mail de recuperação NÃO troca o e-mail principal", () => {
  it("o reserva confirmado não vira o e-mail de acesso sozinho", async () => {
    const reserva = `reserva-troca-${Date.now()}${SUFIXO}`;
    const { email, userId } = await conta({ reserva });

    const [depois] = await db
      .select({ email: usersTable.email, recoveryEmail: usersTable.recoveryEmail })
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .limit(1);

    assert.equal(depois?.email, email, "o e-mail de acesso não pode ter mudado");
    assert.equal(depois?.recoveryEmail, reserva);
    assert.notEqual(depois?.email, depois?.recoveryEmail, "os dois papéis são distintos");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// O CADASTRO DO RESERVA
// ═══════════════════════════════════════════════════════════════════════════

describe("Cadastrar o endereço reserva", () => {
  it("recusa um reserva igual ao e-mail da conta", async () => {
    // O erro de digitação mais comum é escrever o mesmo endereço duas vezes —
    // e um reserva igual ao principal é zero rede de proteção com a aparência
    // de uma.
    const { email, token } = await conta();

    const res = await api("POST", "/account/recovery-email", { email }, token);

    assert.equal(res.status, 400);
    assert.equal(res.body.code, "RECOVERY_IGUAL_AO_PRINCIPAL");
  });

  it("recusa em maiúsculas também — o mesmo endereço é o mesmo endereço", async () => {
    const { email, token } = await conta();

    const res = await api("POST", "/account/recovery-email", { email: email.toUpperCase() }, token);

    assert.equal(res.status, 400);
    assert.equal(res.body.code, "RECOVERY_IGUAL_AO_PRINCIPAL");
  });

  it("o pedido NÃO grava o reserva antes de confirmar", async () => {
    // Endereço não verificado é pior que nenhum: dá a sensação de rede de
    // proteção sem entregar rede, e a pessoa só descobre no dia em que cai.
    const { userId, token } = await conta();

    await api("POST", "/account/recovery-email", { email: `novo-${Date.now()}${SUFIXO}` }, token);

    const [user] = await db
      .select({ recoveryEmail: usersTable.recoveryEmail })
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .limit(1);

    assert.equal(user?.recoveryEmail, null, "o reserva só existe depois do código");
  });

  it("confirma com o código certo, e aí sim grava", async () => {
    const { userId, token } = await conta();
    const reserva = `novo-ok-${Date.now()}${SUFIXO}`;

    await api("POST", "/account/recovery-email", { email: reserva }, token);

    // O código cru só existe no e-mail. Aqui ele é reescrito no banco, que é a
    // forma de o teste conhecê-lo sem ler correio.
    await db
      .update(recoveryEmailsTable)
      .set({ codigoHash: hashDoCodigo(userId, "482915") })
      .where(and(eq(recoveryEmailsTable.userId, userId), eq(recoveryEmailsTable.used, false)));

    const res = await api("POST", "/account/recovery-email/confirm", { codigo: "482915" }, token);
    assert.equal(res.status, 200, JSON.stringify(res.body));

    const [user] = await db
      .select({ recoveryEmail: usersTable.recoveryEmail, quando: usersTable.recoveryEmailAt })
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .limit(1);

    assert.equal(user?.recoveryEmail, reserva);
    assert.ok(user?.quando, "a data de confirmação precisa ficar registrada");
  });

  it("um pedido novo aposenta o anterior", async () => {
    // Dois códigos vivos seriam dez tentativas em vez de cinco, e dois
    // endereços concorrendo pela mesma conta.
    const { userId, token } = await conta();

    await api("POST", "/account/recovery-email", { email: `a-${Date.now()}${SUFIXO}` }, token);
    await api("POST", "/account/recovery-email", { email: `b-${Date.now()}${SUFIXO}` }, token);

    const vivos = await db
      .select({ id: recoveryEmailsTable.id })
      .from(recoveryEmailsTable)
      .where(and(eq(recoveryEmailsTable.userId, userId), eq(recoveryEmailsTable.used, false)));

    assert.equal(vivos.length, 1);
  });
});

describe("O contador de tentativas do código", () => {
  it(`na tentativa ${MAX_TENTATIVAS + 1} o código está morto, mesmo se for o certo`, async () => {
    const { userId, token } = await conta();

    await api("POST", "/account/recovery-email", { email: `forca-${Date.now()}${SUFIXO}` }, token);
    await db
      .update(recoveryEmailsTable)
      .set({ codigoHash: hashDoCodigo(userId, "482915") })
      .where(and(eq(recoveryEmailsTable.userId, userId), eq(recoveryEmailsTable.used, false)));

    for (let i = 0; i < MAX_TENTATIVAS; i += 1) {
      const errado = await api("POST", "/account/recovery-email/confirm", { codigo: "000000" }, token);
      assert.equal(errado.status, 400, `a tentativa ${i + 1} devia falhar`);
    }

    const certo = await api("POST", "/account/recovery-email/confirm", { codigo: "482915" }, token);
    assert.equal(certo.status, 400, "código esgotado precisa continuar recusando");

    const [user] = await db
      .select({ recoveryEmail: usersTable.recoveryEmail })
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .limit(1);

    assert.equal(user?.recoveryEmail, null);
  });

  it("o erro é gravado no banco, e não contado em memória", async () => {
    const { userId, token } = await conta();

    await api("POST", "/account/recovery-email", { email: `grava-${Date.now()}${SUFIXO}` }, token);
    await api("POST", "/account/recovery-email/confirm", { codigo: "111111" }, token);

    const [linha] = await db
      .select({ attempts: recoveryEmailsTable.attempts })
      .from(recoveryEmailsTable)
      .where(eq(recoveryEmailsTable.userId, userId))
      .orderBy(desc(recoveryEmailsTable.id))
      .limit(1);

    assert.equal(linha?.attempts, 1);
  });
});

describe("Remover o reserva exige a senha", () => {
  it("sem a senha certa, o reserva continua lá", async () => {
    // A assimetria com o cadastro é de propósito: cadastrar não tira proteção
    // de ninguém, remover tira. Um atacante com sessão aberta que apagasse o
    // reserva em silêncio deixaria a vítima sem caminho de volta justamente
    // antes de tomar a conta.
    const reserva = `remove-${Date.now()}${SUFIXO}`;
    const { userId, token } = await conta({ reserva });

    const res = await api("DELETE", "/account/recovery-email", { senhaAtual: "chute-errado" }, token);
    assert.equal(res.status, 401);

    const [user] = await db
      .select({ recoveryEmail: usersTable.recoveryEmail })
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .limit(1);

    assert.equal(user?.recoveryEmail, reserva, "o reserva não podia sair sem a senha");
  });

  it("com a senha certa, sai", async () => {
    const { userId, token } = await conta({ reserva: `remove-ok-${Date.now()}${SUFIXO}` });

    const res = await api("DELETE", "/account/recovery-email", { senhaAtual: SENHA }, token);
    assert.equal(res.status, 200, JSON.stringify(res.body));

    const [user] = await db
      .select({ recoveryEmail: usersTable.recoveryEmail, quando: usersTable.recoveryEmailAt })
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .limit(1);

    assert.equal(user?.recoveryEmail, null);
    assert.equal(user?.quando, null);
  });
});

describe("Sem sessão não se faz nada", () => {
  it("as três rotas exigem autenticação", async () => {
    for (const [metodo, caminho] of [
      ["GET", "/account/recovery-email"],
      ["POST", "/account/recovery-email"],
      ["DELETE", "/account/recovery-email"],
    ] as const) {
      const res = await api(metodo, caminho, { email: `x${SUFIXO}`, senhaAtual: SENHA });
      assert.equal(res.status, 401, `${metodo} ${caminho} respondeu ${res.status}`);
    }
  });
});
