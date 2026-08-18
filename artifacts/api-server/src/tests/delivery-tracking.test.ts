/**
 * Testes de rastreamento de entrega — ZELO (ZELO-29).
 *
 * "Enviado" (sentAt, sempre preenchido por sendDoseReminder) não é a mesma
 * coisa que "entregue" (deliveredAt, só preenchido pelo beacon do service
 * worker via POST /push/ack). O envio em si é mockado (t.mock.method em
 * webpush.sendNotification, mesmo padrão de push.test.ts) — o que importa
 * aqui é a REAÇÃO do sistema à confirmação (ou falta dela), não o
 * protocolo HTTP do web-push.
 *
 * A verificação de 3min funciona do mesmo jeito que o disparo do lembrete
 * em si (ver dose-reminders.test.ts): o AGENDAMENTO do job é inspecionado
 * via boss.findJobs (startAfter certo), e o COMPORTAMENTO de quando ele
 * dispara é testado chamando checkDeliveryAndEscalate() diretamente — não
 * dá pra "adiantar o relógio" e fazer o pg-boss disparar antes da hora de
 * verdade (ele usa o relógio real do Postgres, não Clock.ts).
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { eq } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  usersTable, caregiversTable, familiesTable, patientsTable, medicationsTable,
  treatmentsTable, scheduledDosesTable, notificationsTable, pushSubscriptionsTable,
} from "@workspace/db";
import webpush from "web-push";
import { generateAccessToken } from "../lib/tokens.ts";
import { hashPassword } from "../lib/password.ts";
import { sendDoseReminder, checkDeliveryAndEscalate, ESCALATION_LEVEL_SNOOZE } from "../lib/dose-reminders.ts";
import { boss, QUEUE_DELIVERY_CHECK } from "../lib/queue.ts";
import { Clock } from "../lib/clock.ts";
import app from "../app.ts";

let testPort: number;
let closeServer: () => Promise<void>;
let familyId: number;
let token: string;
let patientId: number;
let medicationId: number;

const FAKE_P256DH = "BLo2cuzlA-4wjOA7jjnJbnw8wRUwGPJgEYbL1xwuLk-1lavTlcvJZoEq991XtZjCV1seThGWVJwhVb1_OEnjwSM";
const FAKE_AUTH = "E8QZ6W_hYURALUeSRTn6DA";

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

/** Requisição sem Authorization — o beacon do service worker nunca tem token. */
async function apiNoAuth(method: string, path: string, body?: unknown) {
  const payload = body !== undefined ? JSON.stringify(body) : undefined;
  return new Promise<{ status: number; body: unknown }>((resolve, reject) => {
    const req = http.request(
      { hostname: "127.0.0.1", port: testPort, path: `/api${path}`, method, headers: { "Content-Type": "application/json", ...(payload ? { "Content-Length": Buffer.byteLength(payload) } : {}) } },
      (res) => {
        let data = "";
        res.on("data", (c: Buffer) => (data += c.toString()));
        res.on("end", () => { try { resolve({ status: res.statusCode ?? 0, body: JSON.parse(data) }); } catch { resolve({ status: res.statusCode ?? 0, body: data }); } });
      }
    );
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function createTreatmentWithDose(): Promise<{ doseId: number; treatmentId: number }> {
  const res = await api("POST", `/patients/${patientId}/treatments`, {
    medicationId,
    scheduleConfig: { scheduleType: "times_per_day", times: ["00:01", "23:59"] },
    startDate: Clock.todayInTimezone("America/Sao_Paulo"),
  });
  const treatmentId = (res.body as { id: number }).id;
  const [dose] = await db.select().from(scheduledDosesTable).where(eq(scheduledDosesTable.treatmentId, treatmentId)).orderBy(scheduledDosesTable.scheduledAt).limit(1);
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

  const [family] = await db.insert(familiesTable).values({ name: "Família Entrega Teste", slug: `delivery-test-${Date.now()}` }).returning();
  familyId = family.id;

  const [user] = await db.insert(usersTable).values({ email: `delivery-${Date.now()}@zelo.test`, name: "Cuidador Entrega", passwordHash: await hashPassword("x"), emailVerified: true, status: "active" }).returning();
  const [caregiver] = await db.insert(caregiversTable).values({ familyId, userId: user.id, name: "Cuidador Entrega", role: "primary_caregiver" }).returning();
  token = generateAccessToken(user.id, familyId, caregiver.id, "primary_caregiver");

  const [patient] = await db.insert(patientsTable).values({ familyId, name: "Paciente Entrega Teste", timezone: "America/Sao_Paulo" }).returning();
  patientId = patient.id;

  const [medication] = await db.insert(medicationsTable).values({ familyId, name: "Medicamento Fictício Entrega Teste" }).returning();
  medicationId = medication.id;
});

after(async () => {
  Clock.reset();
  await closeServer();
  await boss.stop({ graceful: false });
  await db.delete(familiesTable).where(eq(familiesTable.id, familyId));
});

describe("Assinatura grava plataforma — ZELO-29", () => {
  it("POST /push/subscribe persiste platform", async () => {
    const res = await api("POST", "/push/subscribe", {
      endpoint: `https://push.test/platform-${Date.now()}`,
      keys: { p256dh: FAKE_P256DH, auth: FAKE_AUTH },
      deviceLabel: "iPhone de Teste", platform: "ios",
    });
    assert.equal(res.status, 200);

    const [row] = await db.select({ platform: pushSubscriptionsTable.platform }).from(pushSubscriptionsTable).where(eq(pushSubscriptionsTable.id, (res.body as { id: number }).id));
    assert.equal(row.platform, "ios");

    await api("DELETE", "/push/subscribe", { endpoint: `https://push.test/platform-${Date.now()}` });
  });
});

describe("Verificação de entrega em 3min — ZELO-29", () => {
  it("enviar nível 0 agenda QUEUE_DELIVERY_CHECK pra 3 minutos à frente", async (t) => {
    if (!process.env.VAPID_PUBLIC_KEY) { t.skip("VAPID_PUBLIC_KEY não configurada neste ambiente"); return; }
    t.mock.method(webpush, "sendNotification", async () => ({ statusCode: 201, body: "", headers: {} }));

    const endpoint = `https://push.test/delivcheck-${Date.now()}`;
    await api("POST", "/push/subscribe", { endpoint, keys: { p256dh: FAKE_P256DH, auth: FAKE_AUTH }, deviceLabel: "Dispositivo" });
    const { doseId, treatmentId } = await createTreatmentWithDose();

    const before = Clock.now().getTime();
    await sendDoseReminder(doseId);

    const [notif] = await db.select().from(notificationsTable).where(eq(notificationsTable.scheduledDoseId, doseId));
    const jobs = await boss.findJobs(QUEUE_DELIVERY_CHECK, { data: { notificationId: notif.id } });
    assert.equal(jobs.length, 1, "deve existir exatamente 1 job de verificação por notification enviada");
    const deltaMinutes = (new Date(jobs[0].startAfter).getTime() - before) / 60_000;
    assert.ok(deltaMinutes > 2.5 && deltaMinutes < 3.5, `esperava ~3min à frente, ficou ${deltaMinutes.toFixed(2)}min`);

    await api("DELETE", "/push/subscribe", { endpoint });
    await db.delete(treatmentsTable).where(eq(treatmentsTable.id, treatmentId));
  });

  it("sem confirmação de entrega e dose ainda pendente: escala pro nível 1", async (t) => {
    if (!process.env.VAPID_PUBLIC_KEY) { t.skip("VAPID_PUBLIC_KEY não configurada neste ambiente"); return; }
    t.mock.method(webpush, "sendNotification", async () => ({ statusCode: 201, body: "", headers: {} }));

    const endpoint = `https://push.test/escalate-${Date.now()}`;
    await api("POST", "/push/subscribe", { endpoint, keys: { p256dh: FAKE_P256DH, auth: FAKE_AUTH }, deviceLabel: "Dispositivo Desligado" });
    const { doseId, treatmentId } = await createTreatmentWithDose();
    await sendDoseReminder(doseId);
    const [level0] = await db.select().from(notificationsTable).where(eq(notificationsTable.scheduledDoseId, doseId));

    // Ninguém chamou /push/ack — simula "dispositivo desligado", nunca recebeu de verdade.
    await checkDeliveryAndEscalate(level0.id);

    const level1 = await db.select().from(notificationsTable).where(eq(notificationsTable.scheduledDoseId, doseId));
    assert.equal(level1.length, 2, "deve existir a notification original (nível 0) e a escalada (nível 1)");
    assert.ok(level1.some((n) => n.escalationLevel === ESCALATION_LEVEL_SNOOZE), "a escalação usa o mesmo nível do botão manual 'Adiar'");

    await api("DELETE", "/push/subscribe", { endpoint });
    await db.delete(treatmentsTable).where(eq(treatmentsTable.id, treatmentId));
  });

  it("com entrega confirmada, não escala", async (t) => {
    if (!process.env.VAPID_PUBLIC_KEY) { t.skip("VAPID_PUBLIC_KEY não configurada neste ambiente"); return; }
    t.mock.method(webpush, "sendNotification", async () => ({ statusCode: 201, body: "", headers: {} }));

    const endpoint = `https://push.test/confirmed-${Date.now()}`;
    await api("POST", "/push/subscribe", { endpoint, keys: { p256dh: FAKE_P256DH, auth: FAKE_AUTH }, deviceLabel: "Dispositivo Ligado", platform: "android" });
    const { doseId, treatmentId } = await createTreatmentWithDose();
    await sendDoseReminder(doseId);
    const [level0] = await db.select().from(notificationsTable).where(eq(notificationsTable.scheduledDoseId, doseId));

    // Beacon do service worker: confirma entrega de verdade, sem auth.
    const ackRes = await apiNoAuth("POST", "/push/ack", { endpoint, notificationId: level0.id });
    assert.equal(ackRes.status, 204);

    const [delivered] = await db.select().from(notificationsTable).where(eq(notificationsTable.id, level0.id));
    assert.ok(delivered.deliveredAt, "deliveredAt precisa estar preenchido após o ack");
    assert.equal(delivered.deliveredViaPlatform, "android");

    await checkDeliveryAndEscalate(level0.id);
    const afterCheck = await db.select().from(notificationsTable).where(eq(notificationsTable.scheduledDoseId, doseId));
    assert.equal(afterCheck.length, 1, "entrega confirmada não deve gerar escalação nenhuma");

    await api("DELETE", "/push/subscribe", { endpoint });
    await db.delete(treatmentsTable).where(eq(treatmentsTable.id, treatmentId));
  });

  it("dose já registrada não escala, mesmo sem confirmação de entrega", async (t) => {
    if (!process.env.VAPID_PUBLIC_KEY) { t.skip("VAPID_PUBLIC_KEY não configurada neste ambiente"); return; }
    t.mock.method(webpush, "sendNotification", async () => ({ statusCode: 201, body: "", headers: {} }));

    const endpoint = `https://push.test/registered-${Date.now()}`;
    await api("POST", "/push/subscribe", { endpoint, keys: { p256dh: FAKE_P256DH, auth: FAKE_AUTH }, deviceLabel: "Dispositivo" });
    const { doseId, treatmentId } = await createTreatmentWithDose();
    await sendDoseReminder(doseId);
    const [level0] = await db.select().from(notificationsTable).where(eq(notificationsTable.scheduledDoseId, doseId));

    await api("POST", `/patients/${patientId}/dose-records`, { scheduledDoseId: doseId, takenAt: Clock.now().toISOString(), outcome: "taken" });

    await checkDeliveryAndEscalate(level0.id);
    const afterCheck = await db.select().from(notificationsTable).where(eq(notificationsTable.scheduledDoseId, doseId));
    assert.equal(afterCheck.length, 1, "dose já resolvida — nada a escalar, o cuidador já viu de algum jeito");

    await api("DELETE", "/push/subscribe", { endpoint });
    await db.delete(treatmentsTable).where(eq(treatmentsTable.id, treatmentId));
  });
});

describe("'Acted' ao tocar a notificação — ZELO-29", () => {
  it("POST /push/ack com ackedNotificationIds marca ackedAt, sem auth e sem endpoint", async (t) => {
    if (!process.env.VAPID_PUBLIC_KEY) { t.skip("VAPID_PUBLIC_KEY não configurada neste ambiente"); return; }
    t.mock.method(webpush, "sendNotification", async () => ({ statusCode: 201, body: "", headers: {} }));

    const endpoint = `https://push.test/acted-${Date.now()}`;
    await api("POST", "/push/subscribe", { endpoint, keys: { p256dh: FAKE_P256DH, auth: FAKE_AUTH }, deviceLabel: "Dispositivo" });
    const { doseId, treatmentId } = await createTreatmentWithDose();
    await sendDoseReminder(doseId);
    const [notif] = await db.select().from(notificationsTable).where(eq(notificationsTable.scheduledDoseId, doseId));
    assert.equal(notif.ackedAt, null);

    const res = await apiNoAuth("POST", "/push/ack", { ackedNotificationIds: [notif.id] });
    assert.equal(res.status, 204);

    const [acted] = await db.select().from(notificationsTable).where(eq(notificationsTable.id, notif.id));
    assert.ok(acted.ackedAt);

    await api("DELETE", "/push/subscribe", { endpoint });
    await db.delete(treatmentsTable).where(eq(treatmentsTable.id, treatmentId));
  });
});

describe("Taxa de entrega por período — ZELO-29", () => {
  it("GET /push/delivery-stats responde rápido com sent/delivered/rate corretos", async (t) => {
    if (!process.env.VAPID_PUBLIC_KEY) { t.skip("VAPID_PUBLIC_KEY não configurada neste ambiente"); return; }
    t.mock.method(webpush, "sendNotification", async () => ({ statusCode: 201, body: "", headers: {} }));

    const endpoint = `https://push.test/stats-${Date.now()}`;
    await api("POST", "/push/subscribe", { endpoint, keys: { p256dh: FAKE_P256DH, auth: FAKE_AUTH }, deviceLabel: "Dispositivo", platform: "desktop" });
    const { doseId: doseA, treatmentId: treatmentA } = await createTreatmentWithDose();
    await sendDoseReminder(doseA);
    const [notifA] = await db.select().from(notificationsTable).where(eq(notificationsTable.scheduledDoseId, doseA));
    await apiNoAuth("POST", "/push/ack", { endpoint, notificationId: notifA.id }); // esta é confirmada

    const { doseId: doseB, treatmentId: treatmentB } = await createTreatmentWithDose();
    await sendDoseReminder(doseB); // esta fica sem confirmação — simula não entregue

    const start = Date.now();
    const res = await api("GET", "/push/delivery-stats?days=1");
    const elapsedMs = Date.now() - start;

    assert.equal(res.status, 200);
    assert.ok(elapsedMs < 1000, `deveria responder em menos de 1s, levou ${elapsedMs}ms`);
    const stats = res.body as { totalSent: number; totalDelivered: number; deliveryRate: number };
    assert.ok(stats.totalSent >= 2);
    assert.ok(stats.totalDelivered >= 1);
    assert.ok(stats.deliveryRate! > 0 && stats.deliveryRate! <= 1);

    await db.delete(treatmentsTable).where(eq(treatmentsTable.id, treatmentA));
    await db.delete(treatmentsTable).where(eq(treatmentsTable.id, treatmentB));
    await api("DELETE", "/push/subscribe", { endpoint });
  });
});
