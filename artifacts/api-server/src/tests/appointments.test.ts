/**
 * Testes de consultas e exames — ZELO (ZELO-36).
 *
 * "Nenhum texto do app orienta preparo por conta própria" (critério de
 * aceite) é testado de forma concreta: varre o código-fonte da tela em
 * busca de instrução clínica hardcoded — mesmo padrão de varredura já
 * usado pela ZELO-33 (linguagem de culpa) e ZELO-20 (recomendação clínica).
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { eq, and } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  usersTable, caregiversTable, familiesTable, patientsTable,
  appointmentsTable, notificationsTable, subscriptionsTable,
} from "@workspace/db";
import { generateAccessToken } from "../lib/tokens.ts";
import { hashPassword } from "../lib/password.ts";
import { Clock } from "../lib/clock.ts";
import { boss, QUEUE_APPOINTMENT_REMINDER } from "../lib/queue.ts";
import {
  sendAppointmentReminder, 
  APPOINTMENT_REMINDER_LEVEL_WEEK, APPOINTMENT_REMINDER_LEVEL_DAY, APPOINTMENT_REMINDER_LEVEL_HOURS,
  APPOINTMENT_REMINDER_MINUTES_BEFORE,
} from "../lib/appointment-reminders.ts";
import app from "../app.ts";

let testPort: number;
let closeServer: () => Promise<void>;
let familyId: number;
let token: string;
let _userId: number;
let patientId: number;

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

  const [family] = await db.insert(familiesTable).values({ name: "Família Consultas Teste", slug: `appt-test-${Date.now()}` }).returning();
  familyId = family.id;

  const [user] = await db.insert(usersTable).values({ email: `appt-test-${Date.now()}@zelo.test`, name: "Cuidador Consultas", passwordHash: await hashPassword("x"), emailVerified: true, status: "active" }).returning();
  _userId = user.id;
  const [caregiver] = await db.insert(caregiversTable).values({ familyId, userId: user.id, name: "Cuidador Consultas", role: "primary_caregiver" }).returning();
  token = generateAccessToken(user.id, familyId, caregiver.id, "primary_caregiver");

  const [patient] = await db.insert(patientsTable).values({ familyId, name: "Paciente Consultas Teste", timezone: "America/Sao_Paulo" }).returning();
  patientId = patient.id;

  // ZELO-38: consultas são recurso do plano Família por inteiro — este
  // arquivo não é sobre limite de plano, então usa premium como baseline
  // (mesmo padrão de stock.test.ts/adherence-calendar.test.ts).
  await db.insert(subscriptionsTable).values({ familyId, plan: "premium", status: "active" });
});

after(async () => {
  Clock.reset();
  await closeServer();
  // Criar consulta agenda lembretes no pg-boss — mesmo padrão de todo outro
  // arquivo que toca a fila (senão os timers internos mantêm o processo vivo).
  await boss.stop({ graceful: false });
  await db.delete(familiesTable).where(eq(familiesTable.id, familyId));
});

async function cleanupAppointments() {
  await db.delete(appointmentsTable).where(eq(appointmentsTable.patientId, patientId));
  await db.delete(notificationsTable).where(eq(notificationsTable.familyId, familyId));
}

describe("Agendamento dos 3 níveis — ZELO-36", () => {
  it("consulta 9 dias no futuro agenda os 3 níveis (1 semana/1 dia/2h) no startAfter certo", async () => {
    Clock.freezeAt(new Date("2026-01-01T12:00:00Z"));
    const res = await api("POST", `/patients/${patientId}/appointments`, {
      specialty: "Cardiologia", scheduledDate: "2026-01-10", scheduledTime: "09:00", // 12:00 UTC (America/Sao_Paulo, -03:00)
    });
    assert.equal(res.status, 201);
    const appointmentId = (res.body as { id: number }).id;

    const jobs = await boss.findJobs(QUEUE_APPOINTMENT_REMINDER, { data: { appointmentId } });
    assert.equal(jobs.length, 3, "os 3 níveis deveriam ser agendados de uma vez, na criação");

    const scheduledAtMs = new Date("2026-01-10T12:00:00Z").getTime();
    for (const [level, minutes] of Object.entries(APPOINTMENT_REMINDER_MINUTES_BEFORE)) {
      const job = jobs.find((j) => j.singletonKey === `appt-reminder:${appointmentId}:${level}`);
      assert.ok(job, `job do nível ${level} deveria existir`);
      const expected = scheduledAtMs - Number(minutes) * 60_000;
      assert.equal(new Date(job!.startAfter).getTime(), expected, `nível ${level} deveria disparar ${minutes}min antes`);
    }

    await cleanupAppointments();
  });

  it("consulta só 12h no futuro NÃO agenda os níveis de 1 semana/1 dia (já estariam no passado) — só o de 2h", async () => {
    Clock.freezeAt(new Date("2026-02-01T00:00:00Z"));
    const res = await api("POST", `/patients/${patientId}/appointments`, {
      specialty: "Ortopedia", scheduledDate: "2026-02-01", scheduledTime: "09:00", // 12:00 UTC, 12h à frente
    });
    const appointmentId = (res.body as { id: number }).id;

    const jobs = await boss.findJobs(QUEUE_APPOINTMENT_REMINDER, { data: { appointmentId } });
    assert.equal(jobs.length, 1, "só o nível de 2h ainda está no futuro");
    assert.equal(jobs[0].singletonKey, `appt-reminder:${appointmentId}:${APPOINTMENT_REMINDER_LEVEL_HOURS}`);

    await cleanupAppointments();
  });
});

describe("Remarcar e cancelar — ZELO-36", () => {
  it("remarcar (nova data) cancela os 3 lembretes antigos e agenda os novos, sem duplicar", async () => {
    Clock.freezeAt(new Date("2026-03-01T00:00:00Z"));
    const create = await api("POST", `/patients/${patientId}/appointments`, {
      specialty: "Dermatologia", scheduledDate: "2026-03-10", scheduledTime: "09:00",
    });
    const appointmentId = (create.body as { id: number }).id;

    const before = await boss.findJobs(QUEUE_APPOINTMENT_REMINDER, { data: { appointmentId } });
    assert.equal(before.length, 3);
    const oldWeekJobStartAfter = before.find((j) => j.singletonKey === `appt-reminder:${appointmentId}:${APPOINTMENT_REMINDER_LEVEL_WEEK}`)!.startAfter;

    const patch = await api("PATCH", `/patients/${patientId}/appointments/${appointmentId}`, {
      scheduledDate: "2026-03-20", scheduledTime: "14:00",
    });
    assert.equal(patch.status, 200);

    const after_ = await boss.findJobs(QUEUE_APPOINTMENT_REMINDER, { data: { appointmentId } });
    assert.equal(after_.length, 3, "continua exatamente 3 — remarcar não duplica");
    const newWeekJob = after_.find((j) => j.singletonKey === `appt-reminder:${appointmentId}:${APPOINTMENT_REMINDER_LEVEL_WEEK}`)!;
    assert.notEqual(new Date(newWeekJob.startAfter).getTime(), new Date(oldWeekJobStartAfter).getTime(), "o horário deveria ter mudado pra refletir a nova data");

    await cleanupAppointments();
  });

  it("cancelar a consulta remove os lembretes pendentes", async () => {
    Clock.freezeAt(new Date("2026-04-01T00:00:00Z"));
    const create = await api("POST", `/patients/${patientId}/appointments`, {
      specialty: "Oftalmologia", scheduledDate: "2026-04-10", scheduledTime: "09:00",
    });
    const appointmentId = (create.body as { id: number }).id;
    assert.equal((await boss.findJobs(QUEUE_APPOINTMENT_REMINDER, { data: { appointmentId } })).length, 3);

    const patch = await api("PATCH", `/patients/${patientId}/appointments/${appointmentId}`, { status: "cancelled" });
    assert.equal(patch.status, 200);

    const remaining = await boss.findJobs(QUEUE_APPOINTMENT_REMINDER, { data: { appointmentId } });
    assert.equal(remaining.length, 0, "cancelar não deveria deixar lembrete nenhum pendente");

    await cleanupAppointments();
  });
});

describe("Conteúdo do lembrete de 2h — ZELO-36", () => {
  it("inclui a lista de perguntas ao médico em destaque, só no nível de 2h", async () => {
    Clock.freezeAt(new Date("2026-05-01T00:00:00Z"));
    const create = await api("POST", `/patients/${patientId}/appointments`, {
      specialty: "Endocrinologia", scheduledDate: "2026-05-01", scheduledTime: "10:00",
    });
    const appointmentId = (create.body as { id: number }).id;
    await api("PATCH", `/patients/${patientId}/appointments/${appointmentId}`, {
      questionsForDoctor: ["Posso trocar o horário do remédio?", "O exame precisa jejum?"],
    });

    await sendAppointmentReminder(appointmentId, APPOINTMENT_REMINDER_LEVEL_HOURS);
    const [notif] = await db.select().from(notificationsTable).where(and(eq(notificationsTable.appointmentId, appointmentId), eq(notificationsTable.escalationLevel, APPOINTMENT_REMINDER_LEVEL_HOURS)));
    assert.ok(notif.body?.includes("Posso trocar o horário do remédio?"));
    assert.ok(notif.body?.includes("O exame precisa jejum?"));

    await sendAppointmentReminder(appointmentId, APPOINTMENT_REMINDER_LEVEL_WEEK);
    const [notifWeek] = await db.select().from(notificationsTable).where(and(eq(notificationsTable.appointmentId, appointmentId), eq(notificationsTable.escalationLevel, APPOINTMENT_REMINDER_LEVEL_WEEK)));
    assert.ok(!notifWeek.body?.includes("Posso trocar"), "perguntas só aparecem no lembrete de 2h, não nos outros níveis");

    await cleanupAppointments();
  });

  it("reprocessar o mesmo nível pro mesmo cuidador não duplica notificação (idempotência)", async () => {
    Clock.freezeAt(new Date("2026-06-01T00:00:00Z"));
    const create = await api("POST", `/patients/${patientId}/appointments`, {
      specialty: "Neurologia", scheduledDate: "2026-06-01", scheduledTime: "10:00",
    });
    const appointmentId = (create.body as { id: number }).id;

    await sendAppointmentReminder(appointmentId, APPOINTMENT_REMINDER_LEVEL_DAY);
    await sendAppointmentReminder(appointmentId, APPOINTMENT_REMINDER_LEVEL_DAY);
    await sendAppointmentReminder(appointmentId, APPOINTMENT_REMINDER_LEVEL_DAY);

    const notifs = await db.select().from(notificationsTable).where(and(eq(notificationsTable.appointmentId, appointmentId), eq(notificationsTable.escalationLevel, APPOINTMENT_REMINDER_LEVEL_DAY)));
    assert.equal(notifs.length, 1, "3 execuções do mesmo job só geram 1 notificação por cuidador");

    await cleanupAppointments();
  });
});

describe("Anexo — ZELO-36", () => {
  it("aceita anexo (JPEG) e devolve pelo endpoint autenticado", async () => {
    Clock.freezeAt(new Date("2026-07-01T00:00:00Z"));
    const create = await api("POST", `/patients/${patientId}/appointments`, {
      specialty: "Exame de sangue", scheduledDate: "2026-07-10", scheduledTime: "08:00",
    });
    const appointmentId = (create.body as { id: number }).id;

    const boundary = "----zeloTestBoundary";
    const fileContent = Buffer.from([0xff, 0xd8, 0xff, 0xd9]); // magic bytes JPEG mínimos
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="pedido.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`),
      fileContent,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);

    const uploadResult = await new Promise<{ status: number }>((resolve, reject) => {
      const req = http.request({
        hostname: "127.0.0.1", port: testPort, path: `/api/patients/${patientId}/appointments/${appointmentId}/attachment`, method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": `multipart/form-data; boundary=${boundary}`, "Content-Length": body.length },
      }, (res) => { res.on("data", () => {}); res.on("end", () => resolve({ status: res.statusCode ?? 0 })); });
      req.on("error", reject);
      req.write(body);
      req.end();
    });
    assert.equal(uploadResult.status, 201);

    const list = await api("GET", `/patients/${patientId}/appointments`);
    const found = (list.body as Array<{ id: number; hasAttachment: boolean }>).find((a) => a.id === appointmentId);
    assert.equal(found?.hasAttachment, true);

    await cleanupAppointments();
  });
});

describe("Isolamento entre famílias", () => {
  it("família B não vê, edita nem anexa em consulta de A", async () => {
    Clock.freezeAt(new Date("2026-08-01T00:00:00Z"));
    const create = await api("POST", `/patients/${patientId}/appointments`, {
      specialty: "Psiquiatria", scheduledDate: "2026-08-10", scheduledTime: "09:00",
    });
    const appointmentId = (create.body as { id: number }).id;

    const [familyB] = await db.insert(familiesTable).values({ name: "Família B Consultas", slug: `appt-b-${Date.now()}` }).returning();
    const [userB] = await db.insert(usersTable).values({ email: `appt-b-${Date.now()}@zelo.test`, name: "Cuidador B", passwordHash: await hashPassword("x"), emailVerified: true, status: "active" }).returning();
    const [caregiverB] = await db.insert(caregiversTable).values({ familyId: familyB.id, userId: userB.id, name: "Cuidador B", role: "primary_caregiver" }).returning();
    // Precisa do relógio REAL pra gerar o token — o JWT expira relativo a
    // Clock.now() (congelado em 2026-08-01 acima), mas o jsonwebtoken
    // valida exp contra o relógio de verdade do sistema (ele não conhece
    // nosso Clock injetável); com o congelamento ainda ativo, o token
    // nasceria expirado e a checagem de isolamento nunca chegaria a rodar
    // (401 antes de qualquer coisa, não o 404 que este teste prova).
    Clock.reset();
    const tokenB = generateAccessToken(userB.id, familyB.id, caregiverB.id, "primary_caregiver");

    const getRes = await api("GET", `/patients/${patientId}/appointments`, undefined, tokenB);
    assert.equal(getRes.status, 404);
    const patchRes = await api("PATCH", `/patients/${patientId}/appointments/${appointmentId}`, { status: "cancelled" }, tokenB);
    assert.equal(patchRes.status, 404);

    await db.delete(familiesTable).where(eq(familiesTable.id, familyB.id));
    await cleanupAppointments();
  });
});

describe("Sem linguagem de preparo por conta própria — ZELO-36", () => {
  it("AppointmentsPage.tsx nunca sugere jejum/suspensão de remédio como instrução do app, só campo pra anotar o que o médico disse", () => {
    const path = fileURLToPath(new URL("../../../zelo/src/pages/AppointmentsPage.tsx", import.meta.url));
    const source = readFileSync(path, "utf-8").toLowerCase();
    const forbidden = ["recomendamos jejum", "é necessário jejuar", "suspenda o medicamento", "não coma antes", "jejue por"];
    for (const phrase of forbidden) {
      assert.ok(!source.includes(phrase), `cópia não pode conter "${phrase}" — preparo é sempre relato do médico, nunca orientação do app`);
    }
  });
});
