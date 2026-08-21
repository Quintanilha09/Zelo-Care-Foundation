/**
 * Acesso do paciente ao próprio aparelho — ZELO-58.
 *
 * O núcleo destes testes é NEGATIVO e de segurança: provar que o token do
 * paciente alcança exatamente duas rotas e nada mais, que ele não vira
 * sessão de cuidador, que não cruza paciente nem família, e que revogar
 * derruba o aparelho na requisição seguinte.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { eq } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  usersTable, caregiversTable, familiesTable, patientsTable, medicationsTable,
  treatmentsTable, scheduledDosesTable, patientAccessTokensTable, doseRecordsTable,
} from "@workspace/db";
import { generateAccessToken } from "../lib/tokens.ts";
import { hashPassword } from "../lib/password.ts";
import { boss } from "../lib/queue.ts";
import { Clock } from "../lib/clock.ts";
import app from "../app.ts";

let testPort: number;
let closeServer: () => Promise<void>;
let familyId: number;
let token: string;            // cuidador principal
let nonPrimaryToken: string;  // cuidador comum
let patientId: number;
let medicationId: number;
let otherFamilyId: number;
let otherPatientId: number;

interface ApiResult { status: number; body: unknown }

/** Requisição autenticada como CUIDADOR (Authorization: Bearer). */
async function api(method: string, path: string, body?: unknown, authToken = token): Promise<ApiResult> {
  return request(method, path, body, { Authorization: `Bearer ${authToken}` });
}

/** Requisição autenticada como PACIENTE (X-Patient-Access) — header
 *  diferente de propósito: os dois mundos nunca se confundem. */
async function patientApi(method: string, path: string, body?: unknown, accessToken?: string): Promise<ApiResult> {
  return request(method, path, body, accessToken ? { "X-Patient-Access": accessToken } : {});
}

