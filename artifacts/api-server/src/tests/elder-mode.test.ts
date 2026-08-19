/**
 * Testes do modo idoso — ZELO (ZELO-40).
 *
 * Dois focos: (1) só o cuidador principal liga/desliga a permissão, com
 * isolamento normal entre famílias; (2) uma dose registrada com
 * viaElderMode:true aparece, na tela inicial (today-doses), atribuída ao
 * PRÓPRIO PACIENTE ("✓ 08:00 — Dona Maria") — mas o caregiverId real (quem
 * de fato estava logado no aparelho) continua intacto no banco e é o que
 * aparece em GET /dose-records, que é auditoria, não a vitrine do dia.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { eq } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  usersTable, caregiversTable, familiesTable, patientsTable, medicationsTable, treatmentsTable,
} from "@workspace/db";
import { generateAccessToken } from "../lib/tokens.ts";
import { hashPassword } from "../lib/password.ts";
import { boss } from "../lib/queue.ts";
import { Clock } from "../lib/clock.ts";
import app from "../app.ts";

let testPort: number;
let closeServer: () => Promise<void>;
let familyId: number;
let token: string; // cuidador principal
let nonPrimaryToken: string; // cuidador comum, sem permissão de ligar/desligar
let patientId: number;
let medicationId: number;
let otherFamilyId: number;
let otherPatientId: number;

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

  const [family] = await db.insert(familiesTable).values({ name: "Família Modo Idoso Teste", slug: `elder-mode-test-${Date.now()}` }).returning();
  familyId = family.id;

  const [user] = await db.insert(usersTable).values({ email: `elder-mode-${Date.now()}@zelo.test`, name: "Cuidador Principal", passwordHash: await hashPassword("x"), emailVerified: true, status: "active" }).returning();
  const [caregiver] = await db.insert(caregiversTable).values({ familyId, userId: user.id, name: "Cuidador Principal", role: "primary_caregiver" }).returning();
  token = generateAccessToken(user.id, familyId, caregiver.id, "primary_caregiver");

  const [otherUser] = await db.insert(usersTable).values({ email: `elder-mode-nonprimary-${Date.now()}@zelo.test`, name: "Cuidador Comum", passwordHash: await hashPassword("x"), emailVerified: true, status: "active" }).returning();
  const [nonPrimaryCaregiver] = await db.insert(caregiversTable).values({ familyId, userId: otherUser.id, name: "Cuidador Comum", role: "caregiver" }).returning();
  nonPrimaryToken = generateAccessToken(otherUser.id, familyId, nonPrimaryCaregiver.id, "caregiver");

  const [patient] = await db.insert(patientsTable).values({ familyId, name: "Dona Maria", timezone: "America/Sao_Paulo" }).returning();
  patientId = patient.id;

  const [medication] = await db.insert(medicationsTable).values({ familyId, name: "Losartana" }).returning();
  medicationId = medication.id;

  const [otherFamily] = await db.insert(familiesTable).values({ name: "Outra Família", slug: `elder-mode-other-${Date.now()}` }).returning();
  otherFamilyId = otherFamily.id;
  const [otherPatient] = await db.insert(patientsTable).values({ familyId: otherFamilyId, name: "Paciente de Outra Família", timezone: "America/Sao_Paulo" }).returning();
  otherPatientId = otherPatient.id;
});

after(async () => {
  Clock.reset();
  await closeServer();
  await boss.stop({ graceful: false });
  await db.delete(familiesTable).where(eq(familiesTable.id, familyId));
  await db.delete(familiesTable).where(eq(familiesTable.id, otherFamilyId));
});

describe("PATCH /patients/:id/elder-mode — liga/desliga (só cuidador principal)", () => {
  it("cuidador principal ativa, e a mudança aparece em GET /patients/:id e em today-doses", async () => {
    const patch = await api("PATCH", `/patients/${patientId}/elder-mode`, { enabled: true });
    assert.equal(patch.status, 200);
    assert.equal((patch.body as { elderModeEnabled: boolean }).elderModeEnabled, true);

    const getPatient = await api("GET", `/patients/${patientId}`);
    assert.equal((getPatient.body as { elderModeEnabled: boolean }).elderModeEnabled, true);

    const home = await api("GET", `/patients/${patientId}/today-doses`);
    assert.equal((home.body as { elderModeEnabled: boolean }).elderModeEnabled, true);

    // desliga de novo — não deve sobrar ligado para os testes seguintes
    const off = await api("PATCH", `/patients/${patientId}/elder-mode`, { enabled: false });
    assert.equal((off.body as { elderModeEnabled: boolean }).elderModeEnabled, false);
  });

  it("cuidador não-principal recebe 403 — só quem é principal decide isso", async () => {
    const res = await api("PATCH", `/patients/${patientId}/elder-mode`, { enabled: true }, nonPrimaryToken);
    assert.equal(res.status, 403);

    // confirma que realmente não mudou nada
    const getPatient = await api("GET", `/patients/${patientId}`);
    assert.equal((getPatient.body as { elderModeEnabled: boolean }).elderModeEnabled, false);
  });

  it("paciente de outra família — 404, nunca vaza nem deixa ligar por engano", async () => {
    const res = await api("PATCH", `/patients/${otherPatientId}/elder-mode`, { enabled: true });
    assert.equal(res.status, 404);
  });
});

describe("Registro de dose via modo idoso — atribuição na tela inicial", () => {
  it("dose registrada com viaElderMode aparece com o nome do PACIENTE em today-doses, mas o cuidador real continua em dose-records", async () => {
    // Dois horários bem separados garantem que ao menos um esteja pendente
    // agora, não importa a hora real em que o teste rodar — mesma técnica
    // usada em home.test.ts / dose-generation.test.ts.
    const treatmentRes = await api("POST", `/patients/${patientId}/treatments`, {
      medicationId,
      scheduleConfig: { scheduleType: "times_per_day", times: ["00:01", "23:59"] },
      startDate: Clock.todayInTimezone("America/Sao_Paulo"),
    });
    const treatmentId = (treatmentRes.body as { id: number }).id;

    const before = await api("GET", `/patients/${patientId}/today-doses`);
    const beforeBody = before.body as { doses: Array<{ id: number; status: string }> };
    const pending = beforeBody.doses.find((d) => d.status === "pending");
    assert.ok(pending, "precisa haver ao menos uma dose pendente pra registrar");

    const register = await api("POST", `/patients/${patientId}/dose-records`, {
      scheduledDoseId: pending!.id,
      takenAt: Clock.now().toISOString(),
      outcome: "taken",
      viaElderMode: true,
    });
    assert.equal(register.status, 201);

    const after = await api("GET", `/patients/${patientId}/today-doses`);
    const afterBody = after.body as { doses: Array<{ id: number; registeredByCaregiverName: string | null }> };
    const registered = afterBody.doses.find((d) => d.id === pending!.id)!;
    assert.equal(
      registered.registeredByCaregiverName,
      "Dona Maria",
      "\"✓ 08:00 — Dona Maria\" — na tela inicial, quem aparece é o paciente, não o cuidador logado no aparelho"
    );

    // Auditoria: GET /dose-records continua mostrando o cuidador REAL — o
    // modo idoso muda só o rótulo da vitrine do dia, nunca quem de fato
    // registrou por trás (caregiverId intacto no banco).
    const records = await api("GET", `/patients/${patientId}/dose-records`);
    const recordsBody = records.body as Array<{ scheduledDoseId: number; caregiverName: string }>;
    const record = recordsBody.find((r) => r.scheduledDoseId === pending!.id)!;
    assert.equal(record.caregiverName, "Cuidador Principal");

    await db.delete(treatmentsTable).where(eq(treatmentsTable.id, treatmentId));
  });

  it("registro normal (sem viaElderMode) continua mostrando o nome do cuidador, não do paciente", async () => {
    const treatmentRes = await api("POST", `/patients/${patientId}/treatments`, {
      medicationId,
      scheduleConfig: { scheduleType: "times_per_day", times: ["00:02", "23:58"] },
      startDate: Clock.todayInTimezone("America/Sao_Paulo"),
    });
    const treatmentId = (treatmentRes.body as { id: number }).id;

    const before = await api("GET", `/patients/${patientId}/today-doses`);
    const beforeBody = before.body as { doses: Array<{ id: number; status: string }> };
    const pending = beforeBody.doses.find((d) => d.status === "pending");
    assert.ok(pending);

    await api("POST", `/patients/${patientId}/dose-records`, {
      scheduledDoseId: pending!.id,
      takenAt: Clock.now().toISOString(),
      outcome: "taken",
    });

    const after = await api("GET", `/patients/${patientId}/today-doses`);
    const afterBody = after.body as { doses: Array<{ id: number; registeredByCaregiverName: string | null }> };
    const registered = afterBody.doses.find((d) => d.id === pending!.id)!;
    assert.equal(registered.registeredByCaregiverName, "Cuidador Principal");

    await db.delete(treatmentsTable).where(eq(treatmentsTable.id, treatmentId));
  });
});
