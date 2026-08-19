/**
 * Testes da tela inicial — ZELO (ZELO-22).
 *
 * Cobre: paciente ativo persistente por cuidador (PATCH /account/selected-patient),
 * e o enriquecimento de GET /patients/:id/today-doses com nome do medicamento,
 * quem registrou, estoque baixo e próxima consulta.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { eq } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  usersTable, caregiversTable, familiesTable, patientsTable, medicationsTable,
  treatmentsTable, stockEntriesTable, appointmentsTable,
} from "@workspace/db";
import { generateAccessToken } from "../lib/tokens.ts";
import { hashPassword } from "../lib/password.ts";
import { boss } from "../lib/queue.ts";
import { Clock } from "../lib/clock.ts";
import app from "../app.ts";

let testPort: number;
let closeServer: () => Promise<void>;
let familyId: number;
let caregiverId: number;
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
    .values({ name: "Família Home Teste", slug: `home-test-${Date.now()}` })
    .returning();
  familyId = family.id;

  const [user] = await db
    .insert(usersTable)
    .values({ email: `home-${Date.now()}@zelo.test`, name: "Cuidador Teste", passwordHash: await hashPassword("x"), emailVerified: true, status: "active" })
    .returning();
  const [caregiver] = await db
    .insert(caregiversTable)
    .values({ familyId, userId: user.id, name: "Cuidador Teste", role: "primary_caregiver" })
    .returning();
  caregiverId = caregiver.id;
  token = generateAccessToken(user.id, familyId, caregiver.id, "primary_caregiver");

  const [patient] = await db
    .insert(patientsTable)
    .values({ familyId, name: "Paciente Home Teste", timezone: "America/Sao_Paulo" })
    .returning();
  patientId = patient.id;

  const [medication] = await db
    .insert(medicationsTable)
    .values({ familyId, name: "Medicamento Fictício Home Teste" })
    .returning();
  medicationId = medication.id;
});

after(async () => {
  Clock.reset();
  await closeServer();
  await boss.stop({ graceful: false });
  await db.delete(familiesTable).where(eq(familiesTable.id, familyId));
});

describe("PATCH /account/selected-patient — paciente ativo persistente", () => {
  it("seleciona um paciente da própria família e persiste", async () => {
    const res = await api("PATCH", "/account/selected-patient", { patientId });
    assert.equal(res.status, 200);
    const body = res.body as { selectedPatientId: number };
    assert.equal(body.selectedPatientId, patientId);

    const meRes = await api("GET", "/account/me");
    const me = meRes.body as { caregiver: { selectedPatientId: number } };
    assert.equal(me.caregiver.selectedPatientId, patientId, "a seleção deve aparecer em /account/me para persistir entre sessões");
  });

  it("rejeita selecionar paciente de outra família", async () => {
    const [otherFamily] = await db.insert(familiesTable).values({ name: "Outra Família", slug: `other-${Date.now()}` }).returning();
    const [otherPatient] = await db.insert(patientsTable).values({ familyId: otherFamily.id, name: "Paciente de Outra Família", timezone: "America/Sao_Paulo" }).returning();

    const res = await api("PATCH", "/account/selected-patient", { patientId: otherPatient.id });
    assert.equal(res.status, 404);

    await db.delete(familiesTable).where(eq(familiesTable.id, otherFamily.id));
  });
});

describe("GET /patients/:id/today-doses — enriquecido para a tela inicial", () => {
  it("inclui nome do medicamento e, após registrar, quem registrou", async () => {
    // Dois horários (bem cedo e bem tarde) garantem que pelo menos um ainda
    // esteja dentro da janela de geração hoje, não importa a hora real em
    // que o teste rodar — mesma pegadinha documentada em dose-generation.test.ts.
    const treatmentRes = await api("POST", `/patients/${patientId}/treatments`, {
      medicationId,
      scheduleConfig: { scheduleType: "times_per_day", times: ["00:01", "23:59"] },
      startDate: Clock.todayInTimezone("America/Sao_Paulo"),
    });
    const treatmentId = (treatmentRes.body as { id: number }).id;

    const homeRes = await api("GET", `/patients/${patientId}/today-doses`);
    const home = homeRes.body as { doses: Array<{ id: number; medicationName: string; registeredByCaregiverName: string | null }> };
    assert.ok(home.doses.length > 0);
    assert.equal(home.doses[0].medicationName, "Medicamento Fictício Home Teste");
    assert.equal(home.doses[0].registeredByCaregiverName, null, "ainda não registrada");

    await api("POST", `/patients/${patientId}/dose-records`, {
      scheduledDoseId: home.doses[0].id, takenAt: Clock.now().toISOString(), outcome: "taken",
    });

    const afterRes = await api("GET", `/patients/${patientId}/today-doses`);
    const after = afterRes.body as { doses: Array<{ id: number; registeredByCaregiverName: string | null }> };
    const registered = after.doses.find((d) => d.id === home.doses[0].id)!;
    assert.equal(registered.registeredByCaregiverName, "Cuidador Teste", "\"✓ Losartana 08:00 — Ana\" — o nome de quem registrou é o diferencial da tela");

    await db.delete(treatmentsTable).where(eq(treatmentsTable.id, treatmentId));
  });

  it("lista estoque baixo quando os dias restantes (pela posologia prescrita) ficam <= 5 — não por quantidade absoluta", async () => {
    // 2 doses/dia (ver lib/stock.ts) — 8 comprimidos dá ~4 dias, abaixo do limite de 5.
    const treatmentRes = await api("POST", `/patients/${patientId}/treatments`, {
      medicationId,
      scheduleConfig: { scheduleType: "times_per_day", times: ["08:00", "20:00"] },
      startDate: Clock.todayInTimezone("America/Sao_Paulo"),
    });
    const treatmentId = (treatmentRes.body as { id: number }).id;

    const [stock] = await db.insert(stockEntriesTable).values({
      patientId, medicationId, quantityRemaining: 8, unit: "comprimidos",
    }).returning();

    const res = await api("GET", `/patients/${patientId}/today-doses`);
    const body = res.body as { lowStockItems: Array<{ medicationName: string; effectiveDaysRemaining: number | null }> };
    const item = body.lowStockItems.find((i) => i.medicationName === "Medicamento Fictício Home Teste");
    assert.ok(item, "8 comprimidos a ~2/dia é bem menos que 5 dias restantes — devia aparecer");
    assert.ok(item!.effectiveDaysRemaining !== null && item!.effectiveDaysRemaining <= 5);

    await db.delete(stockEntriesTable).where(eq(stockEntriesTable.id, stock.id));
    await db.delete(treatmentsTable).where(eq(treatmentsTable.id, treatmentId));
  });

  it("mostra a próxima consulta futura quando existe", async () => {
    const futureDate = new Date(Clock.now().getTime() + 7 * 86_400_000);
    const [appt] = await db.insert(appointmentsTable).values({
      patientId, specialty: "Cardiologia (fictício)", scheduledAt: futureDate, status: "scheduled",
    }).returning();

    const res = await api("GET", `/patients/${patientId}/today-doses`);
    const body = res.body as { nextAppointment: { specialty: string } | null };
    assert.equal(body.nextAppointment?.specialty, "Cardiologia (fictício)");

    await db.delete(appointmentsTable).where(eq(appointmentsTable.id, appt.id));
  });
});
