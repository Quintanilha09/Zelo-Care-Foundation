/**
 * Testes de limites de plano e paywall — ZELO (ZELO-38).
 *
 * "O paywall é social, não funcional" — o núcleo destes testes prova que
 * o limite é aplicado NO SERVIDOR (via API direta, "ignorando a
 * interface", como pede o critério de aceite), e que downgrade nunca
 * apaga dado — só torna o excedente somente-leitura.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { eq } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  usersTable, caregiversTable, familiesTable, patientsTable, medicationsTable,
  subscriptionsTable, caregiverInvitesTable, stockEntriesTable, treatmentsTable,
  scheduledDosesTable, appointmentsTable,
} from "@workspace/db";
import { generateAccessToken } from "../lib/tokens.ts";
import { hashPassword } from "../lib/password.ts";
import { Clock } from "../lib/clock.ts";
import { boss } from "../lib/queue.ts";
import app from "../app.ts";

let testPort: number;
let closeServer: () => Promise<void>;
let familyId: number;
let token: string;

async function api(method: string, path: string, body?: unknown): Promise<{ status: number; body: unknown }> {
  const payload = body !== undefined ? JSON.stringify(body) : undefined;
  return new Promise((resolve, reject) => {
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

async function setPlan(plan: "free" | "basic" | "premium" | null) {
  await db.delete(subscriptionsTable).where(eq(subscriptionsTable.familyId, familyId));
  if (plan) await db.insert(subscriptionsTable).values({ familyId, plan, status: "active" });
}

async function createPatient(name: string): Promise<{ status: number; body: unknown }> {
  return api("POST", "/patients", { name, timezone: "America/Sao_Paulo", healthConsent: { givenBy: "self", version: "v1" } });
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

  const [family] = await db.insert(familiesTable).values({ name: "Família Plano Teste", slug: `plan-test-${Date.now()}` }).returning();
  familyId = family.id;

  const [user] = await db.insert(usersTable).values({ email: `plan-test-${Date.now()}@zelo.test`, name: "Cuidador Plano", passwordHash: await hashPassword("x"), emailVerified: true, status: "active" }).returning();
  const [caregiver] = await db.insert(caregiversTable).values({ familyId, userId: user.id, name: "Cuidador Plano", role: "primary_caregiver" }).returning();
  token = generateAccessToken(user.id, familyId, caregiver.id, "primary_caregiver");
});

after(async () => {
  Clock.reset();
  await closeServer();
  await boss.stop({ graceful: false }); // criar tratamento/consulta liga o pg-boss por baixo
  await db.delete(familiesTable).where(eq(familiesTable.id, familyId));
});

async function cleanupPatients() {
  await db.delete(patientsTable).where(eq(patientsTable.familyId, familyId));
}
async function cleanupMedications() {
  await db.delete(medicationsTable).where(eq(medicationsTable.familyId, familyId));
}
async function cleanupInvites() {
  await db.delete(caregiverInvitesTable).where(eq(caregiverInvitesTable.familyId, familyId));
}

describe("Limite de pacientes", () => {
  it("gratuito bloqueia o 2º paciente; plano Família permite até 5", async () => {
    await setPlan(null); // sem linha = gratuito
    const first = await createPatient("Paciente 1");
    assert.equal(first.status, 201);

    const second = await createPatient("Paciente 2");
    assert.equal(second.status, 403);
    assert.equal((second.body as { code: string }).code, "PLAN_LIMIT");

    await setPlan("premium");
    const withPlan = await createPatient("Paciente 2 de novo");
    assert.equal(withPlan.status, 201);

    await cleanupPatients();
  });

  it("reativar um paciente arquivado também conta pro limite", async () => {
    await setPlan(null);
    const p1 = await createPatient("Paciente Arquivável");
    const patientId = (p1.body as { id: number }).id;
    await api("POST", `/patients/${patientId}/archive`, { archived: true });

    // com o único paciente arquivado, cadastrar um novo funciona (0 ativos)
    const p2 = await createPatient("Paciente Novo");
    assert.equal(p2.status, 201);

    // agora reativar o primeiro deveria bloquear (já tem 1 ativo)
    const reactivate = await api("POST", `/patients/${patientId}/archive`, { archived: false });
    assert.equal(reactivate.status, 403);

    await cleanupPatients();
  });
});

describe("Limite de cuidadores — o momento do paywall", () => {
  it("convidar o 2º cuidador no gratuito não cria o convite", async () => {
    await setPlan(null);
    const res = await api("POST", "/invites", { role: "caregiver" });
    assert.equal(res.status, 403);
    assert.equal((res.body as { code: string }).code, "PLAN_LIMIT");

    const invites = await db.select().from(caregiverInvitesTable).where(eq(caregiverInvitesTable.familyId, familyId));
    assert.equal(invites.length, 0, "nenhum convite deveria ter sido criado — nem um pendente");

    await setPlan("premium");
    const withPlan = await api("POST", "/invites", { role: "caregiver" });
    assert.equal(withPlan.status, 201);

    await cleanupInvites();
    await setPlan(null);
  });
});

describe("Limite de medicamentos", () => {
  it("gratuito bloqueia o 4º medicamento", async () => {
    await setPlan(null);
    for (let i = 1; i <= 3; i++) {
      const res = await api("POST", "/medications", { name: `Medicamento ${i}` });
      assert.equal(res.status, 201, `medicamento ${i} deveria ser aceito`);
    }
    const fourth = await api("POST", "/medications", { name: "Medicamento 4" });
    assert.equal(fourth.status, 403);
    assert.equal((fourth.body as { code: string }).code, "PLAN_LIMIT");

    await cleanupMedications();
  });
});

describe("Consultas — recurso do plano Família por inteiro", () => {
  it("criar consulta no gratuito é bloqueado", async () => {
    await setPlan(null);
    const patient = await createPatient("Paciente Consulta");
    const patientId = (patient.body as { id: number }).id;

    const res = await api("POST", `/patients/${patientId}/appointments`, {
      specialty: "Cardiologia", scheduledDate: "2026-12-01", scheduledTime: "09:00",
    });
    assert.equal(res.status, 403);
    assert.equal((res.body as { code: string }).code, "PLAN_LIMIT");

    const appointments = await db.select().from(appointmentsTable).where(eq(appointmentsTable.patientId, patientId));
    assert.equal(appointments.length, 0);

    await cleanupPatients();
  });
});

describe("Alerta de estoque baixo — gated, mas o controle de estoque em si não", () => {
  it("gratuito continua rastreando estoque, só não mostra o alerta", async () => {
    await setPlan(null);
    const patient = await createPatient("Paciente Estoque");
    const patientId = (patient.body as { id: number }).id;
    const med = await api("POST", "/medications", { name: "Medicamento Estoque" });
    const medicationId = (med.body as { id: number }).id;

    // 1 dose/dia, 2 comprimidos restantes — bem abaixo do limite de 5 dias
    await api("POST", `/patients/${patientId}/treatments`, {
      medicationId, scheduleConfig: { scheduleType: "times_per_day", times: ["08:00"] },
      startDate: Clock.todayInTimezone("America/Sao_Paulo"),
      initialStock: { quantity: 2, unit: "comprimidos" },
    });

    const [stock] = await db.select().from(stockEntriesTable).where(eq(stockEntriesTable.patientId, patientId));
    assert.ok(stock, "o registro de estoque em si continua sendo criado no gratuito");
    assert.equal(stock.quantityRemaining, 2);

    const home = await api("GET", `/patients/${patientId}/today-doses`);
    const body = home.body as { lowStockItems: unknown[] };
    assert.equal(body.lowStockItems.length, 0, "o ALERTA fica escondido no gratuito, mesmo com o estoque genuinamente baixo");

    await setPlan("premium");
    const homePaid = await api("GET", `/patients/${patientId}/today-doses`);
    const bodyPaid = homePaid.body as { lowStockItems: unknown[] };
    assert.equal(bodyPaid.lowStockItems.length, 1, "com plano pago, o mesmo estoque baixo aparece");

    await cleanupPatients();
    await cleanupMedications();
    await setPlan(null);
  });
});

describe("Downgrade nunca apaga dado — excedente vira somente-leitura", () => {
  it("paciente mais antigo continua editável; o excedente vira leitura, mas os dados dos dois continuam visíveis", async () => {
    await setPlan("premium");
    const p1 = await createPatient("Paciente Mais Antigo");
    const patient1Id = (p1.body as { id: number }).id;
    const p2 = await createPatient("Paciente Mais Novo");
    const patient2Id = (p2.body as { id: number }).id;

    const med = await api("POST", "/medications", { name: "Medicamento Downgrade" });
    const medicationId = (med.body as { id: number }).id;

    // downgrade: plano gratuito só cobre 1 paciente — o mais ANTIGO (patient1) fica editável
    await setPlan(null);

    const treatOld = await api("POST", `/patients/${patient1Id}/treatments`, {
      medicationId, scheduleConfig: { scheduleType: "times_per_day", times: ["08:00"] }, startDate: "2026-01-01",
    });
    assert.equal(treatOld.status, 201, "o paciente mais antigo (dentro do limite) continua aceitando tratamento novo");

    const treatNew = await api("POST", `/patients/${patient2Id}/treatments`, {
      medicationId, scheduleConfig: { scheduleType: "times_per_day", times: ["08:00"] }, startDate: "2026-01-01",
    });
    assert.equal(treatNew.status, 403, "o paciente excedente não aceita tratamento novo");
    assert.equal((treatNew.body as { code: string }).code, "PLAN_READ_ONLY");

    // os dois pacientes continuam existindo e visíveis — downgrade não apaga nada
    const list = await api("GET", "/patients");
    const names = (list.body as Array<{ name: string }>).map((p) => p.name);
    assert.ok(names.includes("Paciente Mais Antigo"));
    assert.ok(names.includes("Paciente Mais Novo"), "o paciente excedente continua visível, só não editável");

    await setPlan("premium");
    await cleanupPatients();
    await cleanupMedications();
    await setPlan(null);
  });

  // REGRA REVISADA depois de um teste ao vivo (ver cabeçalho de
  // routes/dose-records.ts): a ZELO-38 bloqueava TAMBÉM o registro de dose
  // do paciente excedente. Na prática isso significou um idoso, no modo
  // idoso (ZELO-40), apertando "Tomei" e recebendo aviso de limite de
  // plano — ele não tem relação nenhuma com a assinatura de quem cuida
  // dele, e registrar a dose é o dado vital do produto. O paywall ficou só
  // onde é sobre CRESCER (tratamento novo, acima), nunca sobre registrar o
  // que já foi prescrito. Este teste agora prova a regra nova.
  it("registrar dose NUNCA é bloqueado por plano, nem no paciente excedente — é a função vital do produto", async () => {
    await setPlan("premium");
    const p1 = await createPatient("A");
    const _patient1Id = (p1.body as { id: number }).id;
    const p2 = await createPatient("B");
    const patient2Id = (p2.body as { id: number }).id;
    const med = await api("POST", "/medications", { name: "Medicamento Dose Downgrade" });
    const medicationId = (med.body as { id: number }).id;

    const [dose] = await db.insert(scheduledDosesTable).values({
      treatmentId: (await db.insert(treatmentsTable).values({
        patientId: patient2Id, medicationId, scheduleType: "times_per_day",
        scheduleConfig: { scheduleType: "times_per_day", times: ["08:00"] }, startDate: "2026-01-01",
      }).returning())[0].id,
      patientId: patient2Id, scheduledAt: new Date("2026-01-01T11:00:00Z"),
      scheduledLocalDate: "2026-01-01", scheduledLocalTime: "08:00", status: "pending",
    }).returning();

    await setPlan(null); // patient2 (mais novo) vira excedente

    const registerRes = await api("POST", `/patients/${patient2Id}/dose-records`, {
      scheduledDoseId: dose.id, takenAt: "2026-01-01T11:00:00Z", outcome: "taken",
      justification: "registro de teste fora da janela",
    });
    assert.equal(registerRes.status, 201, "o paciente excedente continua aceitando REGISTRO de dose — plano nunca corta isso");

    // ler continua funcionando — nunca some
    const readRes = await api("GET", `/patients/${patient2Id}/today-doses`);
    assert.equal(readRes.status, 200);

    await setPlan("premium");
    await cleanupPatients();
    await cleanupMedications();
    await setPlan(null);
  });

  it("mas CRIAR tratamento novo no paciente excedente continua bloqueado — isso é crescer, não registrar", async () => {
    await setPlan("premium");
    const p1 = await createPatient("C");
    const p2 = await createPatient("D");
    const patient2Id = (p2.body as { id: number }).id;
    void p1;
    const med = await api("POST", "/medications", { name: "Medicamento Limite Crescer" });
    const medicationId = (med.body as { id: number }).id;

    await setPlan(null);

    const treatRes = await api("POST", `/patients/${patient2Id}/treatments`, {
      medicationId, scheduleConfig: { scheduleType: "times_per_day", times: ["08:00"] }, startDate: "2026-01-01",
    });
    assert.equal(treatRes.status, 403);
    assert.equal((treatRes.body as { code: string }).code, "PLAN_READ_ONLY");

    await setPlan("premium");
    await cleanupPatients();
    await cleanupMedications();
    await setPlan(null);
  });
});

describe("Estado do plano no perfil", () => {
  it("GET /account/me devolve o plano e os limites em vigor", async () => {
    await setPlan(null);
    const free = await api("GET", "/account/me");
    const freeBody = free.body as { plan: { isPaid: boolean; limits: { maxPatients: number | null } } };
    assert.equal(freeBody.plan.isPaid, false);
    assert.equal(freeBody.plan.limits.maxPatients, 1);

    await setPlan("premium");
    const paid = await api("GET", "/account/me");
    const paidBody = paid.body as { plan: { isPaid: boolean; limits: { maxPatients: number | null } } };
    assert.equal(paidBody.plan.isPaid, true);
    assert.equal(paidBody.plan.limits.maxPatients, 5);

    await setPlan(null);
  });
});
