/**
 * Resgate pela família — Issue #87.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O CUIDADOR PRINCIPAL JÁ VÊ E FAZ TUDO NA PRÓPRIA FAMÍLIA. RESTAURAR O ACESSO
 * DE OUTRO CUIDADOR NÃO LHE CONCEDE PODER NOVO — MAS ABRE UM CAMINHO PARA
 * PULAR O SEGUNDO FATOR DE OUTRA PESSOA, E É ISSO QUE ESTE ARQUIVO GUARDA.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * As três defesas que tornam o resgate aceitável — janela curta, aviso à pessoa
 * resgatada, e registro em auditoria — não aparecem em nenhuma tela. Tirar
 * qualquer uma delas não quebra nada visível, e nenhum outro teste cai.
 *
 * O que os casos abaixo travam, em ordem de importância:
 *
 *   1. só `primary_caregiver` resgata
 *   2. só dentro da própria família, e família alheia responde **404**
 *   3. o resgate tem prazo, e não é um interruptor permanente
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { eq, like } from "drizzle-orm";
import { db } from "@workspace/db";
import { usersTable, familiesTable, caregiversTable } from "@workspace/db";
import { hashPassword } from "../lib/password.ts";
import { generateAccessToken } from "../lib/tokens.ts";
import { Clock } from "../lib/clock.ts";
import app from "../app.ts";

const SUFIXO = "@resgate-test.zelo.test";

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
  await db.delete(familiesTable).where(like(familiesTable.name, "Família Fictícia Resgate %"));
});

let contadorDeIp = 0;
function ipUnico(): string {
  contadorDeIp += 1;
  return `10.${(contadorDeIp >> 16) & 255}.${(contadorDeIp >> 8) & 255}.${contadorDeIp & 255}`;
}

async function api(
  metodo: string,
  path: string,
  token?: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
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
    req.end();
  });
}

/** Uma família com um principal e um cuidador comum, cada um com conta. */
async function familiaComDois() {
  const marca = `${Date.now()}${Math.floor(Math.random() * 100000)}`;

  const [familia] = await db
    .insert(familiesTable)
    .values({ name: `Família Fictícia Resgate ${marca}`, slug: `resg-${marca}` })
    .returning({ id: familiesTable.id });

  const pessoas = [];
  for (const papel of ["primary_caregiver", "caregiver"] as const) {
    const email = `${papel}-${marca}${SUFIXO}`;
    const [user] = await db
      .insert(usersTable)
      .values({
        email,
        name: `Pessoa Fictícia ${papel}`,
        passwordHash: await hashPassword("senha-do-teste-987"),
        emailVerified: true,
        status: "active",
        activeFamilyId: familia!.id,
      })
      .returning({ id: usersTable.id });

    const [cuidador] = await db
      .insert(caregiversTable)
      .values({
        familyId: familia!.id,
        userId: user!.id,
        name: `Pessoa Fictícia ${papel}`,
        role: papel,
      })
      .returning({ id: caregiversTable.id });

    pessoas.push({
      email,
      userId: user!.id,
      caregiverId: cuidador!.id,
      token: generateAccessToken(user!.id, familia!.id, cuidador!.id, papel),
    });
  }

  return { familyId: familia!.id, principal: pessoas[0]!, comum: pessoas[1]! };
}

async function resgateDe(userId: number): Promise<Date | null> {
  const [u] = await db
    .select({ ate: usersTable.resgateLiberadoAte })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);
  return u?.ate ?? null;
}

