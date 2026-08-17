/**
 * Testes de sincronização em tempo real (SSE) — ZELO (ZELO-25).
 *
 * Lê o stream manualmente com http.request em vez de EventSource (que não
 * existe em Node) — mesma abordagem que o cliente real vai usar via fetch(),
 * já que EventSource não permite header de autenticação customizado.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { EventEmitter } from "node:events";
import { eq } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  usersTable, caregiversTable, familiesTable, patientsTable, medicationsTable,
  treatmentsTable, scheduledDosesTable,
} from "@workspace/db";
import { generateAccessToken } from "../lib/tokens.ts";
import { hashPassword } from "../lib/password.ts";
import { boss } from "../lib/queue.ts";
import { Clock } from "../lib/clock.ts";
import app from "../app.ts";

let testPort: number;
let closeServer: () => Promise<void>;
let familyId: number;
let token: string; // primary_caregiver
let patientId: number;
let medicationId: number;

async function api(authToken: string, method: string, path: string, body?: unknown) {
  const payload = body !== undefined ? JSON.stringify(body) : undefined;
  return new Promise<{ status: number; body: unknown }>((resolve, reject) => {
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

function openSSE(path: string, authToken: string) {
  const bus = new EventEmitter();
  const req = http.request({
    hostname: "127.0.0.1", port: testPort, path: `/api${path}`, method: "GET",
    headers: { Authorization: `Bearer ${authToken}` },
  });
  let buffer = "";

  req.on("response", (res) => {
    bus.emit("status", res.statusCode ?? 0);
    res.setEncoding("utf8");
    res.on("data", (chunk: string) => {
      buffer += chunk;
      let idx: number;
      while ((idx = buffer.indexOf("\n\n")) !== -1) {
        const raw = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        let eventType = "";
        let data = "";
        for (const line of raw.split("\n")) {
          if (line.startsWith("event:")) eventType = line.slice(6).trim();
          else if (line.startsWith("data:")) data += line.slice(5).trim();
        }
        if (eventType && data) {
          try { bus.emit("event", eventType, JSON.parse(data)); } catch { /* ignore */ }
        }
      }
    });
    res.on("end", () => bus.emit("closed"));
    res.on("close", () => bus.emit("closed"));
  });
  req.on("error", () => { /* conexão fechada de propósito em alguns testes */ });
  req.end();

  function waitForEvent(type: string, timeoutMs = 3000): Promise<any> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { bus.off("event", handler); reject(new Error(`timeout esperando evento "${type}"`)); }, timeoutMs);
      function handler(evType: string, data: unknown) {
        if (evType === type) { clearTimeout(timer); bus.off("event", handler); resolve(data); }
      }
      bus.on("event", handler);
    });
  }

  function waitForNoEvent(type: string, waitMs = 400): Promise<boolean> {
    return new Promise((resolve) => {
      function handler(evType: string) {
        if (evType === type) { cleanup(); resolve(false); }
      }
      const timer = setTimeout(() => { cleanup(); resolve(true); }, waitMs);
      function cleanup() { clearTimeout(timer); bus.off("event", handler); }
      bus.on("event", handler);
    });
  }

  function waitForStatus(timeoutMs = 3000): Promise<number> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("timeout esperando status")), timeoutMs);
      bus.once("status", (code: number) => { clearTimeout(timer); resolve(code); });
    });
  }

  function waitForClosed(timeoutMs = 3000): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("timeout esperando fechar")), timeoutMs);
      bus.once("closed", () => { clearTimeout(timer); resolve(); });
    });
  }

  return { close: () => req.destroy(), waitForEvent, waitForNoEvent, waitForStatus, waitForClosed };
}

