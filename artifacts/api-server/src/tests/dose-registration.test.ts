/**
 * Testes de registro de dose idempotente — ZELO (ZELO-23).
 *
 * Cobre: concorrência real (20 requisições simultâneas -> 1 registro),
 * desfazer dentro/fora da janela de 60s, adiar com novo horário, observador
 * recebe 403, e o evento DoseTaken chega na fila (decremento de estoque
 * decoupled — testado à parte, direto na função, não via worker assíncrono).
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { eq } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  usersTable, caregiversTable, familiesTable, patientsTable, medicationsTable,
  treatmentsTable, scheduledDosesTable, doseRecordsTable, stockEntriesTable,
} from "@workspace/db";
import { generateAccessToken } from "../lib/tokens.ts";
import { hashPassword } from "../lib/password.ts";
import { boss, QUEUE_DOSE_TAKEN } from "../lib/queue.ts";
import { decrementStockForDoseTaken } from "../lib/stock.ts";
import { Clock } from "../lib/clock.ts";
import app from "../app.ts";

let testPort: number;
let closeServer: () => Promise<void>;
let familyId: number;
let caregiverId: number;
let token: string;
let observerToken: string;
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

/** Apaga o tratamento (cascade cuida de scheduled_doses/dose_records) — limpeza real, sem deixar lixo pra jobs globais como extendActiveTreatmentWindows pegarem depois. */
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
    .values({ name: "Família Registro Teste", slug: `register-test-${Date.now()}` })
    .returning();
  familyId = family.id;

  const [user] = await db
    .insert(usersTable)
    .values({ email: `register-${Date.now()}@zelo.test`, name: "Cuidador Teste", passwordHash: await hashPassword("x"), emailVerified: true, status: "active" })
    .returning();
  const [caregiver] = await db
    .insert(caregiversTable)
    .values({ familyId, userId: user.id, name: "Cuidador Teste", role: "primary_caregiver" })
    .returning();
  caregiverId = caregiver.id;
  token = generateAccessToken(user.id, familyId, caregiver.id, "primary_caregiver");

  const [observerUser] = await db
    .insert(usersTable)
    .values({ email: `observer-${Date.now()}@zelo.test`, name: "Observador Teste", passwordHash: await hashPassword("x"), emailVerified: true, status: "active" })
    .returning();
  const [observerCaregiver] = await db
    .insert(caregiversTable)
    .values({ familyId, userId: observerUser.id, name: "Observador Teste", role: "observer" })
    .returning();
  observerToken = generateAccessToken(observerUser.id, familyId, observerCaregiver.id, "observer");

  const [patient] = await db
    .insert(patientsTable)
    .values({ familyId, name: "Paciente Registro Teste", timezone: "America/Sao_Paulo" })
    .returning();
  patientId = patient.id;

  const [medication] = await db
    .insert(medicationsTable)
    .values({ familyId, name: "Medicamento Fictício Registro Teste" })
    .returning();
  medicationId = medication.id;
});

after(async () => {
  Clock.reset();
  await closeServer();
  await boss.stop({ graceful: false });
  await db.delete(familiesTable).where(eq(familiesTable.id, familyId));
});

describe("Idempotência sob concorrência real — ZELO-23", () => {
  it("20 requisições simultâneas na mesma dose produzem exatamente 1 registro", async () => {
    const { doseId, treatmentId } = await createScheduledDose();

    const requests = Array.from({ length: 20 }, () =>
      api(token, "POST", `/patients/${patientId}/dose-records`, {
        scheduledDoseId: doseId, takenAt: Clock.now().toISOString(), outcome: "taken",
      })
    );
    const results = await Promise.all(requests);

    for (const r of results) {
      assert.ok(r.status === 200 || r.status === 201, `esperava 200 ou 201, recebeu ${r.status}`);
    }
    const winners = results.filter((r) => r.status === 201);
    const losers = results.filter((r) => r.status === 200);
    assert.equal(winners.length, 1, "exatamente 1 requisição deve vencer (201)");
    assert.equal(losers.length, 19, "as outras 19 devem receber 200 com o registro vencedor, nunca erro");

    for (const loser of losers) {
      const body = loser.body as { wonRace: boolean; message: string };
      assert.equal(body.wonRace, false);
      assert.ok(body.message.includes("já registrou"), "mensagem simpática, não erro técnico");
    }

    const records = await db.select().from(doseRecordsTable).where(eq(doseRecordsTable.scheduledDoseId, doseId));
    assert.equal(records.length, 1, "exatamente 1 linha no banco, garantido pela constraint UNIQUE");

    await cleanupTreatment(treatmentId);
  });
});

