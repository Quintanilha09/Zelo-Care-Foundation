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
import {
  sendDoseReminder, ESCALATION_LEVEL_FIRST, ESCALATION_LEVEL_SNOOZE,
  ESCALATION_LEVEL_BROADCAST, ESCALATION_LEVEL_FINAL, ESCALATION_LEVELS_MINUTES,
} from "../lib/dose-reminders.ts";
import { boss, QUEUE_DOSE_REMINDER } from "../lib/queue.ts";
import { Clock } from "../lib/clock.ts";
import { subscribeToPatientEvents, type RealtimeEvent } from "../lib/realtime.ts";
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

describe("Enfileiramento do lembrete — ZELO-27/30", () => {
  it("criar tratamento enfileira os 4 níveis da cascata upfront, cada um no startAfter certo", async () => {
    const { doseId, treatmentId } = await createTreatmentWithDose();

    const [doseRow] = await db.select().from(scheduledDosesTable).where(eq(scheduledDosesTable.id, doseId));
    const jobs = await boss.findJobs(QUEUE_DOSE_REMINDER, { data: { scheduledDoseId: doseId } });

    assert.equal(jobs.length, 4, "os 4 níveis (T+0/15/30/60) são agendados de uma vez, na criação da dose");
    for (const [level, minutes] of Object.entries(ESCALATION_LEVELS_MINUTES)) {
      const job = jobs.find((j) => j.singletonKey === `reminder:${doseId}:${level}`);
      assert.ok(job, `job do nível ${level} deveria existir`);
      const expected = doseRow.scheduledAt.getTime() + Number(minutes) * 60_000;
      assert.equal(new Date(job!.startAfter).getTime(), expected, `nível ${level} deveria disparar em T+${minutes}min`);
    }

    await db.delete(treatmentsTable).where(eq(treatmentsTable.id, treatmentId));
  });
});

