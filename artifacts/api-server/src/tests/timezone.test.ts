/**
 * Testes de fuso do paciente — ZELO (ZELO-19).
 *
 * Os 4 cenários de DST exigidos pela spec (hora que pula, hora que repete,
 * cuidador em fuso diferente, paciente muda de fuso) já têm teste no motor
 * puro (lib/scheduling/src/recurrence.test.ts) — são independentes de banco
 * e mais rápidos ali. Este arquivo cobre a parte que só existe com banco:
 * scheduled_local_date/scheduled_local_time persistidos, e o efeito real de
 * mudar o fuso do paciente sobre as doses já agendadas.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { eq } from "drizzle-orm";
import { db } from "@workspace/db";
import { usersTable, caregiversTable, familiesTable, patientsTable, medicationsTable, treatmentsTable, scheduledDosesTable, doseRecordsTable } from "@workspace/db";
import { generateAccessToken } from "../lib/tokens.ts";
import { hashPassword } from "../lib/password.ts";
import { boss } from "../lib/queue.ts";
import { Clock } from "../lib/clock.ts";
import app from "../app.ts";

let testPort: number;
let closeServer: () => Promise<void>;
let familyId: number;
let token: string;
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
    .values({ name: "Família Fuso Teste", slug: `tz-test-${Date.now()}` })
    .returning();
  familyId = family.id;

  const [user] = await db
    .insert(usersTable)
    .values({ email: `tz-${Date.now()}@zelo.test`, name: "Cuidador Teste", passwordHash: await hashPassword("x"), emailVerified: true, status: "active" })
    .returning();
  const [caregiver] = await db
    .insert(caregiversTable)
    .values({ familyId, userId: user.id, name: "Cuidador Teste", role: "primary_caregiver" })
    .returning();
  token = generateAccessToken(user.id, familyId, caregiver.id, "primary_caregiver");

  const [medication] = await db
    .insert(medicationsTable)
    .values({ familyId, name: "Medicamento Fictício Fuso Teste" })
    .returning();
  medicationId = medication.id;
});

after(async () => {
  Clock.reset();
  await closeServer();
  await boss.stop({ graceful: false });
  await db.delete(familiesTable).where(eq(familiesTable.id, familyId));
});

describe("scheduled_local_date/scheduled_local_time — ZELO-19", () => {
  it("dose criada guarda data e hora locais além do instante UTC", async () => {
    const patientRes = await api("POST", "/patients", {
      name: "Paciente SP",
      timezone: "America/Sao_Paulo",
      healthConsent: { givenBy: "self", version: "1.0" },
    });
    const patientId = (patientRes.body as { id: number }).id;

    const treatmentRes = await api("POST", `/patients/${patientId}/treatments`, {
      medicationId,
      scheduleConfig: { scheduleType: "times_per_day", times: ["08:00"] },
      startDate: Clock.todayInTimezone("America/Sao_Paulo"),
    });
    const treatmentId = (treatmentRes.body as { id: number }).id;

    const [dose] = await db
      .select()
      .from(scheduledDosesTable)
      .where(eq(scheduledDosesTable.treatmentId, treatmentId))
      .orderBy(scheduledDosesTable.scheduledAt)
      .limit(1);

    assert.equal(dose.scheduledLocalTime, "08:00", "hora local deve refletir o horário de parede pedido, não o UTC");
    assert.ok(dose.scheduledLocalDate, "data local deve estar preenchida");

    await db.delete(treatmentsTable).where(eq(treatmentsTable.id, treatmentId));
    await db.delete(patientsTable).where(eq(patientsTable.id, patientId));
  });
});

describe("Mudança de fuso do paciente regenera doses futuras — ZELO-19", () => {
  it("preserva o horário de parede (8:00 continua 8:00) reinterpretado no fuso novo", async () => {
    const patientRes = await api("POST", "/patients", {
      name: "Paciente Muda de Fuso",
      timezone: "America/Sao_Paulo",
      healthConsent: { givenBy: "self", version: "1.0" },
    });
    const patientId = (patientRes.body as { id: number }).id;

    const treatmentRes = await api("POST", `/patients/${patientId}/treatments`, {
      medicationId,
      scheduleConfig: { scheduleType: "times_per_day", times: ["08:00"] },
      startDate: Clock.todayInTimezone("America/Sao_Paulo"),
    });
    const treatmentId = (treatmentRes.body as { id: number }).id;

    const beforeMove = await db
      .select()
      .from(scheduledDosesTable)
      .where(eq(scheduledDosesTable.treatmentId, treatmentId))
      .orderBy(scheduledDosesTable.scheduledAt);
    assert.ok(beforeMove.length > 0);
    const utcBefore = beforeMove[0].scheduledAt.toISOString();

    const patchRes = await api("PATCH", `/patients/${patientId}`, { timezone: "America/New_York" });
    assert.equal(patchRes.status, 200);

    const afterMove = await db
      .select()
      .from(scheduledDosesTable)
      .where(eq(scheduledDosesTable.treatmentId, treatmentId))
      .orderBy(scheduledDosesTable.scheduledAt);
    assert.ok(afterMove.length > 0);

    assert.equal(afterMove[0].scheduledLocalTime, "08:00", "o horário de parede pedido continua 8:00, só que agora no fuso novo");
    assert.notEqual(
      afterMove[0].scheduledAt.toISOString(),
      utcBefore,
      "o instante UTC deve mudar — 8:00 em SP e 8:00 em NY são instantes diferentes"
    );

    await db.delete(treatmentsTable).where(eq(treatmentsTable.id, treatmentId));
    await db.delete(patientsTable).where(eq(patientsTable.id, patientId));
  });

  it("não altera doses já registradas (histórico), só as futuras pendentes", async () => {
    const patientRes = await api("POST", "/patients", {
      name: "Paciente Com Historico",
      timezone: "America/Sao_Paulo",
      healthConsent: { givenBy: "self", version: "1.0" },
    });
    const patientId = (patientRes.body as { id: number }).id;

    const treatmentRes = await api("POST", `/patients/${patientId}/treatments`, {
      medicationId,
      scheduleConfig: { scheduleType: "times_per_day", times: ["08:00"] },
      startDate: Clock.todayInTimezone("America/Sao_Paulo"),
    });
    const treatmentId = (treatmentRes.body as { id: number }).id;

    const [firstDose] = await db
      .select()
      .from(scheduledDosesTable)
      .where(eq(scheduledDosesTable.treatmentId, treatmentId))
      .orderBy(scheduledDosesTable.scheduledAt)
      .limit(1);

    const [caregiverRow] = await db.select({ id: caregiversTable.id }).from(caregiversTable).where(eq(caregiversTable.familyId, familyId)).limit(1);
    await db.insert(doseRecordsTable).values({
      scheduledDoseId: firstDose.id, patientId, caregiverId: caregiverRow.id, takenAt: Clock.now(), outcome: "taken",
    });
    await db.update(scheduledDosesTable).set({ status: "taken" }).where(eq(scheduledDosesTable.id, firstDose.id));

    await api("PATCH", `/patients/${patientId}`, { timezone: "America/New_York" });

    const [stillThere] = await db.select().from(scheduledDosesTable).where(eq(scheduledDosesTable.id, firstDose.id));
    assert.equal(stillThere.status, "taken");
    assert.equal(stillThere.scheduledLocalTime, "08:00", "dose já registrada não é regenerada — mantém o horário original de quando foi tomada");

    await db.delete(treatmentsTable).where(eq(treatmentsTable.id, treatmentId));
    await db.delete(patientsTable).where(eq(patientsTable.id, patientId));
  });

  it("PATCH sem mudar o fuso não regenera nada (não recalcula à toa)", async () => {
    const patientRes = await api("POST", "/patients", {
      name: "Paciente Sem Mudanca",
      timezone: "America/Sao_Paulo",
      healthConsent: { givenBy: "self", version: "1.0" },
    });
    const patientId = (patientRes.body as { id: number }).id;

    const treatmentRes = await api("POST", `/patients/${patientId}/treatments`, {
      medicationId,
      scheduleConfig: { scheduleType: "times_per_day", times: ["08:00"] },
      startDate: Clock.todayInTimezone("America/Sao_Paulo"),
    });
    const treatmentId = (treatmentRes.body as { id: number }).id;

    const [doseBefore] = await db
      .select()
      .from(scheduledDosesTable)
      .where(eq(scheduledDosesTable.treatmentId, treatmentId))
      .orderBy(scheduledDosesTable.scheduledAt)
      .limit(1);

    await api("PATCH", `/patients/${patientId}`, { name: "Paciente Sem Mudanca Renomeado" });

    const [doseAfter] = await db.select().from(scheduledDosesTable).where(eq(scheduledDosesTable.id, doseBefore.id));
    assert.ok(doseAfter, "a mesma linha de dose deve continuar existindo — nada foi regenerado");
    assert.equal(doseAfter.scheduledAt.toISOString(), doseBefore.scheduledAt.toISOString());

    await db.delete(treatmentsTable).where(eq(treatmentsTable.id, treatmentId));
    await db.delete(patientsTable).where(eq(patientsTable.id, patientId));
  });
});

describe("Dia civil de today-doses independe do fuso do processo — ZELO-19", () => {
  it("mudar TZ do processo não altera quais doses aparecem em today-doses", async () => {
    const patientRes = await api("POST", "/patients", {
      name: "Paciente Today Doses TZ",
      timezone: "America/Sao_Paulo",
      healthConsent: { givenBy: "self", version: "1.0" },
    });
    const patientId = (patientRes.body as { id: number }).id;

    const treatmentRes = await api("POST", `/patients/${patientId}/treatments`, {
      medicationId,
      scheduleConfig: { scheduleType: "times_per_day", times: ["08:00", "20:00"] },
      startDate: Clock.todayInTimezone("America/Sao_Paulo"),
    });
    const treatmentId = (treatmentRes.body as { id: number }).id;

    const originalTZ = process.env.TZ;
    let countTokyo: number;
    let countUTC: number;
    try {
      process.env.TZ = "Asia/Tokyo";
      const resTokyo = await api("GET", `/patients/${patientId}/today-doses`);
      countTokyo = (resTokyo.body as { totalDoses: number }).totalDoses;

      process.env.TZ = "UTC";
      const resUTC = await api("GET", `/patients/${patientId}/today-doses`);
      countUTC = (resUTC.body as { totalDoses: number }).totalDoses;
    } finally {
      process.env.TZ = originalTZ;
    }

    assert.equal(countTokyo, countUTC, "o dia civil do paciente não pode depender do fuso do processo que está rodando o servidor");

    await db.delete(treatmentsTable).where(eq(treatmentsTable.id, treatmentId));
    await db.delete(patientsTable).where(eq(patientsTable.id, patientId));
  });
});
