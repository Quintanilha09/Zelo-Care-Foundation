/**
 * Testes de registro retroativo — ZELO (ZELO-24).
 *
 * takenAt (quando aconteceu, segundo o cuidador) e createdAt (quando foi
 * registrado) já eram campos separados desde sempre — aqui só a validação
 * da janela configurável entra em cena.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { eq } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  usersTable, caregiversTable, familiesTable, patientsTable, medicationsTable,
  treatmentsTable, scheduledDosesTable, doseRecordsTable,
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
let patientId: number;
let medicationId: number;

async function api(method: string, path: string, body?: unknown) {
  const payload = body !== undefined ? JSON.stringify(body) : undefined;
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

async function createScheduledDose(): Promise<{ doseId: number; treatmentId: number }> {
  const treatmentRes = await api("POST", `/patients/${patientId}/treatments`, {
    medicationId,
    scheduleConfig: { scheduleType: "times_per_day", times: ["00:01", "23:59"] },
    startDate: Clock.todayInTimezone("America/Sao_Paulo"),
  });
  const treatmentId = (treatmentRes.body as { id: number }).id;
  const [dose] = await db
    .select()
    .from(scheduledDosesTable)
    .where(eq(scheduledDosesTable.treatmentId, treatmentId))
    .orderBy(scheduledDosesTable.scheduledAt)
    .limit(1);
  return { doseId: dose.id, treatmentId };
}

async function cleanupTreatment(treatmentId: number): Promise<void> {
  await db.delete(treatmentsTable).where(eq(treatmentsTable.id, treatmentId));
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

  const [family] = await db
    .insert(familiesTable)
    .values({ name: "Família Retroativo Teste", slug: `retro-test-${Date.now()}` })
    .returning();
  familyId = family.id;

  const [user] = await db
    .insert(usersTable)
    .values({ email: `retro-${Date.now()}@zelo.test`, name: "Cuidador Teste", passwordHash: await hashPassword("x"), emailVerified: true, status: "active" })
    .returning();
  const [caregiver] = await db
    .insert(caregiversTable)
    .values({ familyId, userId: user.id, name: "Cuidador Teste", role: "primary_caregiver" })
    .returning();
  token = generateAccessToken(user.id, familyId, caregiver.id, "primary_caregiver");

  const [patient] = await db
    .insert(patientsTable)
    .values({ familyId, name: "Paciente Retroativo Teste", timezone: "America/Sao_Paulo" })
    .returning();
  patientId = patient.id;

  const [medication] = await db
    .insert(medicationsTable)
    .values({ familyId, name: "Medicamento Fictício Retroativo Teste" })
    .returning();
  medicationId = medication.id;
});

after(async () => {
  Clock.reset();
  await closeServer();
  await boss.stop({ graceful: false });
  await db.delete(familiesTable).where(eq(familiesTable.id, familyId));
});

describe("Janela retroativa (padrão 24h) — ZELO-24", () => {
  it("registro dentro da janela não precisa de justificativa", async () => {
    const { doseId, treatmentId } = await createScheduledDose();
    const takenAt = new Date(Clock.now().getTime() - 3 * 3_600_000).toISOString(); // 3h atrás

    const res = await api("POST", `/patients/${patientId}/dose-records`, {
      scheduledDoseId: doseId, takenAt, outcome: "taken",
    });
    assert.equal(res.status, 201);

    await cleanupTreatment(treatmentId);
  });

  it("registro fora da janela sem justificativa é rejeitado", async () => {
    const { doseId, treatmentId } = await createScheduledDose();
    const takenAt = new Date(Clock.now().getTime() - 30 * 3_600_000).toISOString(); // 30h atrás

    const res = await api("POST", `/patients/${patientId}/dose-records`, {
      scheduledDoseId: doseId, takenAt, outcome: "taken",
    });
    assert.equal(res.status, 400);
    const body = res.body as { code: string };
    assert.equal(body.code, "JUSTIFICATION_REQUIRED");

    await cleanupTreatment(treatmentId);
  });

  it("registro fora da janela com justificativa é aceito e gravado", async () => {
    const { doseId, treatmentId } = await createScheduledDose();
    const takenAt = new Date(Clock.now().getTime() - 30 * 3_600_000).toISOString();

    const res = await api("POST", `/patients/${patientId}/dose-records`, {
      scheduledDoseId: doseId, takenAt, outcome: "taken", justification: "Só vi o frasco em cima da mesa hoje de manhã.",
    });
    assert.equal(res.status, 201);

    const [record] = await db.select().from(doseRecordsTable).where(eq(doseRecordsTable.scheduledDoseId, doseId));
    assert.ok(record.justification?.includes("frasco"));
    // Os dois tempos ficam separados: takenAt é o que o cuidador diz que
    // aconteceu, createdAt é agora (quando registrou de fato).
    assert.equal(record.takenAt.toISOString(), takenAt);
    assert.ok(record.createdAt.getTime() > record.takenAt.getTime());

    await cleanupTreatment(treatmentId);
  });

  it("dose no futuro é sempre rejeitada, mesmo com justificativa", async () => {
    const { doseId, treatmentId } = await createScheduledDose();
    const futureTime = new Date(Clock.now().getTime() + 3_600_000).toISOString();

    const res = await api("POST", `/patients/${patientId}/dose-records`, {
      scheduledDoseId: doseId, takenAt: futureTime, outcome: "taken", justification: "não importa",
    });
    assert.equal(res.status, 400);

    await cleanupTreatment(treatmentId);
  });

  it("recuperar uma dose perdida (late) retroativamente como tomada funciona e conta na adesão", async () => {
    const { doseId, treatmentId } = await createScheduledDose();
    await db.update(scheduledDosesTable).set({ status: "late" }).where(eq(scheduledDosesTable.id, doseId));

    const beforeStats = await api("GET", `/patients/${patientId}/adherence-stats`);
    const before = beforeStats.body as { totalTaken: number };

    const takenAt = new Date(Clock.now().getTime() - 2 * 3_600_000).toISOString();
    const res = await api("POST", `/patients/${patientId}/dose-records`, {
      scheduledDoseId: doseId, takenAt, outcome: "taken",
    });
    assert.equal(res.status, 201, "uma dose perdida não é uma sentença — recuperar deve funcionar normalmente");

    const [dose] = await db.select().from(scheduledDosesTable).where(eq(scheduledDosesTable.id, doseId));
    assert.equal(dose.status, "taken");

    const afterStats = await api("GET", `/patients/${patientId}/adherence-stats`);
    const after = afterStats.body as { totalTaken: number };
    assert.equal(after.totalTaken, before.totalTaken + 1, "recalcula a adesão — a dose recuperada conta como tomada");

    await cleanupTreatment(treatmentId);
  });
});

describe("PATCH /families/me/settings — janela configurável", () => {
  it("mudar a janela pra 2h faz um registro de 3h atrás precisar de justificativa", async () => {
    const settingsRes = await api("PATCH", "/families/me/settings", { retroactiveWindowHours: 2 });
    assert.equal(settingsRes.status, 200);
    assert.equal((settingsRes.body as { retroactiveWindowHours: number }).retroactiveWindowHours, 2);

    const { doseId, treatmentId } = await createScheduledDose();
    const takenAt = new Date(Clock.now().getTime() - 3 * 3_600_000).toISOString();

    const res = await api("POST", `/patients/${patientId}/dose-records`, {
      scheduledDoseId: doseId, takenAt, outcome: "taken",
    });
    assert.equal(res.status, 400, "com janela de 2h, 3h atrás já é fora da janela");

    await cleanupTreatment(treatmentId);
    // Restaura o padrão pra não vazar pros próximos testes deste arquivo.
    await api("PATCH", "/families/me/settings", { retroactiveWindowHours: 24 });
  });
});