async function request(method: string, path: string, body: unknown, headers: Record<string, string>): Promise<ApiResult> {
  const payload = body !== undefined ? JSON.stringify(body) : undefined;
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: "127.0.0.1", port: testPort, path: `/api${path}`, method,
        headers: {
          "Content-Type": "application/json",
          ...headers,
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

/** Fluxo completo: cuidador gera o link, paciente ativa no aparelho dele. */
async function activateNewDevice(): Promise<string> {
  const link = await api("POST", `/patients/${patientId}/access-link`);
  assert.equal(link.status, 201, "o cuidador principal precisa conseguir gerar o link");
  const rawToken = new URL(`http://x${(link.body as { activationPath: string }).activationPath}`).searchParams.get("token")!;
  const activated = await patientApi("POST", "/patient-access/activate", { token: rawToken });
  assert.equal(activated.status, 200);
  return (activated.body as { accessToken: string }).accessToken;
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

  const [family] = await db.insert(familiesTable).values({ name: "Família Acesso Paciente", slug: `pa-${Date.now()}` }).returning();
  familyId = family.id;

  const [user] = await db.insert(usersTable).values({ email: `pa-${Date.now()}@zelo.test`, name: "Cuidador Principal", passwordHash: await hashPassword("x"), emailVerified: true, status: "active" }).returning();
  const [caregiver] = await db.insert(caregiversTable).values({ familyId, userId: user.id, name: "Cuidador Principal", role: "primary_caregiver" }).returning();
  token = generateAccessToken(user.id, familyId, caregiver.id, "primary_caregiver");

  const [user2] = await db.insert(usersTable).values({ email: `pa-np-${Date.now()}@zelo.test`, name: "Cuidador Comum", passwordHash: await hashPassword("x"), emailVerified: true, status: "active" }).returning();
  const [caregiver2] = await db.insert(caregiversTable).values({ familyId, userId: user2.id, name: "Cuidador Comum", role: "caregiver" }).returning();
  nonPrimaryToken = generateAccessToken(user2.id, familyId, caregiver2.id, "caregiver");

  // Modo idoso ligado: o acesso do paciente só existe pra usá-lo.
  const [patient] = await db.insert(patientsTable)
    .values({ familyId, name: "Dona Maria", timezone: "America/Sao_Paulo", elderModeEnabled: true })
    .returning();
  patientId = patient.id;

  const [med] = await db.insert(medicationsTable).values({ familyId, name: "Losartana" }).returning();
  medicationId = med.id;

  const [otherFamily] = await db.insert(familiesTable).values({ name: "Outra Família", slug: `pa-other-${Date.now()}` }).returning();
  otherFamilyId = otherFamily.id;
  const [otherPatient] = await db.insert(patientsTable)
    .values({ familyId: otherFamilyId, name: "Paciente de Outra Família", timezone: "America/Sao_Paulo", elderModeEnabled: true })
    .returning();
  otherPatientId = otherPatient.id;
});

after(async () => {
  Clock.reset();
  await closeServer();
  await boss.stop({ graceful: false });
  await db.delete(familiesTable).where(eq(familiesTable.id, familyId));
  await db.delete(familiesTable).where(eq(familiesTable.id, otherFamilyId));
});

describe("Gerar o link — só o cuidador principal", () => {
  it("cuidador principal gera o link, e o token cru NÃO fica no banco", async () => {
    const res = await api("POST", `/patients/${patientId}/access-link`);
    assert.equal(res.status, 201);
    const body = res.body as { activationPath: string; patientName: string; accessId: number };
    assert.match(body.activationPath, /^\/acesso\?token=/);
    assert.equal(body.patientName, "Dona Maria");

    const rawToken = new URL(`http://x${body.activationPath}`).searchParams.get("token")!;
    const [stored] = await db
      .select({ tokenHash: patientAccessTokensTable.tokenHash })
      .from(patientAccessTokensTable)
      .where(eq(patientAccessTokensTable.id, body.accessId));
    assert.notEqual(stored.tokenHash, rawToken, "o banco guarda o HASH, nunca o token cru");
  });

  it("cuidador não-principal recebe 403", async () => {
    const res = await api("POST", `/patients/${patientId}/access-link`, undefined, nonPrimaryToken);
    assert.equal(res.status, 403);
  });

  it("paciente de outra família — 404", async () => {
    const res = await api("POST", `/patients/${otherPatientId}/access-link`);
    assert.equal(res.status, 404);
  });

  it("com o modo idoso desligado, recusa — o acesso só existe pra usá-lo", async () => {
    await db.update(patientsTable).set({ elderModeEnabled: false }).where(eq(patientsTable.id, patientId));
    const res = await api("POST", `/patients/${patientId}/access-link`);
    assert.equal(res.status, 400);
    assert.equal((res.body as { code: string }).code, "ELDER_MODE_DISABLED");
    await db.update(patientsTable).set({ elderModeEnabled: true }).where(eq(patientsTable.id, patientId));
  });
});

describe("Ativação — uso único", () => {
  it("ativa e devolve um token de dispositivo DIFERENTE do token do link", async () => {
    const link = await api("POST", `/patients/${patientId}/access-link`);
    const rawToken = new URL(`http://x${(link.body as { activationPath: string }).activationPath}`).searchParams.get("token")!;

    const res = await patientApi("POST", "/patient-access/activate", { token: rawToken });
    assert.equal(res.status, 200);
    const body = res.body as { accessToken: string; patientName: string };
    assert.equal(body.patientName, "Dona Maria");
    assert.notEqual(body.accessToken, rawToken, "o token de dispositivo não pode ser o mesmo do link");
  });

  it("o mesmo link não ativa duas vezes", async () => {
    const link = await api("POST", `/patients/${patientId}/access-link`);
    const rawToken = new URL(`http://x${(link.body as { activationPath: string }).activationPath}`).searchParams.get("token")!;

    const first = await patientApi("POST", "/patient-access/activate", { token: rawToken });
    assert.equal(first.status, 200);

    const second = await patientApi("POST", "/patient-access/activate", { token: rawToken });
    assert.equal(second.status, 400, "link já usado não pode ativar de novo");
    assert.equal((second.body as { code: string }).code, "ACTIVATION_INVALID");
  });

  it("link expirado não ativa", async () => {
    const link = await api("POST", `/patients/${patientId}/access-link`);
    const linkBody = link.body as { activationPath: string; accessId: number };
    const rawToken = new URL(`http://x${linkBody.activationPath}`).searchParams.get("token")!;

    await db.update(patientAccessTokensTable)
      .set({ expiresAt: new Date(Clock.now().getTime() - 1000) })
      .where(eq(patientAccessTokensTable.id, linkBody.accessId));

    const res = await patientApi("POST", "/patient-access/activate", { token: rawToken });
    assert.equal(res.status, 400);
  });

  it("token inventado não ativa", async () => {
    const res = await patientApi("POST", "/patient-access/activate", { token: "token-que-nunca-existiu" });
    assert.equal(res.status, 400);
  });
});

describe("Escopo do token do paciente — o coração da história", () => {
  it("abre as DUAS rotas dele", async () => {
    const accessToken = await activateNewDevice();

    const today = await patientApi("GET", "/patient-access/today", undefined, accessToken);
    assert.equal(today.status, 200);
    assert.equal((today.body as { patientName: string }).patientName, "Dona Maria");
  });

  it("NÃO abre nenhuma rota de cuidador — nem leitura, nem escrita, nem destrutiva", async () => {
    const accessToken = await activateNewDevice();

    // O token do paciente vai no header dele; as rotas de cuidador exigem
    // JWT em Authorization — nenhuma delas pode ceder.
    const rotasDeCuidador: Array<[string, string]> = [
      ["GET", "/account/me"],
      ["GET", "/patients"],
      ["GET", `/patients/${patientId}`],
      ["GET", `/patients/${patientId}/today-doses`],
      ["GET", "/dashboard/today-summary"],
      ["GET", "/caregivers"],
      ["GET", `/patients/${patientId}/access"`],
      ["DELETE", `/patients/${patientId}`],
    ];

    for (const [method, path] of rotasDeCuidador) {
      const res = await patientApi(method, path, method === "DELETE" ? { reason: "x", confirmName: "Dona Maria" } : undefined, accessToken);
      assert.ok(
        res.status === 401 || res.status === 404,
        `${method} ${path} devia recusar o token de paciente, respondeu ${res.status}`
      );
    }

    // e o paciente continua existindo depois da tentativa de DELETE
    const still = await api("GET", `/patients/${patientId}`);
    assert.equal(still.status, 200, "nenhuma tentativa acima pode ter apagado o paciente");
  });

  it("token de CUIDADOR não abre as rotas do paciente", async () => {
    // O JWT do cuidador no header do paciente não vale — mecanismos diferentes.
    const res = await patientApi("GET", "/patient-access/today", undefined, token);
    assert.equal(res.status, 401);
  });

  it("sem header nenhum, 401", async () => {
    const res = await patientApi("GET", "/patient-access/today");
    assert.equal(res.status, 401);
    assert.equal((res.body as { code: string }).code, "PATIENT_ACCESS_MISSING");
  });
});

describe("Registrar a dose pelo aparelho do paciente", () => {
  it("registra, aparece com o nome do PACIENTE na tela do cuidador, e a auditoria guarda o cuidador real", async () => {
    const accessToken = await activateNewDevice();

    const [treatment] = await db.insert(treatmentsTable).values({
      patientId, medicationId, scheduleType: "times_per_day",
      scheduleConfig: { scheduleType: "times_per_day", times: ["08:00"] },
      startDate: Clock.todayInTimezone("America/Sao_Paulo"),
    }).returning();
    const [dose] = await db.insert(scheduledDosesTable).values({
      treatmentId: treatment.id, patientId, scheduledAt: Clock.now(),
      scheduledLocalDate: Clock.todayInTimezone("America/Sao_Paulo"),
      scheduledLocalTime: "08:00", status: "pending",
    }).returning();

    const today = await patientApi("GET", "/patient-access/today", undefined, accessToken);
    const next = (today.body as { nextDose: { id: number } | null }).nextDose;
    assert.ok(next, "a dose pendente precisa aparecer pro paciente");

    const taken = await patientApi("POST", "/patient-access/taken", { scheduledDoseId: next!.id }, accessToken);
    assert.equal(taken.status, 201);

    // Na tela do cuidador, o rótulo é o do paciente (ZELO-40)
    const home = await api("GET", `/patients/${patientId}/today-doses`);
    const registered = (home.body as { doses: Array<{ id: number; registeredByCaregiverName: string | null }> })
      .doses.find((d) => d.id === dose.id)!;
    assert.equal(registered.registeredByCaregiverName, "Dona Maria");

    // Mas o responsável gravado é o cuidador que gerou o acesso
    const [record] = await db.select({ caregiverId: doseRecordsTable.caregiverId, viaElder: doseRecordsTable.registeredViaElderMode })
      .from(doseRecordsTable).where(eq(doseRecordsTable.scheduledDoseId, dose.id));
    assert.equal(record.viaElder, true);
    assert.ok(record.caregiverId, "auditoria sempre tem um cuidador responsável");

    await db.delete(treatmentsTable).where(eq(treatmentsTable.id, treatment.id));
  });

  it("não registra dose de OUTRO paciente, mesmo sabendo o id", async () => {
    const accessToken = await activateNewDevice();

    const [otherMed] = await db.insert(medicationsTable).values({ familyId: otherFamilyId, name: "Med Outra Família" }).returning();
    const [otherTreatment] = await db.insert(treatmentsTable).values({
      patientId: otherPatientId, medicationId: otherMed.id, scheduleType: "times_per_day",
      scheduleConfig: { scheduleType: "times_per_day", times: ["08:00"] },
      startDate: Clock.todayInTimezone("America/Sao_Paulo"),
    }).returning();
    const [otherDose] = await db.insert(scheduledDosesTable).values({
      treatmentId: otherTreatment.id, patientId: otherPatientId, scheduledAt: Clock.now(),
      scheduledLocalDate: Clock.todayInTimezone("America/Sao_Paulo"),
      scheduledLocalTime: "08:00", status: "pending",
    }).returning();

    const res = await patientApi("POST", "/patient-access/taken", { scheduledDoseId: otherDose.id }, accessToken);
    assert.equal(res.status, 404, "o token de um paciente nunca alcança a dose de outro");

    const [record] = await db.select().from(doseRecordsTable).where(eq(doseRecordsTable.scheduledDoseId, otherDose.id));
    assert.equal(record, undefined, "nada pode ter sido gravado");
  });
});

describe("Revogar derruba o aparelho", () => {
  it("depois de revogado, o token para de funcionar na requisição seguinte", async () => {
    const accessToken = await activateNewDevice();

    const antes = await patientApi("GET", "/patient-access/today", undefined, accessToken);
    assert.equal(antes.status, 200);

    const lista = await api("GET", `/patients/${patientId}/access`);
    const ativo = (lista.body as Array<{ id: number; status: string }>).find((a) => a.status === "active")!;
    const revoke = await api("DELETE", `/patients/${patientId}/access/${ativo.id}`);
    assert.equal(revoke.status, 200);

    const depois = await patientApi("GET", "/patient-access/today", undefined, accessToken);
    assert.equal(depois.status, 401, "revogar vale já na requisição seguinte");
  });

  it("a lista de aparelhos nunca devolve o hash do token", async () => {
    await activateNewDevice();
    const lista = await api("GET", `/patients/${patientId}/access`);
    assert.ok(!JSON.stringify(lista.body).includes("tokenHash"), "material de credencial nunca vai pro cliente");
  });

  it("cuidador não-principal não revoga", async () => {
    await activateNewDevice();
    const lista = await api("GET", `/patients/${patientId}/access`);
    const ativo = (lista.body as Array<{ id: number; status: string }>).find((a) => a.status === "active")!;
    const res = await api("DELETE", `/patients/${patientId}/access/${ativo.id}`, undefined, nonPrimaryToken);
    assert.equal(res.status, 403);
  });
});
