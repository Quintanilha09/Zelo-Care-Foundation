/**
 * Testes do painel operacional — ZELO (ZELO-32).
 *
 * Duas garantias centrais, testadas separadamente:
 * 1. SEPARAÇÃO DE AUTENTICAÇÃO: token de cuidador nunca abre rota de admin,
 *    token de admin nunca abre rota de cuidador — assinados com segredos
 *    diferentes (ver lib/admin-auth.ts), então isto é garantido pela
 *    própria criptografia, não por uma checagem que alguém possa esquecer.
 * 2. ZERO PII: toda consulta agregada devolvida pelo painel é inspecionada
 *    concretamente — cria paciente/medicamento com nome BEM distintivo,
 *    dispara um lembrete de verdade (que grava o nome no body da
 *    notification, como sempre), e confirma que esse nome NUNCA aparece em
 *    nenhuma resposta JSON do painel.
 *
 * operational_alerts e pgboss.job são tabelas GLOBAIS, sem familyId — ao
 * contrário de todo outro teste deste projeto, aqui não existe isolamento
 * natural por família entre testes. Cada teste limpa explicitamente o que
 * criou (alertas do tipo que mexeu, jobs que inseriu) antes de terminar.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { eq, sql } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  usersTable, caregiversTable, familiesTable, patientsTable, medicationsTable,
  treatmentsTable, scheduledDosesTable, notificationsTable, operationalAlertsTable,
} from "@workspace/db";
import { generateAccessToken } from "../lib/tokens.ts";
import { hashPassword } from "../lib/password.ts";
import { generateAdminToken } from "../lib/admin-auth.ts";
import { runOperationalChecks } from "../lib/operational-monitor.ts";
import { sendDoseReminder } from "../lib/dose-reminders.ts";
import { boss, QUEUE_DOSE_REMINDER, ensureQueueStarted } from "../lib/queue.ts";
import { Clock } from "../lib/clock.ts";
import app from "../app.ts";

let testPort: number;
let closeServer: () => Promise<void>;
let familyId: number;
let caregiverToken: string;
let patientId: number;
let medicationId: number;
const adminToken = generateAdminToken();

async function api(method: string, path: string, body: unknown, token: string | null): Promise<{ status: number; body: unknown }> {
  const payload = body !== undefined ? JSON.stringify(body) : undefined;
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: "127.0.0.1", port: testPort, path: `/api${path}`, method,
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
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

/**
 * checkQueueStuck (operational-monitor.ts) é deliberadamente GLOBAL — sem
 * recorte por fila —, então job vencido deixado por QUALQUER OUTRO arquivo
 * de teste (nenhum deles jamais limpou pgboss.job além da própria linha de
 * treatment) conta. Sem isto, o lado "resolve" do teste de queue_stuck
 * seria dependente de que mais rodou antes na mesma suíte.
 */
async function clearAllOverdueJobs() {
  await db.execute(sql`DELETE FROM pgboss.job WHERE state IN ('created', 'retry') AND start_after < now()`);
}

async function clearAlerts(type?: "delivery_rate" | "queue_stuck" | "no_send_window") {
  if (type) await db.delete(operationalAlertsTable).where(eq(operationalAlertsTable.type, type));
  else await db.delete(operationalAlertsTable);
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

  const [family] = await db.insert(familiesTable).values({ name: "Família Admin Teste", slug: `admin-test-${Date.now()}` }).returning();
  familyId = family.id;

  const [user] = await db.insert(usersTable).values({ email: `admin-test-${Date.now()}@zelo.test`, name: "Cuidador Admin Teste", passwordHash: await hashPassword("x"), emailVerified: true, status: "active" }).returning();
  const [caregiver] = await db.insert(caregiversTable).values({ familyId, userId: user.id, name: "Cuidador Admin Teste", role: "primary_caregiver" }).returning();
  caregiverToken = generateAccessToken(user.id, familyId, caregiver.id, "primary_caregiver");

  const [patient] = await db.insert(patientsTable).values({ familyId, name: "Paciente PII Não Pode Vazar No Painel", timezone: "America/Sao_Paulo" }).returning();
  patientId = patient.id;

  const [medication] = await db.insert(medicationsTable).values({ familyId, name: "Medicamento PII Nunca Aparece No Painel" }).returning();
  medicationId = medication.id;

  // Limpa qualquer alerta que uma execução anterior (ou outro arquivo de
  // teste que também chame runOperationalChecks) tenha deixado ativo —
  // tabela global, sem familyId pra isolar.
  await clearAlerts();
});

after(async () => {
  Clock.reset();
  await closeServer();
  await boss.stop({ graceful: false });
  await clearAlerts();
  await db.delete(familiesTable).where(eq(familiesTable.id, familyId));
});

