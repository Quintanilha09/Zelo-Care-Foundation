/**
 * Redefinir a senha por código de 6 dígitos — Issue #102.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * SEIS DÍGITOS SÃO UM MILHÃO DE COMBINAÇÕES. O TOKEN QUE ISTO SUBSTITUI TINHA
 * 2^256, E ESTE CÓDIGO DÁ ACESSO À CONTA INTEIRA. A TROCA SÓ NÃO É UM
 * REBAIXAMENTO POR CAUSA DE DUAS CONTAGENS: TENTATIVAS POR CÓDIGO, E CÓDIGOS
 * POR HORA.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── Por que a troca aconteceu ─────────────────────────────────────────────
 *
 * Em 03/09/2026 o fundador ficou sem conseguir trocar a senha. O e-mail chegou
 * perfeito e o link levava a uma página de erro do Replit: `APP_URL` apontava
 * para um app que nunca foi publicado. Foi o terceiro tropeço na mesma
 * variável em dois dias — antes ela esteve ausente e depois sem `https://`.
 *
 * Três configurações diferentes, um sintoma só. O problema não era a variável:
 * era depender de link.
 *
 * ── O que este arquivo guarda ─────────────────────────────────────────────
 *
 * As contagens. Se alguém "simplificar" a rota e tirar o `attempts` ou o teto
 * por conta, **nada na tela muda** e nenhum outro teste quebra — e a conta de
 * segurança acima deixa de valer em silêncio.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { eq, like, desc, and } from "drizzle-orm";
import { db } from "@workspace/db";
import { usersTable, familiesTable, passwordResetsTable } from "@workspace/db";
import {
  hashDoCodigo,
  MAX_TENTATIVAS,
  MAX_CODIGOS_POR_HORA,
  PISO_DE_RESPOSTA_MS,
} from "../lib/codigo-de-verificacao.ts";
import { Clock } from "../lib/clock.ts";
import app from "../app.ts";

const SUFIXO = "@senha-test.zelo.test";
const SENHA_NOVA = "senha-nova-do-teste-123";

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
  await db.delete(familiesTable).where(like(familiesTable.name, "Família Fictícia Senha %"));
});

/**
 * Um IP diferente a cada chamada.
 *
 * `passwordResetLimiter` conta por `ip:email`, e um arquivo que bate dezenas
 * de vezes de `127.0.0.1` esgotaria o orçamento no meio — foi o que derrubou
 * `reenvio-de-codigo.test.ts` na primeira execução dele.
 *
 * Rotacionar IP não contorna a proteção: é **exercitar exatamente o que o teto
 * por CONTA existe para cobrir**. A defesa por IP cai contra quem tem muitos
 * IPs; a defesa por conta, não. O teste passa a simular um atacante com
 * botnet — o cenário real.
 */
let contadorDeIp = 0;
function ipUnico(): string {
  contadorDeIp += 1;
  return `10.${(contadorDeIp >> 16) & 255}.${(contadorDeIp >> 8) & 255}.${contadorDeIp & 255}`;
}

async function api(path: string, body?: unknown, ip: string = ipUnico()) {
  const payload = body ? JSON.stringify(body) : undefined;
  return new Promise<{ status: number; body: Record<string, unknown>; ms: number }>(
    (resolve, reject) => {
      const t0 = performance.now();
      const req = http.request(
        {
          hostname: "127.0.0.1",
          port: testPort,
          path: `/api${path}`,
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-forwarded-for": ip,
            ...(payload ? { "Content-Length": Buffer.byteLength(payload) } : {}),
          },
        },
        (res) => {
          let data = "";
          res.on("data", (c: Buffer) => (data += c.toString()));
          res.on("end", () => {
            const ms = performance.now() - t0;
            try {
              resolve({
                status: res.statusCode ?? 0,
                body: JSON.parse(data) as Record<string, unknown>,
                ms,
              });
            } catch {
              resolve({ status: res.statusCode ?? 0, body: { bruto: data }, ms });
            }
          });
        },
      );
      req.on("error", reject);
      if (payload) req.write(payload);
      req.end();
    },
  );
}

/** Conta ativa com um código de redefinição conhecido. */
async function contaComCodigo(codigo: string | null) {
  const marca = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const email = `senha-${marca}${SUFIXO}`;

  await db
    .insert(familiesTable)
    .values({ name: `Família Fictícia Senha ${marca}`, slug: `senha-${marca}` });

  const [user] = await db
    .insert(usersTable)
    .values({
      email,
      name: "Pessoa Fictícia Senha",
      passwordHash: "hash-antigo-nao-usado",
      emailVerified: true,
      status: "active",
    })
    .returning({ id: usersTable.id });

  if (codigo !== null) {
    await db.insert(passwordResetsTable).values({
      userId: user!.id,
      tokenHash: hashDoCodigo(user!.id, codigo),
      expiresAt: new Date(Clock.now().getTime() + 10 * 60 * 1000),
    });
  }

  return { email, userId: user!.id };
}