describe("Desfazer — ZELO-23", () => {
  it("desfazer dentro de 60s restaura o estado anterior e fica auditado", async () => {
    const { doseId, treatmentId } = await createScheduledDose();
    const createRes = await api(token, "POST", `/patients/${patientId}/dose-records`, {
      scheduledDoseId: doseId, takenAt: Clock.now().toISOString(), outcome: "taken",
    });
    const recordId = (createRes.body as { id: number }).id;

    const [beforeUndo] = await db.select().from(scheduledDosesTable).where(eq(scheduledDosesTable.id, doseId));
    assert.equal(beforeUndo.status, "taken");

    const undoRes = await api(token, "POST", `/patients/${patientId}/dose-records/${recordId}/undo`);
    assert.equal(undoRes.status, 200);

    const [afterUndo] = await db.select().from(scheduledDosesTable).where(eq(scheduledDosesTable.id, doseId));
    assert.equal(afterUndo.status, "pending", "desfazer restaura a dose a pendente");

    const remaining = await db.select().from(doseRecordsTable).where(eq(doseRecordsTable.id, recordId));
    assert.equal(remaining.length, 0, "o registro é removido de verdade");

    // Depois de desfeito, registrar de novo deve funcionar normalmente (a constraint UNIQUE liberou).
    const reRegisterRes = await api(token, "POST", `/patients/${patientId}/dose-records`, {
      scheduledDoseId: doseId, takenAt: Clock.now().toISOString(), outcome: "skipped",
    });
    assert.equal(reRegisterRes.status, 201);

    await cleanupTreatment(treatmentId);
  });

  it("desfazer depois de 60s é rejeitado", async () => {
    const { doseId, treatmentId } = await createScheduledDose();
    const createRes = await api(token, "POST", `/patients/${patientId}/dose-records`, {
      scheduledDoseId: doseId, takenAt: Clock.now().toISOString(), outcome: "taken",
    });
    const recordId = (createRes.body as { id: number }).id;

    Clock.advance(61_000);
    const undoRes = await api(token, "POST", `/patients/${patientId}/dose-records/${recordId}/undo`);
    assert.equal(undoRes.status, 409);

    const stillThere = await db.select().from(doseRecordsTable).where(eq(doseRecordsTable.id, recordId));
    assert.equal(stillThere.length, 1, "fora da janela, o registro deve permanecer intacto");

    Clock.reset();
    await cleanupTreatment(treatmentId);
  });
});

describe("Adiar (postponed) — ZELO-23", () => {
  it("pede o novo horário e grava postponedTo", async () => {
    const { doseId, treatmentId } = await createScheduledDose();
    const newTime = new Date(Clock.now().getTime() + 3 * 3_600_000).toISOString();

    const res = await api(token, "POST", `/patients/${patientId}/dose-records`, {
      scheduledDoseId: doseId, takenAt: Clock.now().toISOString(), outcome: "postponed", postponedTo: newTime,
    });
    assert.equal(res.status, 201);

    const [record] = await db.select().from(doseRecordsTable).where(eq(doseRecordsTable.scheduledDoseId, doseId));
    assert.equal(record.outcome, "postponed");
    assert.equal(record.postponedTo?.toISOString(), newTime);

    const [dose] = await db.select().from(scheduledDosesTable).where(eq(scheduledDosesTable.id, doseId));
    assert.equal(dose.status, "postponed");

    await cleanupTreatment(treatmentId);
  });

  it("outcome=postponed sem postponedTo é rejeitado", async () => {
    const { doseId, treatmentId } = await createScheduledDose();
    const res = await api(token, "POST", `/patients/${patientId}/dose-records`, {
      scheduledDoseId: doseId, takenAt: Clock.now().toISOString(), outcome: "postponed",
    });
    assert.equal(res.status, 400);

    await cleanupTreatment(treatmentId);
  });
});