describe("Separação de autenticação — ZELO-32", () => {
  it("POST /admin/login com senha certa devolve token; senha errada devolve 401", async () => {
    const wrong = await api("POST", "/admin/login", { password: "senha-errada-com-certeza" }, null);
    assert.equal(wrong.status, 401);

    const right = await api("POST", "/admin/login", { password: process.env.ADMIN_PANEL_SECRET }, null);
    assert.equal(right.status, 200);
    assert.ok((right.body as { token: string }).token);
  });

  it("token de CUIDADOR não abre rota de admin (401)", async () => {
    const res = await api("GET", "/admin/metrics", undefined, caregiverToken);
    assert.equal(res.status, 401);
  });

  it("token de ADMIN não abre rota de cuidador (401) — segredo diferente, jwt.verify rejeita", async () => {
    const res = await api("GET", "/account/me", undefined, adminToken);
    assert.equal(res.status, 401);
  });

  it("sem token nenhum, /admin/metrics e /admin/alerts pedem 401; /status funciona sem token", async () => {
    const metrics = await api("GET", "/admin/metrics", undefined, null);
    assert.equal(metrics.status, 401);
    const alerts = await api("GET", "/admin/alerts", undefined, null);
    assert.equal(alerts.status, 401);
    const status = await api("GET", "/status", undefined, null);
    assert.equal(status.status, 200);
  });
});

describe("GET /admin/metrics — agregação e zero PII", () => {
  it("agrega sent/delivered/failuresByReason/byPlatform corretamente a partir de linhas conhecidas", async () => {
    const now = Clock.now();
    const rows = [
      { sentAt: now, deliveredAt: now, deliveredViaPlatform: "android" as const, lastFailureReason: null },
      { sentAt: now, deliveredAt: now, deliveredViaPlatform: "ios" as const, lastFailureReason: null },
      { sentAt: now, deliveredAt: null, deliveredViaPlatform: null, lastFailureReason: "expired" as const },
      { sentAt: now, deliveredAt: null, deliveredViaPlatform: null, lastFailureReason: "error" as const },
    ];
    const inserted = await db
      .insert(notificationsTable)
      .values(rows.map((r) => ({ familyId, type: "dose_reminder" as const, title: "ZELO", body: "corpo genérico de teste", ...r })))
      .returning({ id: notificationsTable.id });

    const res = await api("GET", "/admin/metrics?days=1", undefined, adminToken);
    assert.equal(res.status, 200);
    const body = res.body as {
      totalSent: number; totalDelivered: number; deliveryRate: number;
      byPlatform: Array<{ platform: string; delivered: number }>;
      failuresByReason: Array<{ reason: string; count: number }>;
    };
    assert.ok(body.totalSent >= 4);
    assert.ok(body.totalDelivered >= 2);
    const android = body.byPlatform.find((p) => p.platform === "android");
    const ios = body.byPlatform.find((p) => p.platform === "ios");
    assert.ok(android && android.delivered >= 1);
    assert.ok(ios && ios.delivered >= 1);
    const expired = body.failuresByReason.find((f) => f.reason === "expired");
    const error = body.failuresByReason.find((f) => f.reason === "error");
    assert.ok(expired && expired.count >= 1);
    assert.ok(error && error.count >= 1);

    await db.delete(notificationsTable).where(eq(notificationsTable.familyId, familyId));
    void inserted;
  });

  it("nenhum campo de /admin/metrics ou /admin/alerts contém o nome do paciente ou do medicamento", async () => {
    const treatmentRes = await api(
      "POST",
      `/patients/${patientId}/treatments`,
      { medicationId, scheduleConfig: { scheduleType: "times_per_day", times: ["00:01", "23:59"] }, startDate: Clock.todayInTimezone("America/Sao_Paulo") },
      caregiverToken
    );
    const treatmentId = (treatmentRes.body as { id: number }).id;
    const [dose] = await db.select().from(scheduledDosesTable).where(eq(scheduledDosesTable.treatmentId, treatmentId)).orderBy(scheduledDosesTable.scheduledAt).limit(1);

    // Envia de verdade — é assim que o nome do paciente entra no body da
    // notification (ver buildBody em dose-reminders.ts). O painel lê essa
    // MESMA tabela; se algum select ali esquecer de excluir title/body, o
    // nome vaza.
    await sendDoseReminder(dose.id);

    const metricsRes = await api("GET", "/admin/metrics?days=1", undefined, adminToken);
    const alertsRes = await api("GET", "/admin/alerts", undefined, adminToken);
    const combined = JSON.stringify(metricsRes.body) + JSON.stringify(alertsRes.body);

    assert.ok(!combined.includes("Paciente PII"), "nome do paciente vazou pra fora do painel");
    assert.ok(!combined.includes("Medicamento PII"), "nome do medicamento vazou pra fora do painel");

    // Criar o tratamento pela rota de verdade enfileirou os 4 níveis da
    // cascata (ZELO-30) — apagar só o tratamento não apaga esses jobs,
    // pgboss.job não tem FK nenhuma pra treatments. Sem isto, os níveis
    // 1/2/3 (startAfter em T+15/30/60 da dose, no passado) ficam órfãos e
    // o teste de queue_stuck mais abaixo os enxerga como "travados".
    const doseJobs = await boss.findJobs(QUEUE_DOSE_REMINDER, { data: { scheduledDoseId: dose.id } });
    for (const j of doseJobs) await boss.deleteJob(QUEUE_DOSE_REMINDER, j.id);

    await db.delete(treatmentsTable).where(eq(treatmentsTable.id, treatmentId));
    await db.delete(notificationsTable).where(eq(notificationsTable.familyId, familyId));
  });

  it("responde em menos de 2s mesmo com várias linhas no período (critério de aceite)", async () => {
    const now = Clock.now();
    const bulk = Array.from({ length: 300 }, (_, i) => ({
      familyId, type: "dose_reminder" as const, title: "ZELO", body: "corpo genérico",
      sentAt: new Date(now.getTime() - i * 60_000),
      deliveredAt: i % 3 === 0 ? new Date(now.getTime() - i * 60_000 + 5_000) : null,
    }));
    await db.insert(notificationsTable).values(bulk);

    const start = Date.now();
    const res = await api("GET", "/admin/metrics?days=30", undefined, adminToken);
    const elapsedMs = Date.now() - start;

    assert.equal(res.status, 200);
    assert.ok(elapsedMs < 2000, `deveria responder em menos de 2s, levou ${elapsedMs}ms`);

    await db.delete(notificationsTable).where(eq(notificationsTable.familyId, familyId));
  });
});

