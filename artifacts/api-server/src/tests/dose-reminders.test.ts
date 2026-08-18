/**
 * Testes de lembrete de dose — ZELO (ZELO-27).
 *
 * A parte de "disparar no horário certo" tem duas metades testadas
 * separadamente, seguindo o padrão já usado para QUEUE_DOSE_SCHEDULED
 * (dose-generation.test.ts): o AGENDAMENTO (o job existe, com o
 * startAfter certo) é verificado inspecionando a fila via boss.findJobs;
 * o COMPORTAMENTO de quando o job dispara é verificado chamando
 * sendDoseReminder() diretamente. pg-boss usa o relógio real do Postgres
 * pra decidir quando um job com startAfter fica disponível — Clock
 * (lib/clock.ts) não influencia isso, então não dá pra "adiantar o
 * relógio" e fazer o pg-boss disparar um job antes da hora de verdade
 * dentro de um teste determinístico.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { eq, and } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  usersTable, caregiversTable, familiesTable, patientsTable, medicationsTable,
  treatmentsTable, scheduledDosesTable, doseRecordsTable, notificationsTable,
  notificationPreferencesTable,
} from "@workspace/db";
import { generateAccessToken } from "../lib/tokens.ts";
import { hashPassword } from "../lib/password.ts";
import { sendDoseReminder, ESCALATION_LEVEL_SNOOZE } from "../lib/dose-reminders.ts";
import { boss, QUEUE_DOSE_REMINDER } from "../lib/queue.ts";
import { Clock } from "../lib/clock.ts";
import app from "../app.ts";

let testPort: number;
let closeServer: () => Promise<void>;
let familyId: number;
let token: string;
let patientId: number;
let patientName: string;
let medicationId: number;
let medicationName: string;
let primaryCaregiverId: number;
let secondCaregiverId: number;

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

/** Cria um tratamento com doses hoje (00:01 e 23:59 — garante pelo menos 1 mesmo perto da meia-noite) e devolve a primeira dose pendente. */
async function createTreatmentWithDose(): Promise<{ doseId: number; treatmentId: number }> {
  const res = await api("POST", `/patients/${patientId}/treatments`, {
    medicationId,
    scheduleConfig: { scheduleType: "times_per_day", times: ["00:01", "23:59"] },
    startDate: Clock.todayInTimezone("America/Sao_Paulo"),
  });
  const treatmentId = (res.body as { id: number }).id;
  const [dose] = await db
    .select()
    .from(scheduledDosesTable)
    .where(eq(scheduledDosesTable.treatmentId, treatmentId))
    .orderBy(scheduledDosesTable.scheduledAt)
    .limit(1);
  return { doseId: dose.id, treatmentId };
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
    .values({ name: "Família Lembrete Teste", slug: `dose-reminder-test-${Date.now()}` })
    .returning();
  familyId = family.id;

  const [user] = await db
    .insert(usersTable)
    .values({ email: `dose-reminder-${Date.now()}@zelo.test`, name: "Cuidador Principal", passwordHash: await hashPassword("x"), emailVerified: true, status: "active" })
    .returning();
  const [caregiver] = await db
    .insert(caregiversTable)
    .values({ familyId, userId: user.id, name: "Cuidador Principal", role: "primary_caregiver" })
    .returning();
  primaryCaregiverId = caregiver.id;
  token = generateAccessToken(user.id, familyId, caregiver.id, "primary_caregiver");

  const [secondUser] = await db
    .insert(usersTable)
    .values({ email: `dose-reminder-2nd-${Date.now()}@zelo.test`, name: "Segundo Cuidador", passwordHash: await hashPassword("x"), emailVerified: true, status: "active" })
    .returning();
  const [secondCaregiver] = await db
    .insert(caregiversTable)
    .values({ familyId, userId: secondUser.id, name: "Segundo Cuidador", role: "caregiver" })
    .returning();
  secondCaregiverId = secondCaregiver.id;

  patientName = "Paciente Lembrete Teste";
  const [patient] = await db
    .insert(patientsTable)
    .values({ familyId, name: patientName, timezone: "America/Sao_Paulo" })
    .returning();
  patientId = patient.id;

  medicationName = "Medicamento Fictício Lembrete Teste";
  const [medication] = await db
    .insert(medicationsTable)
    .values({ familyId, name: medicationName })
    .returning();
  medicationId = medication.id;
});

after(async () => {
  Clock.reset();
  await closeServer();
  await boss.stop({ graceful: false });
  await db.delete(familiesTable).where(eq(familiesTable.id, familyId));
});

