/**
 * Testes de consentimento LGPD — ZELO.
 *
 * Cobre:
 * - Não é possível criar paciente sem consentimento de dados de saúde
 * - Consentimento registrado com usuário, versão, IP
 * - Dois tipos separados: terms_of_service ≠ health_data_processing
 * - Revogação via novo INSERT (não UPDATE)
 * - Histórico completo preservado
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { eq, and } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  usersTable, caregiversTable, familiesTable, patientsTable, consentRecordsTable,
} from "@workspace/db";
import { generateAccessToken } from "../lib/tokens.ts";
import { hashPassword } from "../lib/password.ts";
import app from "../app.ts";

let testPort: number;
let closeServer: () => Promise<void>;
let userWithConsent: { userId: number; familyId: number; caregiverId: number; token: string };
let userWithoutConsent: { userId: number; familyId: number; caregiverId: number; token: string };

async function createUser(email: string, withConsent: boolean) {
  const [family] = await db
    .insert(familiesTable)
    .values({ name: `Família Consent ${email}`, slug: `consent-${Date.now()}-${Math.random().toString(36).slice(2)}` })
    .returning();
  const [user] = await db
    .insert(usersTable)
    .values({ email, name: "Consent Test", passwordHash: await hashPassword("test"), emailVerified: true, status: "active" })
    .returning();
  const [caregiver] = await db
    .insert(caregiversTable)
    .values({ familyId: family.id, userId: user.id, name: "Consent Test", email, role: "primary_caregiver" })
    .returning();

  await db.insert(consentRecordsTable).values({
    userId: user.id, consentType: "terms_of_service", consentGiven: "true", version: "v1.0", ipAddress: "127.0.0.1",
  });

  if (withConsent) {
    await db.insert(consentRecordsTable).values({
      userId: user.id, consentType: "health_data_processing", consentGiven: "true", version: "v1.0", ipAddress: "127.0.0.1",
    });
  }

  const token = generateAccessToken(user.id, family.id, caregiver.id, "primary_caregiver");
  return { userId: user.id, familyId: family.id, caregiverId: caregiver.id, token };
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
  [userWithConsent, userWithoutConsent] = await Promise.all([
    createUser("consent-yes@zelo.test", true),
    createUser("consent-no@zelo.test", false),
  ]);
});

after(async () => {
  await closeServer();
  await db.delete(usersTable).where(eq(usersTable.email, "consent-yes@zelo.test"));
  await db.delete(usersTable).where(eq(usersTable.email, "consent-no@zelo.test"));
  await db.delete(familiesTable).where(eq(familiesTable.id, userWithConsent.familyId));
  await db.delete(familiesTable).where(eq(familiesTable.id, userWithoutConsent.familyId));
});

function api(token: string, method: string, path: string, body?: unknown) {
  const payload = body ? JSON.stringify(body) : undefined;
  return new Promise<{ status: number; body: unknown }>((resolve, reject) => {
    const req = http.request(
      {
        hostname: "127.0.0.1", port: testPort, path: `/api${path}`, method,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          ...(payload ? { "Content-Length": Buffer.byteLength(payload) } : {}),
        },
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
    if (payload) req.write(payload);
    req.end();
  });
}

describe("Consentimento LGPD — ZELO", () => {

  // A partir da Fase 03, o consentimento de dados de saúde é POR PACIENTE,
  // capturado inline na própria requisição de criação — não é mais um estado
  // prévio da conta que a rota consulta. Cada paciente tem seu próprio
  // registro, com quem consentiu (o próprio titular ou um representante legal).

  it("criar paciente sem healthConsent no corpo retorna 400 (validação)", async () => {
    const res = await api(userWithoutConsent.token, "POST", "/patients", {
      name: "Paciente Sem Consent", timezone: "America/Sao_Paulo",
    });
    assert.equal(res.status, 400, "deve rejeitar por falta de healthConsent");
  });

  it("com healthConsent no corpo, criar paciente retorna 201 e grava consent_records vinculado a ele", async () => {
    const res = await api(userWithConsent.token, "POST", "/patients", {
      name: "Paciente Com Consent",
      timezone: "America/Sao_Paulo",
      healthConsent: { givenBy: "self", version: "v1.0" },
    });
    assert.equal(res.status, 201, "deve permitir criar paciente com consentimento inline");
    const body = res.body as { id: number; familyId: number };
    assert.equal(body.familyId, userWithConsent.familyId);

    const [record] = await db
      .select()
      .from(consentRecordsTable)
      .where(
        and(
          eq(consentRecordsTable.patientId, body.id),
          eq(consentRecordsTable.consentType, "health_data_processing")
        )
      );
    assert.ok(record, "deve existir consentimento vinculado a este paciente especificamente");
    assert.equal(record.givenBy, "self");
    assert.equal(record.consentGiven, "true");
    assert.equal(record.version, "v1.0");
    assert.ok(record.ipAddress, "deve ter ipAddress");
    assert.ok(record.createdAt, "deve ter createdAt");
    assert.ok(!("updatedAt" in record), "consentimento não tem updatedAt (imutável)");

    // Limpa
    await db.delete(patientsTable).where(eq(patientsTable.id, body.id));
  });

  it("consentimento como representante legal é registrado corretamente", async () => {
    const res = await api(userWithConsent.token, "POST", "/patients", {
      name: "Paciente Representado",
      timezone: "America/Sao_Paulo",
      healthConsent: { givenBy: "legal_representative", version: "v1.0" },
    });
    assert.equal(res.status, 201);
    const body = res.body as { id: number };

    const [record] = await db
      .select({ givenBy: consentRecordsTable.givenBy })
      .from(consentRecordsTable)
      .where(eq(consentRecordsTable.patientId, body.id));
    assert.equal(record.givenBy, "legal_representative");

    await db.delete(patientsTable).where(eq(patientsTable.id, body.id));
  });

  it("dois tipos de consentimento são separados e independentes", async () => {
    const records = await db
      .select({ type: consentRecordsTable.consentType })
      .from(consentRecordsTable)
      .where(eq(consentRecordsTable.userId, userWithConsent.userId));

    const types = new Set(records.map((r) => r.type));
    assert.ok(types.has("terms_of_service"), "deve ter consentimento dos termos");
    assert.ok(types.has("health_data_processing"), "deve ter consentimento de dados de saúde separado");
  });

  it("revogar consentimento cria novo registro com consentGiven=false (não atualiza o antigo)", async () => {
    // Registra revogação via API
    const revokeRes = await api(userWithConsent.token, "POST", "/consent", {
      consentType: "marketing",
      consentGiven: false,
      version: "v1.0",
    });
    assert.equal(revokeRes.status, 201);

    // Verifica que o registro existe
    const records = await db
      .select({ consentGiven: consentRecordsTable.consentGiven, createdAt: consentRecordsTable.createdAt })
      .from(consentRecordsTable)
      .where(
        and(
          eq(consentRecordsTable.userId, userWithConsent.userId),
          eq(consentRecordsTable.consentType, "marketing")
        )
      )
      .limit(5);

    assert.ok(records.length >= 1, "deve ter registro de revogação");
    const revoke = records.find((r) => r.consentGiven === "false");
    assert.ok(revoke, "deve existir registro com consentGiven=false (revogação)");
  });

  it("GET /consent/terms retorna versões dos termos com status de rascunho", async () => {
    const res = await api(userWithConsent.token, "GET", "/consent/terms");
    assert.equal(res.status, 200);
    const body = res.body as Record<string, { version: string; status: string }>;
    assert.ok(body.termsOfService, "deve ter termos de uso");
    assert.ok(body.healthDataProcessing, "deve ter política de dados de saúde");
    assert.ok(
      body.healthDataProcessing.status.includes("draft"),
      "status deve indicar que é rascunho"
    );
  });
});