async function hashDaSenha(userId: number): Promise<string> {
  const [u] = await db
    .select({ h: usersTable.passwordHash })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);
  return u?.h ?? "";
}

async function codigosVivos(userId: number): Promise<number> {
  const linhas = await db
    .select({ id: passwordResetsTable.id })
    .from(passwordResetsTable)
    .where(and(eq(passwordResetsTable.userId, userId), eq(passwordResetsTable.used, false)));
  return linhas.length;
}

describe("Redefinir senha com o código certo", () => {
  it("troca a senha e queima o código", async () => {
    const { email, userId } = await contaComCodigo("482915");
    const antes = await hashDaSenha(userId);

    const res = await api("/auth/password-reset/confirm", {
      email,
      codigo: "482915",
      newPassword: SENHA_NOVA,
    });

    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.notEqual(await hashDaSenha(userId), antes, "a senha precisava mudar");
    assert.equal(await codigosVivos(userId), 0, "o código precisa morrer ao ser usado");
  });

  it("o mesmo código não serve duas vezes", async () => {
    const { email, userId } = await contaComCodigo("482915");

    await api("/auth/password-reset/confirm", { email, codigo: "482915", newPassword: SENHA_NOVA });
    const segunda = await hashDaSenha(userId);

    const res = await api("/auth/password-reset/confirm", {
      email,
      codigo: "482915",
      newPassword: "outra-senha-qualquer-99",
    });

    assert.equal(res.status, 400);
    assert.equal(await hashDaSenha(userId), segunda, "a segunda troca não podia acontecer");
  });

  it("aceita o código com espaço e hífen, como veio colado", async () => {
    // `normalizarCodigo` existe porque gente cola "482 915" e "482-915" o
    // tempo todo. Recusar por causa disso seria recusar por um motivo que a
    // pessoa não vê.
    const { email } = await contaComCodigo("482915");

    const res = await api("/auth/password-reset/confirm", {
      email,
      codigo: " 482-915 ",
      newPassword: SENHA_NOVA,
    });

    assert.equal(res.status, 200, JSON.stringify(res.body));
  });
});

describe("O contador de tentativas — a defesa principal", () => {
  it(`na tentativa ${MAX_TENTATIVAS + 1} o código está morto, mesmo se for o certo`, async () => {
    const { email, userId } = await contaComCodigo("482915");
    const antes = await hashDaSenha(userId);

    // Cinco erros.
    for (let i = 0; i < MAX_TENTATIVAS; i += 1) {
      const res = await api("/auth/password-reset/confirm", {
        email,
        codigo: "000000",
        newPassword: SENHA_NOVA,
      });
      assert.equal(res.status, 400, `a tentativa ${i + 1} devia falhar`);
    }

    // E agora o código CERTO. Sem o contador, esta linha trocaria a senha — e
    // um milhão de combinações cairia em minutos.
    const res = await api("/auth/password-reset/confirm", {
      email,
      codigo: "482915",
      newPassword: SENHA_NOVA,
    });

    assert.equal(res.status, 400, "código esgotado precisa continuar recusando");
    assert.equal(await hashDaSenha(userId), antes, "a senha não podia mudar");
  });

  it("o erro é gravado no banco, e não só contado em memória", async () => {
    // Contar em memória sobreviveria a um teste e morreria no primeiro
    // restart do processo — e um atacante paciente reinicia a contagem
    // esperando um deploy.
    const { email, userId } = await contaComCodigo("482915");

    await api("/auth/password-reset/confirm", {
      email,
      codigo: "111111",
      newPassword: SENHA_NOVA,
    });

    const [linha] = await db
      .select({ attempts: passwordResetsTable.attempts })
      .from(passwordResetsTable)
      .where(eq(passwordResetsTable.userId, userId))
      .orderBy(desc(passwordResetsTable.id))
      .limit(1);

    assert.equal(linha?.attempts, 1);
  });
});

