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
  scheduledDosesTable,
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

// Senha real do cuidador de teste — a saída do modo idoso é confirmada por
// senha, então ela precisa ser conhecida aqui pra testar os dois lados.
const CAREGIVER_PASSWORD = "senha-de-teste-123";

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

  const [user] = await db.insert(usersTable).values({ email: `elder-mode-${Date.now()}@zelo.test`, name: "Cuidador Principal", passwordHash: await hashPassword(CAREGIVER_PASSWORD), emailVerified: true, status: "active" }).returning();
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

/**
 * Testes de REGRESSÃO dos dois bugs que travaram o modo idoso num teste
 * ao vivo. Ambos eram falhas silenciosas — nada aparecia na tela — então
 * cada um vira aqui uma afirmação concreta sobre o contrato do servidor.
 */
describe("Sair do modo idoso — confirmação de senha", () => {
  it("GET /account/me devolve o email do próprio usuário", async () => {
    // BUG REAL: a consulta de /account/me não selecionava `email`, mesmo
    // com o cliente declarando depender dele. `user.email` chegava
    // undefined e o botão "Sair" (que fazia `if (!user?.email) return`)
    // virava um no-op permanente e mudo — o cuidador ficava preso no modo
    // idoso, sem nenhuma mensagem.
    const res = await api("GET", "/account/me");
    assert.equal(res.status, 200);
    const body = res.body as { email?: string };
    assert.ok(body.email, "/account/me precisa devolver email — o cliente depende disso");
    assert.ok(body.email!.includes("@"));
  });

  it("senha correta confirma (200) e NÃO derruba a sessão em uso", async () => {
    const res = await api("POST", "/account/verify-password", { password: CAREGIVER_PASSWORD });
    assert.equal(res.status, 200);
    assert.equal((res.body as { verified: boolean }).verified, true);

    // O aparelho no modo idoso continua usando a MESMA sessão do cuidador —
    // confirmar a senha não pode rotacionar token nem deslogar ninguém
    // (foi por isso que este endpoint existe em vez de refazer login).
    const stillAuthed = await api("GET", "/account/me");
    assert.equal(stillAuthed.status, 200, "a sessão precisa continuar válida depois de confirmar a senha");
  });

  it("senha errada responde 401 com mensagem em português, nunca em silêncio", async () => {
    const res = await api("POST", "/account/verify-password", { password: "senha-errada" });
    assert.equal(res.status, 401);
    const body = res.body as { error: string; code: string };
    assert.equal(body.code, "INVALID_PASSWORD");
    assert.ok(body.error && body.error.length > 0, "precisa ter texto pra tela mostrar — o bug anterior era não ter feedback nenhum");
  });

  it("sem autenticação, 401 — a confirmação nunca é um caminho aberto", async () => {
    const res = await api("POST", "/account/verify-password", { password: CAREGIVER_PASSWORD }, "token-invalido");
    assert.equal(res.status, 401);
  });
});

