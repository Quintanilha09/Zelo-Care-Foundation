/**
 * "Não lembro minha senha atual", de dentro da sessão — Issues #115 e #99.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ESTA ROTA MANDA E-MAIL A PARTIR DE UMA TELA AUTENTICADA. O QUE A IMPEDE DE
 * VIRAR DISPARADOR DE E-MAIL PARA QUALQUER DESTINATÁRIO É UMA COISA SÓ: O
 * ENDEREÇO SAI DO JWT, E O CORPO DA REQUISIÇÃO NÃO É LIDO.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── Por que a rota existe ─────────────────────────────────────────────────
 *
 * Quem entra pelo login salvo no celular tem uma sessão viva e nada mais. Para
 * trocar a senha sem lembrar a atual, o caminho era sair da conta e usar
 * "Recuperar" — jogar fora a única credencial que ainda tem. Se o e-mail
 * atrasar ou o endereço do cadastro estiver errado, a pessoa fica sem sessão
 * **e** sem senha.
 *
 * ── O que este arquivo guarda ─────────────────────────────────────────────
 *
 * Quatro coisas que, se alguém "simplificar", **não mudam nada na tela** e não
 * quebram nenhum outro teste:
 *
 *   1. o corpo não escolhe o destinatário
 *   2. pedir o código não desloga
 *   3. o teto por conta (3/hora) existe
 *   4. um código vivo por vez
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { eq, like } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  usersTable,
  familiesTable,
  caregiversTable,
  passwordResetsTable,
} from "@workspace/db";
import { generateAccessToken } from "../lib/tokens.ts";
import { hashPassword } from "../lib/password.ts";
import app from "../app.ts";

const SUFIXO = "@sessao-senha.zelo.test";
const SENHA = "senha-do-teste-123";
/** Precisa bater com o `MAX_CODIGOS_AUTENTICADO_POR_HORA` de `routes/account.ts`. */
const TETO_POR_HORA = 3;

let testPort: number;
let closeServer: () => Promise<void>;

before(async () => {
  await new Promise<void>((resolve, reject) => {
    const server = http.createServer(app);
    server.listen(0, "127.0.0.1", () => {
      testPort = (server.address() as { port: number }).port;
      closeServer = () =>
        new Promise((res, rej) => server.close((e) => (e ? rej(e) : res())));
      resolve();
    });
    server.on("error", reject);
  });
});

after(async () => {
  await closeServer();
  await db.delete(usersTable).where(like(usersTable.email, `%${SUFIXO}`));
  await db.delete(familiesTable).where(like(familiesTable.name, "Família Fictícia Sessão %"));
});

/**
 * Um IP diferente a cada chamada.
 *
 * A rota usa `verifyPasswordLimiter`, que conta por IP. Um arquivo que bate
 * dezenas de vezes de `127.0.0.1` esgotaria esse orçamento no meio e mediria
 * o limitador errado — o que este teste quer exercitar é o teto **por conta**.
 */
let contadorDeIp = 0;
function ipUnico(): string {
  contadorDeIp += 1;
  return `10.${(contadorDeIp >> 16) & 255}.${(contadorDeIp >> 8) & 255}.${contadorDeIp & 255}`;
}