describe("GET /status — público, sem PII", () => {
  it("responde 'operational' sem alerta ativo, 'degraded' com alerta ativo", async () => {
    await clearAlerts();
    const okRes = await api("GET", "/status", undefined, null);
    assert.equal((okRes.body as { status: string }).status, "operational");

    await db.insert(operationalAlertsTable).values({
      type: "delivery_rate", message: "taxa de entrega baixa (simulado no teste)", triggeredAt: Clock.now(),
    });
    const degradedRes = await api("GET", "/status", undefined, null);
    assert.equal((degradedRes.body as { status: string }).status, "degraded");

    await clearAlerts("delivery_rate");
  });
});

describe("Monitor operacional — detecção e resolução de alerta", () => {
  it("taxa de entrega abaixo de 95% (amostra suficiente) cria alerta; recuperar a taxa resolve", async () => {
    const now = Clock.now();
    // 10 enviadas, só 5 entregues = 50% — bem abaixo do limite, amostra >= 5.
    const low = Array.from({ length: 10 }, (_, i) => ({
      familyId, type: "dose_reminder" as const, title: "ZELO", body: "corpo genérico",
      sentAt: now, deliveredAt: i < 5 ? now : null,
    }));
    await db.insert(notificationsTable).values(low);

    await runOperationalChecks();
    const [active] = await db.select().from(operationalAlertsTable).where(eq(operationalAlertsTable.type, "delivery_rate"));
    assert.ok(active && !active.resolvedAt, "taxa de 50% deveria disparar o alerta");

    // "Recupera": as linhas ruins saem da janela (na vida real, seria só o
    // tempo passar — aqui troca por linhas 100% entregues no lugar).
    await db.delete(notificationsTable).where(eq(notificationsTable.familyId, familyId));
    await db.insert(notificationsTable).values(
      Array.from({ length: 10 }, () => ({
        familyId, type: "dose_reminder" as const, title: "ZELO", body: "corpo genérico", sentAt: now, deliveredAt: now,
      }))
    );

    await runOperationalChecks();
    const [resolved] = await db.select().from(operationalAlertsTable).where(eq(operationalAlertsTable.type, "delivery_rate"));
    assert.ok(resolved?.resolvedAt, "taxa de 100% deveria resolver o alerta");

    await db.delete(notificationsTable).where(eq(notificationsTable.familyId, familyId));
    await clearAlerts("delivery_rate");
  });

  it("amostra pequena (< 5 na última hora) nunca dispara alerta de taxa, mesmo com 0% de entrega", async () => {
    await db.insert(notificationsTable).values([
      { familyId, type: "dose_reminder", title: "ZELO", body: "x", sentAt: Clock.now(), deliveredAt: null },
      { familyId, type: "dose_reminder", title: "ZELO", body: "x", sentAt: Clock.now(), deliveredAt: null },
    ]);

    await runOperationalChecks();
    const [active] = await db.select().from(operationalAlertsTable).where(eq(operationalAlertsTable.type, "delivery_rate"));
    assert.ok(!active, "2 envios não é amostra suficiente pra confiar no percentual");

    await db.delete(notificationsTable).where(eq(notificationsTable.familyId, familyId));
  });

  it("job de fila vencido há mais de 5min (relógio REAL do Postgres) dispara alerta distinto de queue_stuck", async () => {
    await ensureQueueStarted();
    await clearAllOverdueJobs(); // slate limpa — outro arquivo de teste pode ter deixado job vencido pra trás
    const stuckMarker = 999_999_999; // scheduledDoseId fictício, só pra achar este job de volta via findJobs
    await boss.insert(QUEUE_DOSE_REMINDER, [
      { data: { scheduledDoseId: stuckMarker, level: 0 }, startAfter: new Date(Date.now() - 10 * 60_000) },
    ]);
    const [job] = await boss.findJobs(QUEUE_DOSE_REMINDER, { data: { scheduledDoseId: stuckMarker } });

    await runOperationalChecks();
    const [active] = await db.select().from(operationalAlertsTable).where(eq(operationalAlertsTable.type, "queue_stuck"));
    assert.ok(active && !active.resolvedAt, "job vencido há 10min deveria disparar queue_stuck");

    await boss.deleteJob(QUEUE_DOSE_REMINDER, job.id);
    await runOperationalChecks(); // sem mais nada vencido, deveria resolver
    const [resolved] = await db.select().from(operationalAlertsTable).where(eq(operationalAlertsTable.type, "queue_stuck"));
    assert.ok(resolved?.resolvedAt, "apagar o job vencido deveria resolver o alerta");

    await clearAlerts("queue_stuck");
  });

  it("dose agendada numa janela passada sem NENHUM lembrete de nível 0 dispara no_send_window", async () => {
    // Dose "criada" diretamente no banco (não via generateDosesForTreatment,
    // que já enfileiraria o lembrete de verdade) — simula exatamente o caso
    // que o alerta existe pra pegar: agendamento que falhou silenciosamente.
    const [medication2] = await db.insert(medicationsTable).values({ familyId, name: "Medicamento Janela Teste" }).returning();
    const [treatment] = await db.insert(treatmentsTable).values({
      patientId, medicationId: medication2.id, scheduleType: "times_per_day",
      scheduleConfig: { scheduleType: "times_per_day", times: ["08:00"] },
      startDate: Clock.todayInTimezone("America/Sao_Paulo"),
    }).returning();
    const [dose] = await db.insert(scheduledDosesTable).values({
      treatmentId: treatment.id, patientId,
      scheduledAt: new Date(Clock.now().getTime() - 40 * 60_000), // 40min atrás — dentro da janela de checagem (10-70min)
      scheduledLocalDate: Clock.todayInTimezone("America/Sao_Paulo"), scheduledLocalTime: "08:00",
      status: "pending",
    }).returning();

    await runOperationalChecks();
    const [active] = await db.select().from(operationalAlertsTable).where(eq(operationalAlertsTable.type, "no_send_window"));
    assert.ok(active && !active.resolvedAt, "dose de 40min atrás sem nenhum lembrete deveria disparar no_send_window");

    await db.delete(scheduledDosesTable).where(eq(scheduledDosesTable.id, dose.id));
    await db.delete(treatmentsTable).where(eq(treatmentsTable.id, treatment.id));
    await db.delete(medicationsTable).where(eq(medicationsTable.id, medication2.id));

    await runOperationalChecks(); // dose apagada, condição não existe mais
    const [resolved] = await db.select().from(operationalAlertsTable).where(eq(operationalAlertsTable.type, "no_send_window"));
    assert.ok(resolved?.resolvedAt, "apagar a dose sem lembrete deveria resolver o alerta");

    await clearAlerts("no_send_window");
  });

  it("reprocessar com a MESMA condição ainda verdadeira não cria uma segunda linha de alerta", async () => {
    const now = Clock.now();
    await db.insert(notificationsTable).values(
      Array.from({ length: 10 }, (_, i) => ({
        familyId, type: "dose_reminder" as const, title: "ZELO", body: "x", sentAt: now, deliveredAt: i < 2 ? now : null,
      }))
    );

    await runOperationalChecks();
    await runOperationalChecks();
    await runOperationalChecks();

    const rows = await db.select().from(operationalAlertsTable).where(eq(operationalAlertsTable.type, "delivery_rate"));
    assert.equal(rows.length, 1, "3 execuções com a mesma condição — continua exatamente 1 linha de alerta");

    await db.delete(notificationsTable).where(eq(notificationsTable.familyId, familyId));
    await clearAlerts("delivery_rate");
  });
});