describe("Enfileiramento do lembrete — ZELO-27", () => {
  it("criar tratamento enfileira 1 job de lembrete por dose, com startAfter = scheduledAt", async () => {
    const { doseId, treatmentId } = await createTreatmentWithDose();

    const [doseRow] = await db.select().from(scheduledDosesTable).where(eq(scheduledDosesTable.id, doseId));
    const jobs = await boss.findJobs(QUEUE_DOSE_REMINDER, { data: { scheduledDoseId: doseId } });

    assert.equal(jobs.length, 1, "deve existir exatamente 1 job de lembrete para a dose");
    assert.equal(jobs[0].singletonKey, `reminder:${doseId}:0`);
    assert.equal(new Date(jobs[0].startAfter).getTime(), doseRow.scheduledAt.getTime(), "o lembrete não pode disparar antes (nem muito depois) do horário da dose");

    await db.delete(treatmentsTable).where(eq(treatmentsTable.id, treatmentId));
  });
});

describe("sendDoseReminder — comportamento no disparo", () => {
  it("dose pendente: grava notification e não menciona o medicamento no conteúdo", async () => {
    const { doseId, treatmentId } = await createTreatmentWithDose();

    await sendDoseReminder(doseId);

    const notifs = await db.select().from(notificationsTable).where(eq(notificationsTable.scheduledDoseId, doseId));
    assert.equal(notifs.length, 2, "2 cuidadores na família, nenhum desligou a categoria — os 2 recebem");
    for (const n of notifs) {
      assert.equal(n.type, "dose_reminder");
      assert.ok(n.sentAt, "sentAt precisa estar gravado — nunca existe push enviado sem rastro");
      assert.ok(n.body?.includes(patientName), "o corpo deve identificar o paciente");
      assert.ok(!n.body?.includes(medicationName), "o corpo NUNCA pode conter o nome do medicamento (regra de privacidade)");
      assert.ok(!n.title?.includes(medicationName));
    }

    await db.delete(treatmentsTable).where(eq(treatmentsTable.id, treatmentId));
  });

  it("processar o mesmo job 10 vezes gera exatamente 1 notification por cuidador (nunca reenvia)", async () => {
    const { doseId, treatmentId } = await createTreatmentWithDose();

    for (let i = 0; i < 10; i++) {
      await sendDoseReminder(doseId);
    }

    const notifs = await db.select().from(notificationsTable).where(eq(notificationsTable.scheduledDoseId, doseId));
    assert.equal(notifs.length, 2, "10 execuções, 2 cuidadores — continua exatamente 1 linha por cuidador");

    await db.delete(treatmentsTable).where(eq(treatmentsTable.id, treatmentId));
  });

  it("dose já registrada (status != pending) não gera lembrete nenhum", async () => {
    const { doseId, treatmentId } = await createTreatmentWithDose();

    await api("POST", `/patients/${patientId}/dose-records`, {
      scheduledDoseId: doseId, takenAt: Clock.now().toISOString(), outcome: "taken",
    });

    await sendDoseReminder(doseId);

    const notifs = await db.select().from(notificationsTable).where(eq(notificationsTable.scheduledDoseId, doseId));
    assert.equal(notifs.length, 0, "dose já tomada não deve gerar lembrete — checagem é no disparo, não no agendamento");

    await db.delete(treatmentsTable).where(eq(treatmentsTable.id, treatmentId));
  });

  it("dose apagada (tratamento editado/removido depois de agendar) não lança erro, só encerra", async () => {
    const { doseId, treatmentId } = await createTreatmentWithDose();
    await db.delete(treatmentsTable).where(eq(treatmentsTable.id, treatmentId)); // cascade apaga a dose

    await assert.doesNotReject(() => sendDoseReminder(doseId));

    const notifs = await db.select().from(notificationsTable).where(eq(notificationsTable.scheduledDoseId, doseId));
    assert.equal(notifs.length, 0);
  });

  it("cuidador que desligou a categoria 'dose' para o paciente não recebe, o outro continua recebendo", async () => {
    const { doseId, treatmentId } = await createTreatmentWithDose();

    await db.insert(notificationPreferencesTable).values({
      caregiverId: secondCaregiverId, patientId, category: "dose", enabled: false,
    });

    await sendDoseReminder(doseId);

    const notifs = await db
      .select({ caregiverId: notificationsTable.caregiverId })
      .from(notificationsTable)
      .where(eq(notificationsTable.scheduledDoseId, doseId));

    assert.equal(notifs.length, 1, "só o cuidador que não desligou a categoria recebe");
    assert.equal(notifs[0].caregiverId, primaryCaregiverId);

    await db.delete(notificationPreferencesTable).where(and(eq(notificationPreferencesTable.caregiverId, secondCaregiverId), eq(notificationPreferencesTable.patientId, patientId)));
    await db.delete(treatmentsTable).where(eq(treatmentsTable.id, treatmentId));
  });

  it("cuidador sem conta vinculada (userId nulo) é ignorado sem erro", async () => {
    const [orphanCaregiver] = await db
      .insert(caregiversTable)
      .values({ familyId, name: "Convite Pendente", role: "caregiver", userId: null })
      .returning();

    const { doseId, treatmentId } = await createTreatmentWithDose();
    await assert.doesNotReject(() => sendDoseReminder(doseId));

    const notifs = await db
      .select({ caregiverId: notificationsTable.caregiverId })
      .from(notificationsTable)
      .where(eq(notificationsTable.scheduledDoseId, doseId));
    assert.equal(notifs.some((n) => n.caregiverId === orphanCaregiver.id), false);

    await db.delete(treatmentsTable).where(eq(treatmentsTable.id, treatmentId));
    await db.delete(caregiversTable).where(eq(caregiversTable.id, orphanCaregiver.id));
  });
});