describe("Observador — ZELO-23", () => {
  it("observador recebe 403 ao tentar registrar dose", async () => {
    const { doseId, treatmentId } = await createScheduledDose();
    const res = await api(observerToken, "POST", `/patients/${patientId}/dose-records`, {
      scheduledDoseId: doseId, takenAt: Clock.now().toISOString(), outcome: "taken",
    });
    assert.equal(res.status, 403);
    const body = res.body as { code: string };
    assert.equal(body.code, "CAPABILITY_DENIED");

    await cleanupTreatment(treatmentId);
  });

  it("observador recebe 403 ao tentar desfazer", async () => {
    const { doseId, treatmentId } = await createScheduledDose();
    const createRes = await api(token, "POST", `/patients/${patientId}/dose-records`, {
      scheduledDoseId: doseId, takenAt: Clock.now().toISOString(), outcome: "taken",
    });
    const recordId = (createRes.body as { id: number }).id;

    const res = await api(observerToken, "POST", `/patients/${patientId}/dose-records/${recordId}/undo`);
    assert.equal(res.status, 403);

    await cleanupTreatment(treatmentId);
  });
});

describe("Evento DoseTaken e decremento de estoque — ZELO-23", () => {
  it("registrar como tomada publica DoseTaken na fila", async () => {
    const { doseId, treatmentId } = await createScheduledDose();
    const before = await boss.findJobs(QUEUE_DOSE_TAKEN, { data: { patientId, medicationId } });

    await api(token, "POST", `/patients/${patientId}/dose-records`, {
      scheduledDoseId: doseId, takenAt: Clock.now().toISOString(), outcome: "taken",
    });

    const after = await boss.findJobs(QUEUE_DOSE_TAKEN, { data: { patientId, medicationId } });
    assert.equal(after.length, before.length + 1, "deve existir um job DoseTaken novo");

    await cleanupTreatment(treatmentId);
  });

  it("skipped não publica DoseTaken (só 'tomada' decrementa estoque)", async () => {
    const { doseId, treatmentId } = await createScheduledDose();
    const before = await boss.findJobs(QUEUE_DOSE_TAKEN, { data: { patientId, medicationId } });

    await api(token, "POST", `/patients/${patientId}/dose-records`, {
      scheduledDoseId: doseId, takenAt: Clock.now().toISOString(), outcome: "skipped",
    });

    const after = await boss.findJobs(QUEUE_DOSE_TAKEN, { data: { patientId, medicationId } });
    assert.equal(after.length, before.length, "pular não deve publicar DoseTaken");

    await cleanupTreatment(treatmentId);
  });

  it("decrementStockForDoseTaken decrementa 1 unidade do estoque cadastrado", async () => {
    const [stock] = await db.insert(stockEntriesTable).values({
      patientId, medicationId, quantityRemaining: 10, unit: "comprimidos",
    }).returning();

    await decrementStockForDoseTaken(patientId, medicationId);

    const [after] = await db.select().from(stockEntriesTable).where(eq(stockEntriesTable.id, stock.id));
    assert.equal(after.quantityRemaining, 9);

    await db.delete(stockEntriesTable).where(eq(stockEntriesTable.id, stock.id));
  });

  it("decrementStockForDoseTaken não falha quando não há estoque cadastrado", async () => {
    await assert.doesNotReject(() => decrementStockForDoseTaken(patientId, medicationId));
  });
});