describe("sendDoseReminder — comportamento no disparo", () => {
  it("dose pendente: grava notification e não menciona o medicamento no conteúdo", async () => {
    const { doseId, treatmentId } = await createTreatmentWithDose();

    await sendDoseReminder(doseId);

    const notifs = await db.select().from(notificationsTable).where(eq(notificationsTable.scheduledDoseId, doseId));
    assert.equal(notifs.length, 1, "nível 0 só alcança o(s) cuidador(es) principal(is) — o segundo cuidador não é primary_caregiver");
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
    assert.equal(notifs.length, 1, "10 execuções, 1 cuidador principal — continua exatamente 1 linha, nunca duplica");

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

  it("cuidador que desligou a categoria 'dose' não recebe a transmissão (nível 2), o outro continua recebendo", async () => {
    const { doseId, treatmentId } = await createTreatmentWithDose();
    // "critical" ignora o silêncio noturno — evita que o teste dependa da
    // hora real em que ele roda (ver isQuietHoursNow em dose-reminders.ts).
    await db.update(treatmentsTable).set({ escalationProfile: "critical" }).where(eq(treatmentsTable.id, treatmentId));

    await db.insert(notificationPreferencesTable).values({
      caregiverId: secondCaregiverId, patientId, category: "dose", enabled: false,
    });

    await sendDoseReminder(doseId, ESCALATION_LEVEL_BROADCAST);

    const notifs = await db
      .select({ caregiverId: notificationsTable.caregiverId })
      .from(notificationsTable)
      .where(eq(notificationsTable.scheduledDoseId, doseId));

    assert.equal(notifs.length, 1, "só o cuidador que não desligou a categoria recebe a transmissão");
    assert.equal(notifs[0].caregiverId, primaryCaregiverId);

    await db.delete(notificationPreferencesTable).where(and(eq(notificationPreferencesTable.caregiverId, secondCaregiverId), eq(notificationPreferencesTable.patientId, patientId)));
    await db.delete(treatmentsTable).where(eq(treatmentsTable.id, treatmentId));
  });

  it("cuidador sem conta vinculada (userId nulo) é ignorado sem erro", async () => {
    const [orphanCaregiver] = await db
      .insert(caregiversTable)
      .values({ familyId, name: "Convite Pendente", role: "primary_caregiver", userId: null })
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

describe("Cascata completa e perfis — ZELO-30", () => {
  it("os 4 níveis em sequência: destinatário e conteúdo certos por nível, sem duplicar ao reprocessar, sem citar cuidador nenhum", async () => {
    const { doseId, treatmentId } = await createTreatmentWithDose();
    // "critical" torna o teste independente da hora real em que ele roda —
    // é o próprio silêncio noturno que tem seu teste dedicado, abaixo.
    await db.update(treatmentsTable).set({ escalationProfile: "critical" }).where(eq(treatmentsTable.id, treatmentId));

    const events: RealtimeEvent[] = [];
    const unsubscribe = subscribeToPatientEvents(patientId, (e) => events.push(e));

    try {
      await sendDoseReminder(doseId, ESCALATION_LEVEL_FIRST);
      let notifs = await db.select().from(notificationsTable).where(eq(notificationsTable.scheduledDoseId, doseId));
      assert.equal(notifs.length, 1, "nível 0: só o cuidador principal");
      assert.equal(notifs[0].caregiverId, primaryCaregiverId);

      await sendDoseReminder(doseId, ESCALATION_LEVEL_SNOOZE);
      notifs = await db.select().from(notificationsTable).where(eq(notificationsTable.scheduledDoseId, doseId));
      assert.equal(notifs.length, 2, "nível 1: mais um lembrete, ainda só pro cuidador principal");
      assert.equal(notifs.find((n) => n.escalationLevel === ESCALATION_LEVEL_SNOOZE)?.caregiverId, primaryCaregiverId);

      await sendDoseReminder(doseId, ESCALATION_LEVEL_BROADCAST);
      notifs = await db.select().from(notificationsTable).where(eq(notificationsTable.scheduledDoseId, doseId));
      assert.equal(notifs.length, 4, "nível 2: transmite pros 2 cuidadores (perfil crítico)");
      const level2 = notifs.filter((n) => n.escalationLevel === ESCALATION_LEVEL_BROADCAST);
      assert.deepEqual(level2.map((n) => n.caregiverId).sort((a, b) => (a ?? 0) - (b ?? 0)), [primaryCaregiverId, secondCaregiverId].sort((a, b) => a - b));
      for (const n of level2) assert.ok(n.body?.includes("Alguém consegue verificar?"), "nível 2 usa o texto neutro da spec");

      // Reprocessar o MESMO nível (retry do pg-boss, por exemplo) não pode duplicar nenhum dos 2 destinatários.
      await sendDoseReminder(doseId, ESCALATION_LEVEL_BROADCAST);
      notifs = await db.select().from(notificationsTable).where(eq(notificationsTable.scheduledDoseId, doseId));
      assert.equal(notifs.length, 4, "reprocessar o nível 2 não duplica nenhum dos 2 destinatários");

      await sendDoseReminder(doseId, ESCALATION_LEVEL_FINAL);
      notifs = await db.select().from(notificationsTable).where(eq(notificationsTable.scheduledDoseId, doseId));
      assert.equal(notifs.length, 5, "nível 3: mais um aviso final, só pro cuidador principal");
      const level3 = notifs.filter((n) => n.escalationLevel === ESCALATION_LEVEL_FINAL);
      assert.equal(level3.length, 1);
      assert.equal(level3[0].caregiverId, primaryCaregiverId);
      assert.ok(level3[0].body?.includes("marcada como perdida"));

      const [doseRow] = await db.select({ status: scheduledDosesTable.status }).from(scheduledDosesTable).where(eq(scheduledDosesTable.id, doseId));
      assert.equal(doseRow.status, "late", "nível 3 marca a dose como perdida (retroativamente registrável)");

      // Revisão explícita: em nenhum nível o texto atribui a falta de registro a uma pessoa.
      for (const n of notifs) {
        assert.ok(!n.body?.includes("Cuidador Principal"), "corpo não pode citar o nome de um cuidador");
        assert.ok(!n.body?.includes("Segundo Cuidador"), "corpo não pode citar o nome de um cuidador");
      }

      assert.ok(events.some((e) => e.type === "escalation_triggered" && e.scheduledDoseId === doseId), "nível 2 publica escalation_triggered via SSE");
      assert.ok(events.some((e) => e.type === "dose_missed" && e.scheduledDoseId === doseId), "nível 3 publica dose_missed via SSE");
    } finally {
      unsubscribe();
      await db.delete(treatmentsTable).where(eq(treatmentsTable.id, treatmentId));
    }
  });

  it("perfil 'silencioso' nunca transmite além do cuidador de plantão, mesmo em pleno dia", async () => {
    const { doseId, treatmentId } = await createTreatmentWithDose();
    await db.update(treatmentsTable).set({ escalationProfile: "silent" }).where(eq(treatmentsTable.id, treatmentId));

    await sendDoseReminder(doseId, ESCALATION_LEVEL_BROADCAST);

    const notifs = await db.select().from(notificationsTable).where(eq(notificationsTable.scheduledDoseId, doseId));
    assert.equal(notifs.length, 0, "perfil silencioso nunca aciona o nível 2 — nem pro cuidador principal");

    await db.delete(treatmentsTable).where(eq(treatmentsTable.id, treatmentId));
  });

  it("perfil 'padrão' não transmite durante o silêncio noturno da família, mas transmite fora dele", async () => {
    const { doseId, treatmentId } = await createTreatmentWithDose();

    try {
      // 22h30 em America/Sao_Paulo (UTC-3, sem horário de verão) = 01h30 UTC
      // do dia seguinte — dentro da janela padrão da família (22:00-07:00).
      Clock.freezeAt(new Date("2026-01-15T01:30:00Z"));
      await sendDoseReminder(doseId, ESCALATION_LEVEL_BROADCAST);
      let notifs = await db.select().from(notificationsTable).where(eq(notificationsTable.scheduledDoseId, doseId));
      assert.equal(notifs.length, 0, "22h30 está dentro do silêncio noturno padrão — não transmite");

      // 14h em America/Sao_Paulo = 17h UTC — fora da janela.
      Clock.freezeAt(new Date("2026-01-15T17:00:00Z"));
      await sendDoseReminder(doseId, ESCALATION_LEVEL_BROADCAST);
      notifs = await db.select().from(notificationsTable).where(eq(notificationsTable.scheduledDoseId, doseId));
      assert.equal(notifs.length, 2, "14h está fora do silêncio noturno — transmite normalmente pros 2 cuidadores");
    } finally {
      Clock.reset();
      await db.delete(treatmentsTable).where(eq(treatmentsTable.id, treatmentId));
    }
  });

  it("registrar a dose no meio da cascata cancela os níveis restantes — nenhum lembrete a mais é enviado", async () => {
    const { doseId, treatmentId } = await createTreatmentWithDose();
    await db.update(treatmentsTable).set({ escalationProfile: "critical" }).where(eq(treatmentsTable.id, treatmentId));

    await sendDoseReminder(doseId, ESCALATION_LEVEL_FIRST); // nível 0 já disparou, "no minuto 0"

    await api("POST", `/patients/${patientId}/dose-records`, {
      scheduledDoseId: doseId, takenAt: Clock.now().toISOString(), outcome: "taken",
    }); // registrada "no minuto 12" — antes do nível 1 (T+15) chegar a disparar

    await sendDoseReminder(doseId, ESCALATION_LEVEL_SNOOZE);
    await sendDoseReminder(doseId, ESCALATION_LEVEL_BROADCAST);
    await sendDoseReminder(doseId, ESCALATION_LEVEL_FINAL);

    const notifs = await db.select().from(notificationsTable).where(eq(notificationsTable.scheduledDoseId, doseId));
    assert.equal(notifs.length, 1, "só o nível 0 (já disparado antes do registro) — os outros 3 níveis viram no-op");

    const [doseRow] = await db.select({ status: scheduledDosesTable.status }).from(scheduledDosesTable).where(eq(scheduledDosesTable.id, doseId));
    assert.equal(doseRow.status, "taken", "registrar a dose nunca é sobrescrito por um nível de escalonamento posterior");

    await db.delete(treatmentsTable).where(eq(treatmentsTable.id, treatmentId));
  });
});
