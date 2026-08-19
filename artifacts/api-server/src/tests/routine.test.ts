/**
 * Testes de rotina e aferições — ZELO (ZELO-37).
 *
 * "Esta é a story onde é mais fácil cruzar a linha do dispositivo médico."
 * O critério de aceite central é negativo — provar que NADA reage ao
 * valor — então o núcleo destes testes registra valores clinicamente
 * extremos (pressão "220/140", glicemia "500", saturação "60") e confirma,
 * de forma concreta (não só por inspeção), que nenhuma notificação nasce
 * disso e que a resposta da API nunca contém um campo de classificação.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  usersTable, caregiversTable, familiesTable, patientsTable,
  healthMeasurementsTable, activitiesTable, notificationsTable,
} from "@workspace/db";
import { generateAccessToken } from "../lib/tokens.ts";
import { hashPassword } from "../lib/password.ts";
import { Clock } from "../lib/clock.ts";
import app from "../app.ts";

let testPort: number;
let closeServer: () => Promise<void>;
let familyId: number;
let token: string;
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

  const [family] = await db.insert(familiesTable).values({ name: "Família Rotina Teste", slug: `routine-test-${Date.now()}` }).returning();
  familyId = family.id;

  const [user] = await db.insert(usersTable).values({ email: `routine-test-${Date.now()}@zelo.test`, name: "Cuidador Rotina", passwordHash: await hashPassword("x"), emailVerified: true, status: "active" }).returning();
  const [caregiver] = await db.insert(caregiversTable).values({ familyId, userId: user.id, name: "Cuidador Rotina", role: "primary_caregiver" }).returning();
  token = generateAccessToken(user.id, familyId, caregiver.id, "primary_caregiver");

  const [patient] = await db.insert(patientsTable).values({ familyId, name: "Paciente Rotina Teste", timezone: "America/Sao_Paulo" }).returning();
  patientId = patient.id;
});

after(async () => {
  Clock.reset();
  await closeServer();
  await db.delete(familiesTable).where(eq(familiesTable.id, familyId));
});

async function cleanup() {
  await db.delete(healthMeasurementsTable).where(eq(healthMeasurementsTable.patientId, patientId));
  await db.delete(activitiesTable).where(eq(activitiesTable.patientId, patientId));
  await db.delete(notificationsTable).where(eq(notificationsTable.familyId, familyId));
}

describe("Aferições — CRUD básico", () => {
  it("registra, lista e remove uma aferição", async () => {
    const create = await api("POST", `/patients/${patientId}/health-measurements`, {
      type: "weight", value: "72.5", unit: "kg", measuredAt: "2026-01-01T10:00:00Z",
    });
    assert.equal(create.status, 201);
    const measurement = create.body as { id: number; value: string };
    assert.equal(measurement.value, "72.5");

    const list = await api("GET", `/patients/${patientId}/health-measurements`);
    assert.equal(list.status, 200);
    assert.equal((list.body as unknown[]).length, 1);

    const del = await api("DELETE", `/patients/${patientId}/health-measurements/${measurement.id}`);
    assert.equal(del.status, 204);
    const listAfter = await api("GET", `/patients/${patientId}/health-measurements`);
    assert.equal((listAfter.body as unknown[]).length, 0);

    await cleanup();
  });

  it("filtra por tipo", async () => {
    await api("POST", `/patients/${patientId}/health-measurements`, { type: "weight", value: "70", measuredAt: "2026-01-01T10:00:00Z" });
    await api("POST", `/patients/${patientId}/health-measurements`, { type: "heart_rate", value: "72", measuredAt: "2026-01-01T10:00:00Z" });

    const res = await api("GET", `/patients/${patientId}/health-measurements?type=weight`);
    const rows = res.body as Array<{ type: string }>;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].type, "weight");

    await cleanup();
  });
});

describe("Nenhuma interpretação clínica — critério de aceite central", () => {
  it("valores extremos (pressão 220/140, glicemia 500, saturação 60) não geram NENHUMA notificação", async () => {
    const extremeValues: Array<{ type: string; value: string; unit: string }> = [
      { type: "blood_pressure", value: "220/140", unit: "mmHg" },
      { type: "blood_glucose", value: "500", unit: "mg/dL" },
      { type: "oxygen_saturation", value: "60", unit: "%" },
      { type: "heart_rate", value: "220", unit: "bpm" },
      { type: "temperature", value: "42", unit: "°C" },
    ];

    for (const v of extremeValues) {
      const res = await api("POST", `/patients/${patientId}/health-measurements`, {
        type: v.type, value: v.value, unit: v.unit, measuredAt: "2026-01-01T10:00:00Z",
      });
      assert.equal(res.status, 201, `deveria aceitar ${v.type}=${v.value} sem rejeitar por "valor perigoso" — o app nunca julga o valor`);
    }

    const notifs = await db.select().from(notificationsTable).where(eq(notificationsTable.familyId, familyId));
    assert.equal(notifs.length, 0, "nenhum valor, por mais extremo que seja, pode gerar notificação — o app registra, nunca avalia");

    await cleanup();
  });

  it("a resposta da API nunca inclui campo de classificação/risco/interpretação", async () => {
    const res = await api("POST", `/patients/${patientId}/health-measurements`, {
      type: "blood_pressure", value: "220/140", unit: "mmHg", measuredAt: "2026-01-01T10:00:00Z",
    });
    const body = res.body as Record<string, unknown>;
    const forbiddenFields = ["status", "risk", "classification", "alert", "level", "severity", "interpretation"];
    for (const field of forbiddenFields) {
      assert.equal(body[field], undefined, `resposta não pode ter o campo "${field}" — só value/unit/measuredAt/notes, nada calculado`);
    }
    // value é sempre string bruta — nunca convertida/normalizada como número
    assert.equal(typeof body.value, "string");
    assert.equal(body.value, "220/140");

    await cleanup();
  });

  it("varredura de linguagem: RoutinePage.tsx nunca classifica, alerta ou opina sobre um valor aferido", () => {
    const path = fileURLToPath(new URL("../../../zelo/src/pages/RoutinePage.tsx", import.meta.url));
    const source = readFileSync(path, "utf-8").toLowerCase();
    const forbidden = [
      "pressão alta", "pressão baixa", "glicemia alta", "glicemia baixa",
      "procure um médico", "fora do normal", "valor anormal", "atenção:",
      "recomendamos", "sugerimos", "risco de", "faixa de referência", "nível perigoso",
    ];
    for (const phrase of forbidden) {
      assert.ok(!source.includes(phrase), `RoutinePage.tsx não pode conter "${phrase}" — a tela registra, nunca interpreta`);
    }
  });
});

describe("Atividades — CRUD básico", () => {
  it("registra feito e não-feito sem nenhuma consequência diferente", async () => {
    const done = await api("POST", `/patients/${patientId}/activities`, { type: "walk", done: true, occurredAt: "2026-01-01T10:00:00Z" });
    const notDone = await api("POST", `/patients/${patientId}/activities`, { type: "bath", done: false, occurredAt: "2026-01-01T11:00:00Z" });
    assert.equal(done.status, 201);
    assert.equal(notDone.status, 201);

    const notifs = await db.select().from(notificationsTable).where(eq(notificationsTable.familyId, familyId));
    assert.equal(notifs.length, 0, "'não feito' é só o retrato do dia, não deveria disparar nada — nem cobrança, nem alerta");

    const list = await api("GET", `/patients/${patientId}/activities`);
    assert.equal((list.body as unknown[]).length, 2);

    const activityId = (done.body as { id: number }).id;
    const del = await api("DELETE", `/patients/${patientId}/activities/${activityId}`);
    assert.equal(del.status, 204);

    await cleanup();
  });
});

describe("Contato de emergência — encaminha, nunca avalia", () => {
  it("cadastra e lê o contato de emergência no paciente", async () => {
    const patch = await api("PATCH", `/patients/${patientId}`, {
      emergencyContactName: "Dra. Fulana", emergencyContactPhone: "11999998888",
    });
    assert.equal(patch.status, 200);

    const get = await api("GET", `/patients/${patientId}`);
    const patient = get.body as { emergencyContactName: string; emergencyContactPhone: string };
    assert.equal(patient.emergencyContactName, "Dra. Fulana");
    assert.equal(patient.emergencyContactPhone, "11999998888");
  });
});

describe("Isolamento entre famílias", () => {
  it("família B não vê, cria nem remove aferição/atividade de paciente de A", async () => {
    const create = await api("POST", `/patients/${patientId}/health-measurements`, {
      type: "weight", value: "70", measuredAt: "2026-01-01T10:00:00Z",
    });
    const measurementId = (create.body as { id: number }).id;

    const [familyB] = await db.insert(familiesTable).values({ name: "Família B Rotina", slug: `routine-b-${Date.now()}` }).returning();
    const [userB] = await db.insert(usersTable).values({ email: `routine-b-${Date.now()}@zelo.test`, name: "Cuidador B", passwordHash: await hashPassword("x"), emailVerified: true, status: "active" }).returning();
    const [caregiverB] = await db.insert(caregiversTable).values({ familyId: familyB.id, userId: userB.id, name: "Cuidador B", role: "primary_caregiver" }).returning();
    const tokenB = generateAccessToken(userB.id, familyB.id, caregiverB.id, "primary_caregiver");

    assert.equal((await api("GET", `/patients/${patientId}/health-measurements`, undefined, tokenB)).status, 404);
    assert.equal((await api("POST", `/patients/${patientId}/health-measurements`, { type: "weight", value: "1", measuredAt: "2026-01-01T10:00:00Z" }, tokenB)).status, 404);
    assert.equal((await api("DELETE", `/patients/${patientId}/health-measurements/${measurementId}`, undefined, tokenB)).status, 404);
    assert.equal((await api("GET", `/patients/${patientId}/activities`, undefined, tokenB)).status, 404);
    assert.equal((await api("POST", `/patients/${patientId}/activities`, { type: "walk", occurredAt: "2026-01-01T10:00:00Z" }, tokenB)).status, 404);

    await db.delete(familiesTable).where(eq(familiesTable.id, familyB.id));
    await cleanup();
  });
});
