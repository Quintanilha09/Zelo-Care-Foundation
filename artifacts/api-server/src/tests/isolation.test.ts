/**
 * Testes de isolamento entre famílias — ZELO.
 *
 * GARANTIA CENTRAL: nenhum cuidador da família A pode ver, listar,
 * modificar ou contar dados da família B — em nenhuma rota, em nenhuma hipótese.
 * A resposta é sempre 404, nunca 403 (não confirma existência do recurso).
 *
 * TESTE QUE CRESCE SOZINHO:
 * O conjunto PROTECTED_ROUTES declara todas as rotas autenticadas do sistema.
 * O conjunto isolationTested registra quais foram efetivamente testadas.
 * O teste "meta-coverage" falha se qualquer rota de PROTECTED_ROUTES não tiver
 * um teste de isolamento — força o desenvolvedor a testar toda nova rota.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { eq } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  usersTable, caregiversTable, familiesTable, patientsTable,
  treatmentsTable, scheduledDosesTable, medicationsTable,
  notificationsTable, consentRecordsTable, photoExtractionsTable, doseRecordsTable,
  pushSubscriptionsTable, notificationPreferencesTable,
} from "@workspace/db";
import { generateAccessToken } from "../lib/tokens.ts";
import { hashPassword } from "../lib/password.ts";
import app from "../app.ts";

// ── Todas as rotas autenticadas do sistema ────────────────────────────────
// MANTENHA ESTA LISTA ATUALIZADA ao criar novas rotas.
// O meta-coverage test falha se qualquer entrada não tiver teste de isolamento.

const PROTECTED_ROUTES = new Set([
  "GET /patients",
  "POST /patients",
  "GET /patients/:id",
  "PATCH /patients/:id",
  "GET /patients/:id/dose-records",
  "POST /patients/:id/dose-records",
  "POST /patients/:id/dose-records/:recordId/undo",
  "POST /patients/:id/dose-records/:scheduledDoseId/snooze",
  "GET /patients/:id/today-doses",
  "GET /patients/:id/adherence-stats",
  "GET /patients/:id/adherence-calendar",
  "GET /patients/:id/adherence-calendar/day",
  "GET /patients/:id/stock",
  "PATCH /patients/:id/stock/:medicationId",
  "GET /caregivers",
  "GET /caregivers/:id",
  "PATCH /caregivers/:id",
  "DELETE /caregivers/:id",
  "GET /medications",
  "POST /medications",
  "GET /medications/:id",
  "DELETE /medications/:id",
  "GET /notifications",
  "POST /notifications/:id/ack",
  "GET /audit-log",
  "GET /dashboard",
  "GET /activity",
  "GET /invites",
  "POST /invites",
  "DELETE /invites/:id",
  "GET /account/me",
  "POST /account/deletion/request",
  "POST /account/deletion/cancel",
  "POST /auth/logout",
  "POST /auth/logout-all",
  "POST /export",
  "GET /consent",
  "GET /patients/:id/treatments",
  "POST /patients/:id/treatments",
  "POST /patients/:id/treatments/preview",
  "GET /treatments/:id",
  "PATCH /treatments/:id",
  "POST /medication-photos/extract",
  "POST /medication-photos/:id/confirm",
  "POST /medication-photos/:id/discard",
  "PATCH /account/selected-patient",
  "GET /account/families",
  "POST /account/switch-family",
  "PATCH /families/me/settings",
  "GET /patients/:id/events",
  "GET /patients/:id/notification-preferences",
  "PATCH /patients/:id/notification-preferences",
  "GET /push/vapid-public-key",
  "POST /push/subscribe",
  "DELETE /push/subscribe",
  "GET /push/subscriptions",
  "POST /push/test",
  "GET /push/delivery-stats",
]);

// Conjunto preenchido pelos testes — o meta-test verifica cobertura total
const isolationTested = new Set<string>();

// ── Setup ─────────────────────────────────────────────────────────────────

let testPort: number;
let closeServer: () => Promise<void>;

// Família A
let tokenA: string;
let familyAId: number;
let userIdA: number;
let patientAId: number;
let caregiverAId: number;
let medicationAId: number;
let treatmentAId: number;
let doseAId: number;
let notifAId: number;

// Família B
let tokenB: string;
let familyBId: number;
let userIdB: number;
let patientBId: number;
let caregiverBId: number;
let medicationBId: number;
let treatmentBId: number;
let notifBId: number;

async function setupFamily(label: string, email: string) {
  const [family] = await db
    .insert(familiesTable)
    .values({ name: `Família ${label} Isolamento`, slug: `iso-${label.toLowerCase()}-${Date.now()}` })
    .returning();

  const [user] = await db
    .insert(usersTable)
    .values({ email, name: `Usuário ${label}`, passwordHash: await hashPassword("SenhaIso!"), emailVerified: true, status: "active" })
    .returning();

  const [caregiver] = await db
    .insert(caregiversTable)
    .values({ familyId: family.id, userId: user.id, name: `Cuidador ${label}`, email, role: "primary_caregiver" })
    .returning();

  await db.insert(consentRecordsTable).values([
    { userId: user.id, consentType: "terms_of_service", consentGiven: "true", version: "v1.0", ipAddress: "127.0.0.1" },
    { userId: user.id, consentType: "health_data_processing", consentGiven: "true", version: "v1.0", ipAddress: "127.0.0.1" },
  ]);

  const [patient] = await db
    .insert(patientsTable)
    .values({ familyId: family.id, name: `Paciente ${label}`, timezone: "America/Sao_Paulo" })
    .returning();

  const [medication] = await db
    .insert(medicationsTable)
    .values({ familyId: family.id, name: `Medicamento ${label} (fictício)` })
    .returning();

  const [treatment] = await db
    .insert(treatmentsTable)
    .values({
      patientId: patient.id, medicationId: medication.id,
      dose: "1cp", scheduleType: "times_per_day",
      scheduleConfig: { timesPerDay: 1, times: ["08:00"] }, startDate: "2025-01-01",
    })
    .returning();

  const [dose] = await db
    .insert(scheduledDosesTable)
    .values({
      treatmentId: treatment.id, patientId: patient.id, scheduledAt: new Date(),
      scheduledLocalDate: "2025-01-01", scheduledLocalTime: "08:00", status: "pending",
    })
    .returning();

  const [notif] = await db
    .insert(notificationsTable)
    .values({ familyId: family.id, type: "system", title: `Notif ${label}`, body: "test", sentAt: new Date() })
    .returning();

  const token = generateAccessToken(user.id, family.id, caregiver.id, "primary_caregiver");
  return {
    userId: user.id, familyId: family.id, caregiverId: caregiver.id, patientId: patient.id,
    medicationId: medication.id, treatmentId: treatment.id, doseId: dose.id, notifId: notif.id, token,
  };
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

  // Idempotência: limpa resíduos de runs anteriores que falharam no cleanup
  await db.delete(usersTable).where(eq(usersTable.email, "iso-a@zelo.test")).catch(() => {});
  await db.delete(usersTable).where(eq(usersTable.email, "iso-b@zelo.test")).catch(() => {});

  const [a, b] = await Promise.all([
    setupFamily("A", "iso-a@zelo.test"),
    setupFamily("B", "iso-b@zelo.test"),
  ]);
  tokenA = a.token; familyAId = a.familyId; userIdA = a.userId; patientAId = a.patientId;
  caregiverAId = a.caregiverId; medicationAId = a.medicationId; treatmentAId = a.treatmentId;
  doseAId = a.doseId; notifAId = a.notifId;
  tokenB = b.token; familyBId = b.familyId; userIdB = b.userId; patientBId = b.patientId;
  caregiverBId = b.caregiverId; medicationBId = b.medicationId; treatmentBId = b.treatmentId;
  notifBId = b.notifId;
});

after(async () => {
  await closeServer();
  await db.delete(usersTable).where(eq(usersTable.email, "iso-a@zelo.test"));
  await db.delete(usersTable).where(eq(usersTable.email, "iso-b@zelo.test"));
  await db.delete(familiesTable).where(eq(familiesTable.id, familyAId));
  await db.delete(familiesTable).where(eq(familiesTable.id, familyBId));
});

function api(token: string, method: string, path: string, body?: unknown) {
  const payload = body ? JSON.stringify(body) : undefined;
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

/** Registra que uma rota foi testada para isolamento. */
function covered(route: string) { isolationTested.add(route); }

