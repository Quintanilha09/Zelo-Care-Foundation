/**
 * Feed de atividade da família — Issue #13.
 *
 * ── Por que esta suíte nasceu tarde ───────────────────────────────────────
 *
 * A rota `GET /api/activity` existia, respondia, e **não tinha teste nenhum**.
 * Foi encontrada procurando código morto: o componente que a consome estava
 * pronto e nenhuma tela o renderizava.
 *
 * Rota viva sem teste é pior que código morto — código morto não roda.
 *
 * ── O que estes testes provam ─────────────────────────────────────────────
 *
 *   1. o feed de uma família NUNCA aparece para outra
 *   2. o texto gerado não carrega nome de medicamento, nem pelo caminho de
 *      fallback
 *   3. o `limit` tem teto e não aceita lixo
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { eq } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  usersTable, caregiversTable, familiesTable, patientsTable, auditLogTable,
} from "@workspace/db";
import { generateAccessToken } from "../lib/tokens.ts";
import { hashPassword } from "../lib/password.ts";
import { boss } from "../lib/queue.ts";
import { Clock } from "../lib/clock.ts";
import app from "../app.ts";

let testPort: number;
let closeServer: () => Promise<void>;
let familyId: number;
let token: string;
let caregiverId: number;
let outraFamilyId: number;
let outroToken: string;

interface Item {
  id: number;
  text: string;
  entityType: string;
  action: string;
  actorName: string;
  timestamp: string;
}

async function api(path: string, authToken: string): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: "127.0.0.1", port: testPort, path: `/api${path}`, method: "GET",
        headers: { Authorization: `Bearer ${authToken}`, "Content-Type": "application/json" },
      },
      (res) => {
        let data = "";
        res.on("data", (c: Buffer) => (data += c.toString()));
        res.on("end", () => {
          try { resolve({ status: res.statusCode ?? 0, body: JSON.parse(data) }); }
          catch { resolve({ status: res.statusCode ?? 0, body: data }); }
        });
      }
    );
    req.on("error", reject);
    req.end();
  });
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
    .values({ name: "Família Fictícia Atividade", slug: `ativ-${marca}` }).returning();
  familyId = family.id;
  const [user] = await db.insert(usersTable).values({
    email: `ativ-${marca}@zelo.test`, name: "Ana Fictícia",
    passwordHash: await hashPassword("x"), emailVerified: true, status: "active",
  }).returning();
  const [caregiver] = await db.insert(caregiversTable)
    .values({ familyId, userId: user.id, name: "Ana Fictícia", role: "primary_caregiver" }).returning();
  caregiverId = caregiver.id;
  token = generateAccessToken(user.id, familyId, caregiver.id, "primary_caregiver");
  await db.insert(patientsTable)
    .values({ familyId, name: "Dona Maria Teste", timezone: "America/Sao_Paulo" });

  const [outra] = await db.insert(familiesTable)
    .values({ name: "Outra Família Fictícia", slug: `ativ-outra-${marca}` }).returning();
  outraFamilyId = outra.id;
  const [outroUser] = await db.insert(usersTable).values({
    email: `ativ-outra-${marca}@zelo.test`, name: "Cuidador Vizinho",
    passwordHash: await hashPassword("x"), emailVerified: true, status: "active",
  }).returning();
  const [outroCaregiver] = await db.insert(caregiversTable)
    .values({ familyId: outraFamilyId, userId: outroUser.id, name: "Cuidador Vizinho", role: "primary_caregiver" }).returning();
  outroToken = generateAccessToken(outroUser.id, outraFamilyId, outroCaregiver.id, "primary_caregiver");
});

after(async () => {
  Clock.reset();
  await closeServer();
  await boss.stop({ graceful: false });
  await db.delete(familiesTable).where(eq(familiesTable.id, familyId));
  await db.delete(familiesTable).where(eq(familiesTable.id, outraFamilyId));
});

describe("O feed não atravessa família", () => {
  it("cada família vê só a própria atividade", async () => {
    // O audit_log já tem linhas das duas famílias: o `before` criou família,
    // cuidador e paciente, e cada um desses gera trilha.
    await db.insert(auditLogTable).values({
      familyId, entityType: "dose_record", entityId: "1", action: "created",
      actorType: "caregiver", actorId: String(caregiverId),
    });

    const meu = await api("/activity?limit=50", token);
    const vizinho = await api("/activity?limit=50", outroToken);

    assert.equal(meu.status, 200);
    assert.equal(vizinho.status, 200);

    const meus = meu.body as Item[];
    const dele = vizinho.body as Item[];

    assert.ok(meus.length > 0, "a minha família tem atividade registrada");

    // Nenhum id aparece nas duas listas. É a prova direta do isolamento:
    // sem o filtro por familyId, o audit_log inteiro vazaria.
    const idsDele = new Set(dele.map((i) => i.id));
    const cruzados = meus.filter((i) => idsDele.has(i.id));
    assert.deepEqual(cruzados, [], "nenhuma linha pode aparecer para as duas famílias");
  });

  it("sem sessão, 401", async () => {
    const r = await new Promise<number>((resolve, reject) => {
      const req = http.request(
        { hostname: "127.0.0.1", port: testPort, path: "/api/activity", method: "GET" },
        (res) => { res.resume(); res.on("end", () => resolve(res.statusCode ?? 0)); }
      );
      req.on("error", reject);
      req.end();
    });
    assert.equal(r, 401);
  });
});

describe("O texto nunca carrega dado clínico", () => {
  it("mensagem de dose fala da AÇÃO, nunca do medicamento", async () => {
    await db.insert(auditLogTable).values({
      familyId, entityType: "dose_record", entityId: "99", action: "created",
      actorType: "caregiver", actorId: String(caregiverId),
    });

    const r = await api("/activity?limit=50", token);
    const itens = (r.body as Item[]).filter((i) => i.entityType === "dose_record");
    assert.ok(itens.length > 0);

    for (const item of itens) {
      // O template é fixo: "<quem> registrou uma dose". Se alguém trocar por
      // interpolação do nome do medicamento, isto quebra — que é o ponto.
      assert.match(item.text, /registrou uma dose|editou um registro|removeu um registro/);
      assert.ok(!item.text.includes("Losartana"), "nenhum nome de medicamento no texto");
    }
  });

  it("evento DESCONHECIDO cai num texto genérico, sem vazar conteúdo", async () => {
    // O caminho de fallback é o mais fácil de esquecer, e o mais provável de
    // vazar: é para onde vai todo tipo de evento que ninguém mapeou.
    await db.insert(auditLogTable).values({
      familyId, entityType: "media_asset", entityId: "1", action: "created",
      actorType: "caregiver", actorId: String(caregiverId),
      diff: JSON.stringify({ segredo: "Losartana 50mg", paciente: "Dona Maria" }),
    });

    const r = await api("/activity?limit=50", token);
    const item = (r.body as Item[]).find((i) => i.entityType === "media_asset");
    assert.ok(item, "o evento não mapeado precisa aparecer");

    // O fallback usa só entityType e action — o `diff` NUNCA entra no texto.
    assert.ok(!item.text.includes("Losartana"), "o diff não pode vazar para o texto");
    assert.ok(!item.text.includes("Dona Maria"), "nome de paciente não pode vazar para o texto");
  });

  it("a resposta não devolve o diff bruto", async () => {
    const r = await api("/activity?limit=50", token);
    for (const item of r.body as Record<string, unknown>[]) {
      assert.equal("diff" in item, false, "o diff do audit_log não pode sair na resposta");
      assert.equal("ipAddress" in item, false, "endereço de IP não pode sair na resposta");
    }
  });
});

describe("O limite tem teto", () => {
  it("limit acima de 100 é cortado em 100", async () => {
    const r = await api("/activity?limit=99999", token);
    assert.equal(r.status, 200);
    assert.ok((r.body as Item[]).length <= 100, "o teto de 100 protege o banco");
  });

  it("limit inválido cai no padrão em vez de quebrar", async () => {
    for (const valor of ["abc", "-5", ""]) {
      const r = await api(`/activity?limit=${valor}`, token);
      assert.equal(r.status, 200, `limit=${valor} não pode derrubar a rota`);
      assert.ok(Array.isArray(r.body));
    }
  });
});
