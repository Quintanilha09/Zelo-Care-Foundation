/**
 * Testes de exclusão permanente de paciente — ZELO.
 *
 * Diferente de arquivar (suspende sem apagar): isto é DELETE de verdade,
 * então o foco dos testes é a segurança da ação — só dono da família, nome
 * exato pra confirmar, isolamento entre famílias — e a prova de que o
 * cascade do banco realmente limpa dado relacionado (tratamento), não só
 * a linha do paciente.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { eq } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  usersTable, caregiversTable, familiesTable, patientsTable, medicationsTable, treatmentsTable,
} from "@workspace/db";
import { generateAccessToken } from "../lib/tokens.ts";
import { hashPassword } from "../lib/password.ts";
import { boss } from "../lib/queue.ts";
import { Clock } from "../lib/clock.ts";
import app from "../app.ts";

let testPort: number;
let closeServer: () => Promise<void>;
let familyId: number;
let token: string; // cuidador principal
let nonPrimaryToken: string;
let otherFamilyId: number;
let otherFamilyToken: string;

async function api(method: string, path: string, body?: unknown, authToken = token): Promise<{ status: number; body: unknown }> {
  const payload = body !== undefined ? JSON.stringify(body) : undefined;
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: "127.0.0.1", port: testPort, path: `/api${path}`, method,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
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

  const [family] = await db.insert(familiesTable).values({ name: "Família Exclusão Teste", slug: `del-test-${Date.now()}` }).returning();
  familyId = family.id;

  const [user] = await db.insert(usersTable).values({ email: `del-primary-${Date.now()}@zelo.test`, name: "Cuidador Principal", passwordHash: await hashPassword("x"), emailVerified: true, status: "active" }).returning();
  const [caregiver] = await db.insert(caregiversTable).values({ familyId, userId: user.id, name: "Cuidador Principal", role: "primary_caregiver" }).returning();
  token = generateAccessToken(user.id, familyId, caregiver.id, "primary_caregiver");

  const [nonPrimaryUser] = await db.insert(usersTable).values({ email: `del-nonprimary-${Date.now()}@zelo.test`, name: "Cuidador Comum", passwordHash: await hashPassword("x"), emailVerified: true, status: "active" }).returning();
  const [nonPrimaryCaregiver] = await db.insert(caregiversTable).values({ familyId, userId: nonPrimaryUser.id, name: "Cuidador Comum", role: "caregiver" }).returning();
  nonPrimaryToken = generateAccessToken(nonPrimaryUser.id, familyId, nonPrimaryCaregiver.id, "caregiver");

  const [otherFamily] = await db.insert(familiesTable).values({ name: "Outra Família", slug: `del-other-${Date.now()}` }).returning();
  otherFamilyId = otherFamily.id;
  const [otherUser] = await db.insert(usersTable).values({ email: `del-other-${Date.now()}@zelo.test`, name: "Cuidador de Outra Família", passwordHash: await hashPassword("x"), emailVerified: true, status: "active" }).returning();
  const [otherCaregiver] = await db.insert(caregiversTable).values({ familyId: otherFamilyId, userId: otherUser.id, name: "Cuidador de Outra Família", role: "primary_caregiver" }).returning();
  otherFamilyToken = generateAccessToken(otherUser.id, otherFamilyId, otherCaregiver.id, "primary_caregiver");
});

after(async () => {
  Clock.reset();
  await closeServer();
  await boss.stop({ graceful: false });
  await db.delete(familiesTable).where(eq(familiesTable.id, familyId));
  await db.delete(familiesTable).where(eq(familiesTable.id, otherFamilyId));
});

async function createPatient(name: string, authToken = token): Promise<number> {
  const res = await api("POST", "/patients", {
    name, timezone: "America/Sao_Paulo",
    healthConsent: { givenBy: "legal_representative", version: "v1.0" },
  }, authToken);
  return (res.body as { id: number }).id;
}

describe("DELETE /patients/:id — exclusão permanente", () => {
  it("cuidador não-principal recebe 403, e o paciente continua existindo", async () => {
    const patientId = await createPatient("Paciente A");
    const res = await api("DELETE", `/patients/${patientId}`, { reason: "teste", confirmName: "Paciente A" }, nonPrimaryToken);
    assert.equal(res.status, 403);

    const getRes = await api("GET", `/patients/${patientId}`);
    assert.equal(getRes.status, 200, "não deveria ter sido excluído por quem não é o cuidador principal");

    await db.delete(patientsTable).where(eq(patientsTable.id, patientId));
  });

  it("nome de confirmação incorreto rejeita com 400 e não apaga nada", async () => {
    const patientId = await createPatient("Paciente B");
    const res = await api("DELETE", `/patients/${patientId}`, { reason: "teste", confirmName: "Nome Errado" });
    assert.equal(res.status, 400);
    assert.equal((res.body as { code?: string }).code, "NAME_MISMATCH");

    const getRes = await api("GET", `/patients/${patientId}`);
    assert.equal(getRes.status, 200);

    await db.delete(patientsTable).where(eq(patientsTable.id, patientId));
  });

  it("sem motivo (reason vazio) é rejeitado", async () => {
    const patientId = await createPatient("Paciente C");
    const res = await api("DELETE", `/patients/${patientId}`, { reason: "", confirmName: "Paciente C" });
    assert.equal(res.status, 400);

    await db.delete(patientsTable).where(eq(patientsTable.id, patientId));
  });

  it("paciente de outra família — 404, isolamento normal", async () => {
    const patientId = await createPatient("Paciente de Outra Família", otherFamilyToken);
    const res = await api("DELETE", `/patients/${patientId}`, { reason: "teste", confirmName: "Paciente de Outra Família" });
    assert.equal(res.status, 404, "família A não pode nem tentar excluir paciente da família B");

    const getRes = await api("GET", `/patients/${patientId}`, undefined, otherFamilyToken);
    assert.equal(getRes.status, 200);

    await db.delete(patientsTable).where(eq(patientsTable.id, patientId));
  });

  it("cuidador principal com nome exato exclui de verdade, e o cascade limpa tratamento junto", async () => {
    const patientId = await createPatient("Dona Maria");

    const [medication] = await db.insert(medicationsTable).values({ familyId, name: "Losartana Exclusão Teste" }).returning();
    const treatmentRes = await api("POST", `/patients/${patientId}/treatments`, {
      medicationId: medication.id,
      scheduleConfig: { scheduleType: "times_per_day", times: ["08:00"] },
      startDate: Clock.todayInTimezone("America/Sao_Paulo"),
    });
    const treatmentId = (treatmentRes.body as { id: number }).id;
    assert.ok(treatmentId, "tratamento precisa existir antes de testar o cascade");

    const res = await api("DELETE", `/patients/${patientId}`, { reason: "cadastrado por engano", confirmName: "Dona Maria" });
    assert.equal(res.status, 200);
    assert.equal((res.body as { deleted: boolean }).deleted, true);

    const getRes = await api("GET", `/patients/${patientId}`);
    assert.equal(getRes.status, 404, "o paciente precisa ter sumido de verdade, não só arquivado");

    const [survivingTreatment] = await db.select().from(treatmentsTable).where(eq(treatmentsTable.id, treatmentId));
    assert.equal(survivingTreatment, undefined, "cascade do banco devia ter apagado o tratamento junto com o paciente");
  });
});