describe("O teto de emissão por conta", () => {
  it(`para de emitir depois de ${MAX_CODIGOS_POR_HORA} códigos na hora`, async () => {
    // `passwordResetLimiter` conta por `ip:email`. Contra quem troca de IP,
    // ele não conta nada — e cada emissão devolve cinco palpites. Sem este
    // teto, ~100.000 pedidos chegam a 50% de chance de acertar um código.
    const { email, userId } = await contaComCodigo(null);

    for (let i = 0; i < MAX_CODIGOS_POR_HORA + 3; i += 1) {
      const res = await api("/auth/password-reset/request", { email });
      assert.equal(res.status, 200, "a resposta é sempre 200, mesmo no teto");
    }

    const [{ total } = { total: 0 }] = await db
      .select({ total: passwordResetsTable.id })
      .from(passwordResetsTable)
      .where(eq(passwordResetsTable.userId, userId))
      .then((linhas) => [{ total: linhas.length }]);

    assert.equal(
      total,
      MAX_CODIGOS_POR_HORA,
      `emitiu ${total} códigos; o teto por conta é ${MAX_CODIGOS_POR_HORA}`,
    );
  });

  it("emitir um código novo mata o anterior", async () => {
    // Dois códigos vivos são dez tentativas oferecidas em vez de cinco.
    const { email, userId } = await contaComCodigo(null);

    await api("/auth/password-reset/request", { email });
    await api("/auth/password-reset/request", { email });

    assert.equal(await codigosVivos(userId), 1, "só um código pode estar vivo por vez");
  });

  it("recusar no teto é indistinguível de aceitar — nada vaza", async () => {
    const { email } = await contaComCodigo(null);

    const primeira = await api("/auth/password-reset/request", { email });
    for (let i = 0; i < MAX_CODIGOS_POR_HORA; i += 1) {
      await api("/auth/password-reset/request", { email });
    }
    const noTeto = await api("/auth/password-reset/request", { email });

    assert.equal(noTeto.status, primeira.status);
    assert.deepEqual(noTeto.body, primeira.body, "um 429 aqui contaria que a conta existe");
  });
});

describe("Antienumeração", () => {
  it("pedir código para e-mail que não existe responde igual", async () => {
    const { email } = await contaComCodigo(null);

    const existe = await api("/auth/password-reset/request", { email });
    const naoExiste = await api("/auth/password-reset/request", {
      email: `ninguem-aqui${SUFIXO}`,
    });

    assert.equal(naoExiste.status, existe.status);
    assert.deepEqual(naoExiste.body, existe.body);
  });

  it("confirmar com e-mail inexistente responde igual a código errado", async () => {
    const { email } = await contaComCodigo("482915");

    const codigoErrado = await api("/auth/password-reset/confirm", {
      email,
      codigo: "000000",
      newPassword: SENHA_NOVA,
    });
    const contaInexistente = await api("/auth/password-reset/confirm", {
      email: `ninguem-aqui${SUFIXO}`,
      codigo: "000000",
      newPassword: SENHA_NOVA,
    });

    assert.equal(contaInexistente.status, codigoErrado.status);
    assert.deepEqual(contaInexistente.body, codigoErrado.body);
  });

  it("e responde no mesmo tempo — o relógio não pode contar o que o corpo cala", async () => {
    // Issue #84: sem piso de resposta, conta inexistente respondia mais rápido
    // que conta existente. A consulta ao banco e o hash do código custam
    // tempo, e esse tempo é informação.
    const { email } = await contaComCodigo("482915");

    const existente = await api("/auth/password-reset/confirm", {
      email,
      codigo: "000000",
      newPassword: SENHA_NOVA,
    });
    const inexistente = await api("/auth/password-reset/confirm", {
      email: `ninguem-aqui${SUFIXO}`,
      codigo: "000000",
      newPassword: SENHA_NOVA,
    });

    for (const [nome, r] of [["existente", existente], ["inexistente", inexistente]] as const) {
      assert.ok(
        r.ms >= PISO_DE_RESPOSTA_MS,
        `resposta de conta ${nome} saiu em ${Math.round(r.ms)}ms, abaixo do piso de ${PISO_DE_RESPOSTA_MS}ms`,
      );
    }
  });
});

describe("A senha fraca é recusada antes de gastar o código", () => {
  it("senha curta não queima a tentativa", async () => {
    // Descobrir que a senha é curta só DEPOIS de gastar o código seria cruel:
    // a pessoa teria que pedir outro e-mail por um erro que a tela já sabia.
    const { email, userId } = await contaComCodigo("482915");

    const res = await api("/auth/password-reset/confirm", {
      email,
      codigo: "482915",
      newPassword: "curta",
    });

    assert.equal(res.status, 400);
    assert.notEqual(res.body.error, "Código inválido ou expirado. Peça um novo.");

    // E o código continua valendo.
    const depois = await api("/auth/password-reset/confirm", {
      email,
      codigo: "482915",
      newPassword: SENHA_NOVA,
    });
    assert.equal(depois.status, 200, JSON.stringify(depois.body));
    assert.equal(await codigosVivos(userId), 0);
  });
});