describe("O cuidador principal restaura o acesso de outro", () => {
  it("libera a janela, e devolve até quando", async () => {
    const { principal, comum } = await familiaComDois();

    assert.equal(await resgateDe(comum.userId), null, "não podia haver resgate antes");

    const res = await api("POST", `/caregivers/${comum.caregiverId}/resgate`, principal.token);
    assert.equal(res.status, 200, JSON.stringify(res.body));

    const ate = await resgateDe(comum.userId);
    assert.ok(ate, "o resgate precisava ficar gravado");
    assert.ok(ate!.getTime() > Clock.now().getTime(), "a janela precisa estar no futuro");
  });

  it("a janela tem prazo — não é um interruptor permanente", async () => {
    // Um resgate esquecido não pode ficar armado para sempre: quem pediu ajuda
    // entra no mesmo dia.
    const { principal, comum } = await familiaComDois();

    await api("POST", `/caregivers/${comum.caregiverId}/resgate`, principal.token);
    const ate = (await resgateDe(comum.userId))!;

    const horas = (ate.getTime() - Clock.now().getTime()) / (60 * 60 * 1000);
    assert.ok(horas > 0, `a janela precisa ser no futuro, veio ${horas}h`);
    assert.ok(horas <= 48, `janela de ${Math.round(horas)}h é longa demais para um resgate`);
  });
});

describe("Quem NÃO pode resgatar", () => {
  it("cuidador comum recebe 403", async () => {
    // Decisão do fundador em 03/09/2026: só `primary_caregiver`. Um cuidador
    // comum não vê tudo na família, e não deve poder devolver acesso a ninguém.
    const { principal, comum } = await familiaComDois();

    const res = await api("POST", `/caregivers/${principal.caregiverId}/resgate`, comum.token);

    assert.equal(res.status, 403);
    assert.equal(await resgateDe(principal.userId), null, "nada podia ter sido liberado");
  });

  it("sem sessão, 401", async () => {
    const { comum } = await familiaComDois();

    const res = await api("POST", `/caregivers/${comum.caregiverId}/resgate`);

    assert.equal(res.status, 401);
    assert.equal(await resgateDe(comum.userId), null);
  });

  it("resgatar a si mesmo é recusado", async () => {
    // Quem chama esta rota está logado. Resgatar-se não devolve acesso nenhum,
    // e permitir seria dar ao principal um jeito de pular o próprio segundo
    // fator para sempre.
    const { principal } = await familiaComDois();

    const res = await api("POST", `/caregivers/${principal.caregiverId}/resgate`, principal.token);

    assert.equal(res.status, 400);
    assert.equal(await resgateDe(principal.userId), null);
  });
});

describe("A fronteira da família — invariante 2 do produto", () => {
  it("cuidador de OUTRA família responde 404, e não 403", async () => {
    // O 403 confirmaria que aquele id existe. O produto responde 404 para
    // recurso de outra família em todo lugar, e aqui não é exceção.
    const casa = await familiaComDois();
    const vizinha = await familiaComDois();

    const res = await api(
      "POST",
      `/caregivers/${vizinha.comum.caregiverId}/resgate`,
      casa.principal.token,
    );

    assert.equal(res.status, 404, "403 aqui vazaria a existência do cuidador");
    assert.equal(
      await resgateDe(vizinha.comum.userId),
      null,
      "não podia ter tocado em ninguém da outra família",
    );
  });

  it("o familyId vem do token, nunca da URL", async () => {
    // Controle do caso acima: o mesmo id resgatado por quem é da família certa
    // funciona. Sem isto, o 404 acima passaria com a rota quebrada por completo.
    const vizinha = await familiaComDois();

    const res = await api(
      "POST",
      `/caregivers/${vizinha.comum.caregiverId}/resgate`,
      vizinha.principal.token,
    );

    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.ok(await resgateDe(vizinha.comum.userId));
  });
});

describe("Cuidador convidado que ainda não criou conta", () => {
  it("não dá para resgatar quem não tem conta", async () => {
    const { familyId, principal } = await familiaComDois();

    const [semConta] = await db
      .insert(caregiversTable)
      .values({
        familyId,
        userId: null,
        name: "Pessoa Fictícia Sem Conta",
        role: "caregiver",
      })
      .returning({ id: caregiversTable.id });

    const res = await api("POST", `/caregivers/${semConta!.id}/resgate`, principal.token);

    assert.equal(res.status, 400);
    assert.equal(res.body.code, "SEM_CONTA");
  });
});