describe("Privacidade opcional por família — ZELO-28", () => {
  it("families.showMedicationInPush=true inclui o medicamento; false (padrão) nunca inclui", async () => {
    const { doseId, treatmentId } = await createTreatmentWithDose();

    await sendDoseReminder(doseId);
    let notifs = await db.select().from(notificationsTable).where(eq(notificationsTable.scheduledDoseId, doseId));
    assert.ok(notifs.every((n) => !n.body?.includes(medicationName)), "padrão (desligado) nunca menciona o medicamento");
    await db.delete(notificationsTable).where(eq(notificationsTable.scheduledDoseId, doseId));

    await db.update(familiesTable).set({ showMedicationInPush: true }).where(eq(familiesTable.id, familyId));
    await sendDoseReminder(doseId);
    notifs = await db.select().from(notificationsTable).where(eq(notificationsTable.scheduledDoseId, doseId));
    assert.ok(notifs.every((n) => n.body?.includes(medicationName)), "família que ligou o ajuste explicitamente vê o medicamento");

    await db.update(familiesTable).set({ showMedicationInPush: false }).where(eq(familiesTable.id, familyId));
    await db.delete(treatmentsTable).where(eq(treatmentsTable.id, treatmentId));
  });
});

describe("Adiar 15 min (snooze) — ZELO-28", () => {
  it("agenda um segundo lembrete (nível 1) para ~15 minutos à frente", async () => {
    const { doseId, treatmentId } = await createTreatmentWithDose();
    const before = Clock.now().getTime();

    const res = await api("POST", `/patients/${patientId}/dose-records/${doseId}/snooze`);
    assert.equal(res.status, 200);

    const jobs = await boss.findJobs(QUEUE_DOSE_REMINDER, { data: { scheduledDoseId: doseId, level: ESCALATION_LEVEL_SNOOZE } });
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].singletonKey, `reminder:${doseId}:${ESCALATION_LEVEL_SNOOZE}`);
    const deltaMinutes = (new Date(jobs[0].startAfter).getTime() - before) / 60_000;
    assert.ok(deltaMinutes > 14.5 && deltaMinutes < 15.5, `esperava ~15min à frente, ficou ${deltaMinutes.toFixed(2)}min`);

    await db.delete(treatmentsTable).where(eq(treatmentsTable.id, treatmentId));
  });

  it("tocar 'Adiar' duas vezes pra mesma dose não cria um segundo job (mesma singletonKey)", async () => {
    const { doseId, treatmentId } = await createTreatmentWithDose();

    await api("POST", `/patients/${patientId}/dose-records/${doseId}/snooze`);
    await api("POST", `/patients/${patientId}/dose-records/${doseId}/snooze`);

    const jobs = await boss.findJobs(QUEUE_DOSE_REMINDER, { data: { scheduledDoseId: doseId, level: ESCALATION_LEVEL_SNOOZE } });
    assert.equal(jobs.length, 1, "policy exclusive da fila garante um único job pendente por dose+nível");

    await db.delete(treatmentsTable).where(eq(treatmentsTable.id, treatmentId));
  });

  it("dose já registrada não pode ser adiada (409)", async () => {
    const { doseId, treatmentId } = await createTreatmentWithDose();
    await api("POST", `/patients/${patientId}/dose-records`, { scheduledDoseId: doseId, takenAt: Clock.now().toISOString(), outcome: "taken" });

    const res = await api("POST", `/patients/${patientId}/dose-records/${doseId}/snooze`);
    assert.equal(res.status, 409);

    await db.delete(treatmentsTable).where(eq(treatmentsTable.id, treatmentId));
  });
});
