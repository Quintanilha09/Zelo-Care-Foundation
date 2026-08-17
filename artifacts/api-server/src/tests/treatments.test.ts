/**
 * Testes de tratamento — ZELO (ZELO-16).
 *
 * Cobre: os 5 padrões de posologia cadastráveis via API, pré-visualização em
 * linguagem natural das próximas doses, e a garantia central da spec —
 * nenhuma tela sugere, calcula ou valida quantidade de dose.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { eq } from "drizzle-orm";
import { db } from "@workspace/db";
import { usersTable, caregiversTable, familiesTable, patientsTable, medicationsTable, treatmentsTable } from "@workspace/db";
import { generateAccessToken } from "../lib/tokens.ts";
import { hashPassword } from "../lib/password.ts";
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
    .values({ name: "Família Tratamento Teste", slug: `treatments-test-${Date.now()}` })
    .returning();
  familyId = family.id;

  const [user] = await db
    .insert(usersTable)
    .values({ email: `treatments-${Date.now()}@zelo.test`, name: "Cuidador Teste", passwordHash: await hashPassword("x"), emailVerified: true, status: "active" })
    .returning();
  const [caregiver] = await db
    .insert(caregiversTable)
    .values({ familyId, userId: user.id, name: "Cuidador Teste", role: "primary_caregiver" })
    .returning();
  token = generateAccessToken(user.id, familyId, caregiver.id, "primary_caregiver");

  const [patient] = await db
    .insert(patientsTable)
    .values({ familyId, name: "Paciente Teste", timezone: "America/Sao_Paulo" })
    .returning();
  patientId = patient.id;

  const [medication] = await db
    .insert(medicationsTable)
    .values({ familyId, name: "Medicamento Fictício Teste", form: "tablet", strength: "10mg" })
    .returning();
  medicationId = medication.id;
});

after(async () => {
  await closeServer();
  await db.delete(familiesTable).where(eq(familiesTable.id, familyId));
});

describe("Criação de tratamento — os 5 padrões de posologia", () => {
  it("times_per_day — 2 vezes ao dia", async () => {
    const res = await api("POST", `/patients/${patientId}/treatments`, {
      medicationId, dose: "1 comprimido",
      scheduleConfig: { scheduleType: "times_per_day", times: ["08:00", "20:00"] },
      startDate: "2026-01-01",
    });
    assert.equal(res.status, 201);
    const body = res.body as { id: number; scheduleType: string };
    assert.equal(body.scheduleType, "times_per_day");
    await db.delete(treatmentsTable).where(eq(treatmentsTable.id, body.id));
  });

  it("every_n_hours", async () => {
    const res = await api("POST", `/patients/${patientId}/treatments`, {
      medicationId, scheduleConfig: { scheduleType: "every_n_hours", intervalHours: 8, startTime: "08:00" },
      startDate: "2026-01-01",
    });
    assert.equal(res.status, 201);
  });

  it("specific_weekdays", async () => {
    const res = await api("POST", `/patients/${patientId}/treatments`, {
      medicationId, scheduleConfig: { scheduleType: "specific_weekdays", weekdays: [1, 3, 5], times: ["08:00"] },
      startDate: "2026-01-01",
    });
    assert.equal(res.status, 201);
  });

  it("alternate_days", async () => {
    const res = await api("POST", `/patients/${patientId}/treatments`, {
      medicationId, scheduleConfig: { scheduleType: "alternate_days", times: ["08:00"], startDate: "2026-01-01" },
      startDate: "2026-01-01",
    });
    assert.equal(res.status, 201);
  });

  it("cycle_with_pause", async () => {
    const res = await api("POST", `/patients/${patientId}/treatments`, {
      medicationId, scheduleConfig: { scheduleType: "cycle_with_pause", onDays: 21, offDays: 7, times: ["08:00"] },
      startDate: "2026-01-01",
    });
    assert.equal(res.status, 201);
  });

  it("posologia malformada (sem times) é rejeitada com 400", async () => {
    const res = await api("POST", `/patients/${patientId}/treatments`, {
      medicationId, scheduleConfig: { scheduleType: "times_per_day", times: [] },
      startDate: "2026-01-01",
    });
    assert.equal(res.status, 400);
  });
});

describe("Nenhuma sugestão, cálculo ou validação de quantidade de dose", () => {
  it("aceita qualquer texto em dose, mesmo um valor absurdo, sem opinar", async () => {
    const res = await api("POST", `/patients/${patientId}/treatments`, {
      medicationId, dose: "10 comprimidos de uma vez",
      scheduleConfig: { scheduleType: "times_per_day", times: ["08:00"] },
      startDate: "2026-01-01",
    });
    assert.equal(res.status, 201, "o app aceita, nunca valida quantidade — decisão é do médico, não do software");
    const body = res.body as { dose: string; id: number };
    assert.equal(body.dose, "10 comprimidos de uma vez");
    await db.delete(treatmentsTable).where(eq(treatmentsTable.id, body.id));
  });
});

describe("Pré-visualização em linguagem natural", () => {
  it("mostra as próximas 5 doses sem salvar nada no banco", async () => {
    const before = await db.select().from(treatmentsTable).where(eq(treatmentsTable.patientId, patientId));

    const res = await api("POST", `/patients/${patientId}/treatments/preview`, {
      scheduleConfig: { scheduleType: "times_per_day", times: ["08:00", "20:00"] },
      startDate: "2026-01-01",
    });
    assert.equal(res.status, 200);
    const body = res.body as { nextDoses: string[]; inPortuguese: string[] };
    assert.equal(body.nextDoses.length, 5);
    assert.equal(body.inPortuguese.length, 5);
    assert.match(body.inPortuguese[0], /às \d{2}h\d{2}/, "formato deve ser tipo 'segunda às 08h00'");

    const after = await db.select().from(treatmentsTable).where(eq(treatmentsTable.patientId, patientId));
    assert.equal(before.length, after.length, "preview não pode persistir tratamento nenhum");
  });
});

describe("Edição de tratamento", () => {
  it("editar posologia atualiza o scheduleConfig persistido", async () => {
    const created = await api("POST", `/patients/${patientId}/treatments`, {
      medicationId, scheduleConfig: { scheduleType: "times_per_day", times: ["08:00"] },
      startDate: "2026-01-01",
    });
    const { id } = created.body as { id: number };

    const updated = await api("PATCH", `/treatments/${id}`, {
      scheduleConfig: { scheduleType: "times_per_day", times: ["09:00", "21:00"] },
    });
    assert.equal(updated.status, 200);
    const body = updated.body as { scheduleConfig: { times: string[] } };
    assert.deepEqual(body.scheduleConfig.times, ["09:00", "21:00"]);

    await db.delete(treatmentsTable).where(eq(treatmentsTable.id, id));
  });
});