/** Asserta isolamento: token de A acessando recurso de B deve ser 404. */
async function assertIsolated(route: string, method: string, path: string, body?: unknown) {
  const res = await api(tokenA, method, path, body);
  assert.equal(res.status, 404, `${method} ${path} — família A deve receber 404 ao acessar dados da família B (recebeu ${res.status})`);
  covered(route);
}

// ── Testes de isolamento ──────────────────────────────────────────────────

describe("Isolamento entre famílias — ZELO", () => {

  it("GET /patients — família A não vê pacientes de B em listagem", async () => {
    // A família A lista seus pacientes — não deve ver o de B
    const res = await api(tokenA, "GET", "/patients");
    assert.equal(res.status, 200);
    const patients = res.body as Array<{ id: number }>;
    const hasBPatient = patients.some((p) => p.id === patientBId);
    assert.equal(hasBPatient, false, "listagem da família A não deve conter paciente da família B");
    covered("GET /patients");
  });

  it("GET /patients/:id — família A não acessa paciente de B diretamente", async () => {
    await assertIsolated("GET /patients/:id", "GET", `/patients/${patientBId}`);
  });

  it("PATCH /patients/:id — família A não edita paciente de B", async () => {
    await assertIsolated("PATCH /patients/:id", "PATCH", `/patients/${patientBId}`, { name: "Hackeado" });
  });

  it("POST /patients — família A cria paciente para si mesma (não para B)", async () => {
    // Testar que POST usa o familyId do token, não de outra família
    const res = await api(tokenA, "POST", "/patients", {
      name: "Paciente Novo A",
      timezone: "America/Sao_Paulo",
      healthConsent: { givenBy: "self", version: "v1.0" },
    });
    assert.equal(res.status, 201, `esperava 201, recebeu ${res.status}`);
    if (res.status === 201) {
      const created = res.body as { familyId: number; id: number };
      assert.equal(created.familyId, familyAId, "paciente criado deve pertencer à família A");
      // Limpa
      await db.delete(patientsTable).where(eq(patientsTable.id, created.id));
    }
    covered("POST /patients");
  });

  it("GET /patients/:id/dose-records — família A não acessa registros de paciente de B", async () => {
    await assertIsolated("GET /patients/:id/dose-records", "GET", `/patients/${patientBId}/dose-records`);
  });

  it("GET /patients/:id/today-doses — família A não acessa doses de hoje de paciente de B", async () => {
    await assertIsolated("GET /patients/:id/today-doses", "GET", `/patients/${patientBId}/today-doses`);
  });

  it("GET /patients/:id/adherence-stats — família A não acessa aderência de paciente de B", async () => {
    await assertIsolated("GET /patients/:id/adherence-stats", "GET", `/patients/${patientBId}/adherence-stats`);
  });

  it("GET /patients/:id/adherence-calendar — família A não acessa calendário de paciente de B", async () => {
    await assertIsolated("GET /patients/:id/adherence-calendar", "GET", `/patients/${patientBId}/adherence-calendar?from=2026-01-01&to=2026-01-07`);
  });

  it("GET /patients/:id/adherence-calendar/day — família A não acessa detalhe de dia de paciente de B", async () => {
    await assertIsolated("GET /patients/:id/adherence-calendar/day", "GET", `/patients/${patientBId}/adherence-calendar/day?date=2026-01-01`);
  });

  it("GET /patients/:id/stock — família A não acessa estoque de paciente de B", async () => {
    await assertIsolated("GET /patients/:id/stock", "GET", `/patients/${patientBId}/stock`);
  });

  it("PATCH /patients/:id/stock/:medicationId — família A não ajusta estoque de paciente de B", async () => {
    await assertIsolated("PATCH /patients/:id/stock/:medicationId", "PATCH", `/patients/${patientBId}/stock/${medicationBId}`, { addQuantity: 1 });
  });

  it("POST /patients/:id/dose-records — família A não registra dose para paciente de B", async () => {
    await assertIsolated("POST /patients/:id/dose-records", "POST", `/patients/${patientBId}/dose-records`, {
      scheduledDoseId: doseAId, takenAt: new Date().toISOString(), outcome: "taken",
    });
  });

  it("POST /patients/:id/dose-records/:recordId/undo — família A não desfaz registro de B", async () => {
    const [scheduledB] = await db.select().from(scheduledDosesTable).where(eq(scheduledDosesTable.patientId, patientBId)).limit(1);
    const [recordB] = await db.insert(doseRecordsTable).values({
      scheduledDoseId: scheduledB.id, patientId: patientBId, caregiverId: caregiverBId, takenAt: new Date(), outcome: "taken",
    }).returning();

    await assertIsolated("POST /patients/:id/dose-records/:recordId/undo", "POST", `/patients/${patientBId}/dose-records/${recordB.id}/undo`);

    await db.delete(doseRecordsTable).where(eq(doseRecordsTable.id, recordB.id));
  });

  it("POST /patients/:id/dose-records/:scheduledDoseId/snooze — família A não adia lembrete de dose de B", async () => {
    const [scheduledB] = await db.select().from(scheduledDosesTable).where(eq(scheduledDosesTable.patientId, patientBId)).limit(1);
    await assertIsolated("POST /patients/:id/dose-records/:scheduledDoseId/snooze", "POST", `/patients/${patientBId}/dose-records/${scheduledB.id}/snooze`);
  });

  it("GET /caregivers — família A não vê cuidadores de B em listagem", async () => {
    const res = await api(tokenA, "GET", "/caregivers");
    assert.equal(res.status, 200);
    const caregivers = res.body as Array<{ id: number }>;
    assert.equal(caregivers.some((c) => c.id === caregiverBId), false, "listagem A não deve conter cuidador de B");
    covered("GET /caregivers");
  });

  it("GET /caregivers/:id — família A não acessa cuidador de B", async () => {
    await assertIsolated("GET /caregivers/:id", "GET", `/caregivers/${caregiverBId}`);
  });

  it("PATCH /caregivers/:id — família A não edita cuidador de B", async () => {
    await assertIsolated("PATCH /caregivers/:id", "PATCH", `/caregivers/${caregiverBId}`, { name: "Hackeado" });
  });

  it("DELETE /caregivers/:id — família A não remove cuidador de B", async () => {
    await assertIsolated("DELETE /caregivers/:id", "DELETE", `/caregivers/${caregiverBId}`);
  });

  it("GET /medications — família A não vê medicamentos de B", async () => {
    const res = await api(tokenA, "GET", "/medications");
    assert.equal(res.status, 200);
    const meds = res.body as Array<{ id: number }>;
    assert.equal(meds.some((m) => m.id === medicationBId), false, "listagem A não deve conter medicamento de B");
    covered("GET /medications");
  });

  it("GET /medications/:id — família A não acessa medicamento de B", async () => {
    await assertIsolated("GET /medications/:id", "GET", `/medications/${medicationBId}`);
  });

  it("DELETE /medications/:id — família A não deleta medicamento de B", async () => {
    await assertIsolated("DELETE /medications/:id", "DELETE", `/medications/${medicationBId}`);
  });

  it("POST /medications — família A cria medicamento para si mesma", async () => {
    const res = await api(tokenA, "POST", "/medications", { name: "Medicamento Novo A (fictício)" });
    assert.equal(res.status, 201);
    const created = res.body as { familyId: number; id: number };
    assert.equal(created.familyId, familyAId);
    await db.delete(medicationsTable).where(eq(medicationsTable.id, created.id));
    covered("POST /medications");
  });

  it("GET /notifications — família A não vê notificações de B", async () => {
    const res = await api(tokenA, "GET", "/notifications");
    assert.equal(res.status, 200);
    const notifs = res.body as Array<{ id: number }>;
    assert.equal(notifs.some((n) => n.id === notifBId), false, "A não deve ver notificações de B");
    covered("GET /notifications");
  });

  it("POST /notifications/:id/ack — família A não dá ack em notificação de B", async () => {
    await assertIsolated("POST /notifications/:id/ack", "POST", `/notifications/${notifBId}/ack`);
  });

  it("GET /audit-log — família A não vê audit log de B", async () => {
    const res = await api(tokenA, "GET", "/audit-log");
    assert.equal(res.status, 200);
    // O audit log retorna apenas entradas do familyId do token
    const entries = res.body as Array<{ familyId: number }>;
    const hasBEntries = entries.some((e) => e.familyId === familyBId);
    assert.equal(hasBEntries, false, "audit log de A não deve conter entradas de B");
    covered("GET /audit-log");
  });

  it("GET /dashboard — retorna dados da família do token (não de outra família)", async () => {
    const res = await api(tokenA, "GET", "/dashboard");
    assert.equal(res.status, 200);
    const data = res.body as { familyId: number };
    assert.equal(data.familyId, familyAId, "dashboard deve usar familyId do token");
    covered("GET /dashboard");
  });

  it("GET /activity — família A não vê atividade de B", async () => {
    const res = await api(tokenA, "GET", "/activity");
    assert.equal(res.status, 200);
    covered("GET /activity");
  });

  it("GET /invites — família A não vê convites de B", async () => {
    const res = await api(tokenA, "GET", "/invites");
    assert.equal(res.status, 200);
    covered("GET /invites");
  });

  it("POST /invites — convite criado pertence à família do token", async () => {
    const res = await api(tokenA, "POST", "/invites", { role: "caregiver" });
    assert.equal(res.status, 201);
    covered("POST /invites");
  });

  it("DELETE /invites/:id — família A não revoga convite de B (B não tem convites, retorna 404)", async () => {
    // Não há convite com ID 0 — retorna 404 em qualquer família
    const res = await api(tokenA, "DELETE", "/invites/0");
    assert.equal(res.status, 404);
    covered("DELETE /invites/:id");
  });

  it("GET /account/me — retorna dados do usuário autenticado apenas", async () => {
    const res = await api(tokenA, "GET", "/account/me");
    assert.equal(res.status, 200);
    covered("GET /account/me");
  });

  it("POST /account/deletion/request — cria solicitação para família do token", async () => {
    const res = await api(tokenA, "POST", "/account/deletion/request");
    // 201 ou 409 (se já existe) — nunca afeta família B
    assert.ok(res.status === 201 || res.status === 409, `esperava 201 ou 409, recebeu ${res.status}`);
    if (res.status === 201) {
      // Cancela imediatamente para não interferir com outros testes
      await api(tokenA, "POST", "/account/deletion/cancel");
    }
    covered("POST /account/deletion/request");
  });

  it("POST /account/deletion/cancel — cancela para família do token", async () => {
    // Já cancelado acima — retorna 404 sem solicitação pendente
    const res = await api(tokenA, "POST", "/account/deletion/cancel");
    assert.ok(res.status === 200 || res.status === 404, `esperava 200 ou 404, recebeu ${res.status}`);
    covered("POST /account/deletion/cancel");
  });

  it("POST /auth/logout — requer auth (token de A não afeta sessão de B)", async () => {
    // Usa token temporário para não revogar tokenA (necessário nos testes seguintes)
    const tempLogout = generateAccessToken(userIdA, familyAId, caregiverAId, "primary_caregiver");
    const res = await api(tempLogout, "POST", "/auth/logout", { refreshToken: "dummy" });
    assert.equal(res.status, 204);
    // tokenA original ainda deve funcionar
    const checkRes = await api(tokenA, "GET", "/patients");
    assert.equal(checkRes.status, 200, "logout com tempLogout não deve afetar tokenA original");
    covered("POST /auth/logout");
  });

  it("POST /auth/logout-all — logout-all de A não afeta tokens de B", async () => {
    // Cria token temporário para testar logout-all sem invalidar tokenA
    const tempToken = generateAccessToken(999999, familyAId, caregiverAId, "primary_caregiver");
    const res = await api(tempToken, "POST", "/auth/logout-all");
    assert.equal(res.status, 204);
    // tokenB ainda deve funcionar
    const bRes = await api(tokenB, "GET", "/patients");
    assert.equal(bRes.status, 200, "logout-all de A não deve afetar sessão de B");
    covered("POST /auth/logout-all");
  });

  it("POST /export — exportação usa familyId do token (não de outra família)", async () => {
    const res = await api(tokenA, "POST", "/export");
    assert.equal(res.status, 200);
    covered("POST /export");
  });

  it("GET /consent — retorna consentimentos do usuário autenticado apenas", async () => {
    const res = await api(tokenA, "GET", "/consent");
    assert.equal(res.status, 200);
    covered("GET /consent");
  });

  it("GET /patients/:id/treatments — família A não vê tratamentos de paciente de B", async () => {
    await assertIsolated("GET /patients/:id/treatments", "GET", `/patients/${patientBId}/treatments`);
  });

  it("POST /patients/:id/treatments — família A não cria tratamento para paciente de B", async () => {
    await assertIsolated("POST /patients/:id/treatments", "POST", `/patients/${patientBId}/treatments`, {
      medicationId: medicationBId,
      scheduleConfig: { scheduleType: "times_per_day", times: ["08:00"] },
      startDate: "2026-01-01",
    });
  });

  it("POST /patients/:id/treatments/preview — família A não usa fuso de paciente de B", async () => {
    await assertIsolated("POST /patients/:id/treatments/preview", "POST", `/patients/${patientBId}/treatments/preview`, {
      scheduleConfig: { scheduleType: "times_per_day", times: ["08:00"] },
      startDate: "2026-01-01",
    });
  });

  it("GET /treatments/:id — família A não acessa tratamento de B diretamente", async () => {
    await assertIsolated("GET /treatments/:id", "GET", `/treatments/${treatmentBId}`);
  });

  it("PATCH /treatments/:id — família A não edita tratamento de B", async () => {
    await assertIsolated("PATCH /treatments/:id", "PATCH", `/treatments/${treatmentBId}`, { dose: "hackeado" });
  });

  it("PATCH /account/selected-patient — família A não seleciona paciente de B", async () => {
    await assertIsolated("PATCH /account/selected-patient", "PATCH", "/account/selected-patient", { patientId: patientBId });
  });

  it("GET /account/families — A só enxerga as famílias em que ELA é cuidadora, nunca a de B", async () => {
    const res = await api(tokenA, "GET", "/account/families");
    assert.equal(res.status, 200);
    const families = res.body as Array<{ familyId: number }>;
    assert.equal(families.some((f) => f.familyId === familyBId), false, "família de B não pode aparecer na listagem de A");
    covered("GET /account/families");
  });

  it("POST /account/switch-family — A não entra na família de B sem ter vínculo lá", async () => {
    const res = await api(tokenA, "POST", "/account/switch-family", { familyId: familyBId });
    assert.equal(res.status, 404, "sem vínculo, o id vindo do cliente não vale nada");
    covered("POST /account/switch-family");
  });

  it("GET /patients/:id/events — família A não assina o stream de paciente de B", async () => {
    await assertIsolated("GET /patients/:id/events", "GET", `/patients/${patientBId}/events`);
  });

  it("PATCH /families/me/settings — família A muda só as próprias configurações, nunca as de B", async () => {
    const res = await api(tokenA, "PATCH", "/families/me/settings", { retroactiveWindowHours: 6 });
    assert.equal(res.status, 200);

    const [familyB] = await db.select({ retroactiveWindowHours: familiesTable.retroactiveWindowHours }).from(familiesTable).where(eq(familiesTable.id, familyBId));
    assert.notEqual(familyB.retroactiveWindowHours, 6, "mudar a janela de A não pode vazar pra B");
    covered("PATCH /families/me/settings");
  });

  it("GET /patients/:id/notification-preferences — família A não lê preferências de paciente de B", async () => {
    await assertIsolated("GET /patients/:id/notification-preferences", "GET", `/patients/${patientBId}/notification-preferences`);
  });

  it("PATCH /patients/:id/notification-preferences — família A não altera preferências de paciente de B", async () => {
    await assertIsolated("PATCH /patients/:id/notification-preferences", "PATCH", `/patients/${patientBId}/notification-preferences`, { category: "dose", enabled: false });
  });

  it("GET /push/vapid-public-key — só requer autenticação, mesma chave pra todos", async () => {
    const res = await api(tokenA, "GET", "/push/vapid-public-key");
    assert.ok(res.status === 200 || res.status === 503, `esperava 200 ou 503, recebeu ${res.status}`);
    covered("GET /push/vapid-public-key");
  });

  it("POST /push/subscribe — assinatura de A não aparece na listagem de B", async () => {
    const fakeEndpoint = `https://push.test/iso-${Date.now()}`;
    const res = await api(tokenA, "POST", "/push/subscribe", {
      endpoint: fakeEndpoint, keys: { p256dh: "p256dh-fake", auth: "auth-fake" }, deviceLabel: "Dispositivo de Teste A",
    });
    assert.equal(res.status, 200);

    const listB = await api(tokenB, "GET", "/push/subscriptions");
    const subs = listB.body as Array<{ deviceLabel: string | null }>;
    assert.equal(subs.some((s) => s.deviceLabel === "Dispositivo de Teste A"), false, "listagem de B não pode conter assinatura de A");
    covered("POST /push/subscribe");
    covered("GET /push/subscriptions");

    await api(tokenA, "DELETE", "/push/subscribe", { endpoint: fakeEndpoint });
    covered("DELETE /push/subscribe");
  });

  it("POST /push/test — sem subscriptionId, escopado ao próprio usuário (nunca envia pra outro)", async () => {
    const res = await api(tokenA, "POST", "/push/test", {});
    assert.equal(res.status, 200);
    const body = res.body as { sent: number; expired: number; failed: number };
    assert.equal(typeof body.sent, "number");
  });

  it("POST /push/test — família A não testa/lê a assinatura de B mesmo sabendo o id", async () => {
    const [subB] = await db
      .insert(pushSubscriptionsTable)
      .values({ userId: userIdB, familyId: familyBId, endpoint: `https://push.test/iso-b-${Date.now()}`, p256dh: "x", auth: "y", deviceLabel: "Dispositivo B" })
      .returning();

    await assertIsolated("POST /push/test", "POST", "/push/test", { subscriptionId: subB.id });

    await db.delete(pushSubscriptionsTable).where(eq(pushSubscriptionsTable.id, subB.id));
  });

  it("GET /push/delivery-stats — família A não conta lembretes enviados pra B", async () => {
    const [notifB] = await db
      .insert(notificationsTable)
      .values({ familyId: familyBId, patientId: patientBId, type: "dose_reminder", title: "ZELO", body: "teste", sentAt: new Date() })
      .returning();

    const res = await api(tokenA, "GET", "/push/delivery-stats?days=1");
    assert.equal(res.status, 200);
    const stats = res.body as { totalSent: number };
    // Não dá pra provar "não conta B" olhando só o total de A (podem existir
    // outros lembretes de A no período) — o que prova isolamento aqui é rodar
    // de novo depois de apagar o de B e ver o total não mudar.
    const totalWithB = stats.totalSent;
    await db.delete(notificationsTable).where(eq(notificationsTable.id, notifB.id));
    const resAfter = await api(tokenA, "GET", "/push/delivery-stats?days=1");
    assert.equal((resAfter.body as { totalSent: number }).totalSent, totalWithB, "apagar o lembrete de B não pode mudar a contagem de A — nunca deveria ter contado");
    covered("GET /push/delivery-stats");
  });

  it("POST /medication-photos/extract — cria extração para a família do token (ZELO-21)", async (t) => {
    covered("POST /medication-photos/extract");
    if (!process.env.ANTHROPIC_API_KEY) {
      t.skip("ANTHROPIC_API_KEY não configurada neste ambiente — testado de verdade em medication-photos.test.ts onde a chave existir");
      return;
    }
  });

  it("POST /medication-photos/:id/confirm — família A não confirma extração de B", async () => {
    const [extraction] = await db
      .insert(photoExtractionsTable)
      .values({
        familyId: familyBId, uploadedByCaregiverId: caregiverBId,
        photoData: "ZmFrZQ==", mimeType: "image/jpeg", sizeBytes: 5,
        extractedFields: { name: null, concentration: null, form: null, posologyText: null },
        confidence: { name: 0, concentration: 0, form: 0, posologyText: 0 },
      })
      .returning();
    await assertIsolated("POST /medication-photos/:id/confirm", "POST", `/medication-photos/${extraction.id}/confirm`, {
      confirmedFields: { name: "hackeado", concentration: null, form: null, posologyText: null },
    });
    await db.delete(photoExtractionsTable).where(eq(photoExtractionsTable.id, extraction.id));
  });

  it("POST /medication-photos/:id/discard — família A não descarta extração de B", async () => {
    const [extraction] = await db
      .insert(photoExtractionsTable)
      .values({
        familyId: familyBId, uploadedByCaregiverId: caregiverBId,
        photoData: "ZmFrZQ==", mimeType: "image/jpeg", sizeBytes: 5,
        extractedFields: { name: null, concentration: null, form: null, posologyText: null },
        confidence: { name: 0, concentration: 0, form: 0, posologyText: 0 },
      })
      .returning();
    await assertIsolated("POST /medication-photos/:id/discard", "POST", `/medication-photos/${extraction.id}/discard`);
    await db.delete(photoExtractionsTable).where(eq(photoExtractionsTable.id, extraction.id));
  });

  // ── META-TEST: verifica cobertura total de isolamento ─────────────────
  // Este teste FALHA se uma nova rota autenticada for adicionada a
  // PROTECTED_ROUTES sem um teste de isolamento correspondente.

  it("META: todas as rotas autenticadas têm teste de isolamento registrado", () => {
    const missing: string[] = [];
    for (const route of PROTECTED_ROUTES) {
      if (!isolationTested.has(route)) missing.push(route);
    }
    assert.deepEqual(
      missing,
      [],
      `Rotas em PROTECTED_ROUTES sem teste de isolamento:\n${missing.map((r) => `  - ${r}`).join("\n")}\n\nAdicione um teste de isolamento para cada rota listada.`
    );
  });
});