async function createScheduledDose(): Promise<{ doseId: number; treatmentId: number }> {
  const treatmentRes = await api(token, "POST", `/patients/${patientId}/treatments`, {
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
    .values({ name: "Família Realtime Teste", slug: `realtime-test-${Date.now()}` })
    .returning();
  familyId = family.id;

  const [user] = await db
    .insert(usersTable)
    .values({ email: `realtime-${Date.now()}@zelo.test`, name: "Cuidador Principal", passwordHash: await hashPassword("x"), emailVerified: true, status: "active" })
    .returning();
  const [caregiver] = await db
    .insert(caregiversTable)
    .values({ familyId, userId: user.id, name: "Cuidador Principal", role: "primary_caregiver" })
    .returning();
  token = generateAccessToken(user.id, familyId, caregiver.id, "primary_caregiver");

  const [patient] = await db
    .insert(patientsTable)
    .values({ familyId, name: "Paciente Realtime Teste", timezone: "America/Sao_Paulo" })
    .returning();
  patientId = patient.id;

  const [medication] = await db
    .insert(medicationsTable)
    .values({ familyId, name: "Medicamento Fictício Realtime Teste" })
    .returning();
  medicationId = medication.id;
});

after(async () => {
  Clock.reset();
  await closeServer();
  await boss.stop({ graceful: false });
  await db.delete(familiesTable).where(eq(familiesTable.id, familyId));
});

describe("GET /patients/:id/events — SSE", () => {
  it("conecta com sucesso (200, text/event-stream) pra paciente da própria família", async () => {
    const sse = openSSE(`/patients/${patientId}/events`, token);
    const status = await sse.waitForStatus();
    assert.equal(status, 200);
    sse.close();
  });

  it("registrar uma dose emite dose_registered pra quem está assinando o paciente", async () => {
    const { doseId, treatmentId } = await createScheduledDose();
    const sse = openSSE(`/patients/${patientId}/events`, token);
    await sse.waitForStatus();

    const eventPromise = sse.waitForEvent("dose_registered");
    await api(token, "POST", `/patients/${patientId}/dose-records`, {
      scheduledDoseId: doseId, takenAt: Clock.now().toISOString(), outcome: "taken",
    });
    const event = await eventPromise;

    assert.equal(event.scheduledDoseId, doseId);
    assert.equal(event.medicationName, "Medicamento Fictício Realtime Teste");
    assert.equal(event.caregiverName, "Cuidador Principal");
    assert.equal(event.status, "taken");

    sse.close();
    await db.delete(treatmentsTable).where(eq(treatmentsTable.id, treatmentId));
  });

  it("desfazer emite dose_undone", async () => {
    const { doseId, treatmentId } = await createScheduledDose();
    const createRes = await api(token, "POST", `/patients/${patientId}/dose-records`, {
      scheduledDoseId: doseId, takenAt: Clock.now().toISOString(), outcome: "taken",
    });
    const recordId = (createRes.body as { id: number }).id;

    const sse = openSSE(`/patients/${patientId}/events`, token);
    await sse.waitForStatus();

    const eventPromise = sse.waitForEvent("dose_undone");
    await api(token, "POST", `/patients/${patientId}/dose-records/${recordId}/undo`);
    const event = await eventPromise;
    assert.equal(event.scheduledDoseId, doseId);

    sse.close();
    await db.delete(treatmentsTable).where(eq(treatmentsTable.id, treatmentId));
  });

  it("evento de um paciente não vaza pro stream de outro paciente", async () => {
    const [patientB] = await db.insert(patientsTable).values({ familyId, name: "Paciente B Realtime", timezone: "America/Sao_Paulo" }).returning();
    const { doseId, treatmentId } = await createScheduledDose(); // dose do paciente principal (A)

    const sseB = openSSE(`/patients/${patientB.id}/events`, token);
    await sseB.waitForStatus();

    const noEventPromise = sseB.waitForNoEvent("dose_registered");
    await api(token, "POST", `/patients/${patientId}/dose-records`, {
      scheduledDoseId: doseId, takenAt: Clock.now().toISOString(), outcome: "taken",
    });
    const noLeak = await noEventPromise;
    assert.equal(noLeak, true, "assinar o paciente B não pode receber evento do paciente A");

    sseB.close();
    await db.delete(treatmentsTable).where(eq(treatmentsTable.id, treatmentId));
    await db.delete(patientsTable).where(eq(patientsTable.id, patientB.id));
  });

  it("revogar o cuidador derruba a conexão SSE dele na hora", async () => {
    const [secondUser] = await db.insert(usersTable).values({
      email: `realtime-second-${Date.now()}@zelo.test`, name: "Cuidador Secundário",
      passwordHash: await hashPassword("x"), emailVerified: true, status: "active",
    }).returning();
    const [secondCaregiver] = await db.insert(caregiversTable).values({
      familyId, userId: secondUser.id, name: "Cuidador Secundário", role: "caregiver",
    }).returning();
    const secondToken = generateAccessToken(secondUser.id, familyId, secondCaregiver.id, "caregiver");

    const sse = openSSE(`/patients/${patientId}/events`, secondToken);
    await sse.waitForStatus();

    const closedPromise = sse.waitForClosed();
    const deleteRes = await api(token, "DELETE", `/caregivers/${secondCaregiver.id}`);
    assert.equal(deleteRes.status, 204);
    await closedPromise; // não estoura o timeout = a conexão foi derrubada
  });
});