async function api(
  metodo: "GET" | "POST",
  path: string,
  opcoes: { token?: string; body?: unknown } = {},
) {
  const payload = opcoes.body ? JSON.stringify(opcoes.body) : undefined;
  return new Promise<{ status: number; body: Record<string, unknown> }>((resolve, reject) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port: testPort,
        path: `/api${path}`,
        method: metodo,
        headers: {
          "Content-Type": "application/json",
          "x-forwarded-for": ipUnico(),
          ...(opcoes.token ? { Authorization: `Bearer ${opcoes.token}` } : {}),
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

/** Conta ativa e autenticada. `comSenha: false` simula conta só do Google. */
async function conta(comSenha = true) {
  const marca = `${Date.now()}${Math.floor(Math.random() * 10000)}`;
  const email = `sessao-${marca}${SUFIXO}`;

  const [family] = await db
    .insert(familiesTable)
    .values({ name: `Família Fictícia Sessão ${marca}`, slug: `sessao-${marca}` })
    .returning({ id: familiesTable.id });

  const [user] = await db
    .insert(usersTable)
    .values({
      email,
      name: "Pessoa Fictícia Sessão",
      passwordHash: comSenha ? await hashPassword(SENHA) : null,
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
      name: "Pessoa Fictícia Sessão",
      email,
      role: "primary_caregiver",
    })
    .returning({ id: caregiversTable.id });

  const token = generateAccessToken(user.id, family.id, caregiver.id, "primary_caregiver");
  return { email, userId: user.id, token };
}

/** Quantos códigos de redefinição esta conta tem, e quantos estão vivos. */
async function codigos(userId: number) {
  const linhas = await db
    .select({ used: passwordResetsTable.used })
    .from(passwordResetsTable)
    .where(eq(passwordResetsTable.userId, userId));
  return { total: linhas.length, vivos: linhas.filter((l) => !l.used).length };
}

describe("Pedir código de senha de dentro da sessão", () => {
  it("manda para o e-mail DA SESSÃO, e o corpo não escolhe o destinatário", async () => {
    const alvo = await conta();
    const vitima = await conta();

    // O atacante tem a sessão do `alvo` e tenta apontar o e-mail para outro
    // endereço. Se a rota lesse o corpo, isto viraria disparador de e-mail.
    const res = await api("POST", "/account/password/reset-code", {
      token: alvo.token,
      body: { email: vitima.email, novoEmail: vitima.email, userId: vitima.userId },
    });

    assert.equal(res.status, 200, JSON.stringify(res.body));

    // O código foi emitido para a conta da SESSÃO...
    const doAlvo = await codigos(alvo.userId);
    assert.equal(doAlvo.total, 1, "o código tem que sair para quem está logado");

    // ...e nenhum código foi emitido para o endereço que o corpo pediu.
    const daVitima = await codigos(vitima.userId);
    assert.equal(daVitima.total, 0, "o corpo da requisição não pode escolher o destinatário");

    // A resposta confirma o destino, mascarado — é o que resolve na hora o
    // caso de "cadastrei com o e-mail errado".
    const mascarado = String(res.body.emailMascarado ?? "");
    assert.ok(mascarado.includes("@"), "precisa dizer para onde foi");
    assert.ok(
      mascarado.startsWith(alvo.email.slice(0, 1)),
      `o mascarado tem que ser o da sessão, veio "${mascarado}"`,
    );
    assert.ok(!mascarado.includes(alvo.email), "não pode escrever o endereço inteiro");
  });

  it("pedir o código NÃO desloga a sessão atual", async () => {
    const c = await conta();

    const pedido = await api("POST", "/account/password/reset-code", { token: c.token });
    assert.equal(pedido.status, 200, JSON.stringify(pedido.body));

    // O mesmo token continua valendo. Este é o ponto inteiro da Issue: quem
    // pede o código tem a sessão como única credencial, e perdê-la aqui
    // recriaria exatamente o problema que a rota existe para resolver.
    const depois = await api("GET", "/account/me", { token: c.token });
    assert.equal(depois.status, 200, "a sessão tinha que continuar viva");
  });

  it("recusa acima de três pedidos por hora, e diz por quê", async () => {
    const c = await conta();

    for (let i = 0; i < TETO_POR_HORA; i++) {
      const ok = await api("POST", "/account/password/reset-code", { token: c.token });
      assert.equal(ok.status, 200, `o pedido ${i + 1} devia passar: ${JSON.stringify(ok.body)}`);
    }

    const recusado = await api("POST", "/account/password/reset-code", { token: c.token });
    assert.equal(recusado.status, 429, "o quarto pedido tem que ser recusado");
    assert.equal(recusado.body.code, "RESET_CODE_LIMIT");
  });

  it("mantém um código vivo por vez", async () => {
    const c = await conta();

    await api("POST", "/account/password/reset-code", { token: c.token });
    await api("POST", "/account/password/reset-code", { token: c.token });

    const { total, vivos } = await codigos(c.userId);
    assert.equal(total, 2, "os dois pedidos ficam registrados");
    assert.equal(
      vivos,
      1,
      "cada código vivo são mais cinco palpites oferecidos a quem estiver adivinhando",
    );
  });

  it("conta sem senha (só Google) é recusada com motivo próprio", async () => {
    const c = await conta(false);

    const res = await api("POST", "/account/password/reset-code", { token: c.token });
    assert.equal(res.status, 400);
    assert.equal(res.body.code, "NO_PASSWORD_SET");

    const { total } = await codigos(c.userId);
    assert.equal(total, 0, "não adianta mandar código de senha para conta que não tem senha");
  });

  it("sem sessão, a rota nem existe", async () => {
    const res = await api("POST", "/account/password/reset-code", { body: { email: "x@y.test" } });
    assert.equal(res.status, 401, "é uma rota autenticada — sem token, 401");
  });
});