describe("Relógio do cliente não pode derrubar um registro legítimo", () => {
  // BUG REAL: o cliente sempre mandava `new Date().toISOString()` pra dizer
  // "acabei de tomar", e o servidor comparava com o relógio DELE sem
  // tolerância. Alguns segundos de dessincronia entre os dois relógios —
  // comum, e fora do controle dos dois lados — recusavam o registro com
  // "não é possível registrar uma dose no futuro". Foi o que travou o
  // "Tomei" num aparelho real.
  async function pendingDoseId(times: [string, string]): Promise<{ doseId: number; treatmentId: number }> {
    const res = await api("POST", `/patients/${patientId}/treatments`, {
      medicationId,
      scheduleConfig: { scheduleType: "times_per_day", times },
      startDate: Clock.todayInTimezone("America/Sao_Paulo"),
    });
    const treatmentId = (res.body as { id: number }).id;
    const home = await api("GET", `/patients/${patientId}/today-doses`);
    const dose = (home.body as { doses: Array<{ id: number; status: string }> }).doses.find((d) => d.status === "pending");
    assert.ok(dose, "precisa haver dose pendente pro teste");
    return { doseId: dose!.id, treatmentId };
  }

  it("sem takenAt, o servidor ancora no próprio relógio e registra", async () => {
    const { doseId, treatmentId } = await pendingDoseId(["00:03", "23:57"]);
    const res = await api("POST", `/patients/${patientId}/dose-records`, {
      scheduledDoseId: doseId, outcome: "taken", viaElderMode: true,
    });
    assert.equal(res.status, 201, "'agora' sem timestamp do cliente é o caminho normal do modo idoso");
    await db.delete(treatmentsTable).where(eq(treatmentsTable.id, treatmentId));
  });

  it("relógio do aparelho adiantado alguns minutos NÃO derruba o registro", async () => {
    const { doseId, treatmentId } = await pendingDoseId(["00:04", "23:56"]);
    const adiantado = new Date(Clock.now().getTime() + 2 * 60_000).toISOString();
    const res = await api("POST", `/patients/${patientId}/dose-records`, {
      scheduledDoseId: doseId, takenAt: adiantado, outcome: "taken",
    });
    assert.equal(res.status, 201, "2 minutos de dessincronia é relógio, não intenção — precisa registrar");

    // e o horário gravado é ancorado no servidor, nunca no futuro
    const registered = res.body as { takenAt: string };
    assert.ok(
      new Date(registered.takenAt).getTime() <= Clock.now().getTime() + 1000,
      "o takenAt gravado não pode ficar no futuro"
    );
    await db.delete(treatmentsTable).where(eq(treatmentsTable.id, treatmentId));
  });

  it("mas uma dose realmente no futuro (amanhã) continua recusada — ZELO-24", async () => {
    const { doseId, treatmentId } = await pendingDoseId(["00:05", "23:55"]);
    const amanha = new Date(Clock.now().getTime() + 24 * 3_600_000).toISOString();
    const res = await api("POST", `/patients/${patientId}/dose-records`, {
      scheduledDoseId: doseId, takenAt: amanha, outcome: "taken",
    });
    assert.equal(res.status, 400);
    assert.match((res.body as { error: string }).error, /futuro/i);
    await db.delete(treatmentsTable).where(eq(treatmentsTable.id, treatmentId));
  });
});

describe("Registrar dose no modo idoso nunca é bloqueado por plano", () => {
  it("paciente excedente do plano gratuito continua aceitando 'Tomei'", async () => {
    // BUG REAL: a ZELO-38 marcava o paciente excedente como somente-leitura
    // e isso incluía REGISTRAR DOSE. Na prática, o idoso apertava "Tomei"
    // no modo idoso e levava um 403 de limite de plano — ele não tem
    // relação com a assinatura de quem cuida dele, e registrar a dose é o
    // dado vital do produto (mesma razão pela qual a ZELO-39 exige que o
    // app siga funcionando com pagamento em atraso).
    //
    // Esta família de teste não tem assinatura, ou seja, está no plano
    // gratuito (1 paciente) — este segundo paciente é o excedente.
    const [excedente] = await db.insert(patientsTable)
      .values({ familyId, name: "Paciente Excedente", timezone: "America/Sao_Paulo" })
      .returning();

    const [treatment] = await db.insert(treatmentsTable).values({
      patientId: excedente.id, medicationId, scheduleType: "times_per_day",
      scheduleConfig: { scheduleType: "times_per_day", times: ["08:00"] },
      startDate: Clock.todayInTimezone("America/Sao_Paulo"),
    }).returning();

    const [dose] = await db.insert(scheduledDosesTable).values({
      treatmentId: treatment.id, patientId: excedente.id,
      scheduledAt: Clock.now(),
      scheduledLocalDate: Clock.todayInTimezone("America/Sao_Paulo"),
      scheduledLocalTime: "08:00", status: "pending",
    }).returning();

    const res = await api("POST", `/patients/${excedente.id}/dose-records`, {
      scheduledDoseId: dose.id,
      takenAt: Clock.now().toISOString(),
      outcome: "taken",
      viaElderMode: true,
    });
    assert.equal(res.status, 201, "'Tomei' precisa funcionar mesmo no paciente fora do limite do plano");

    await db.delete(patientsTable).where(eq(patientsTable.id, excedente.id));
  });
});
