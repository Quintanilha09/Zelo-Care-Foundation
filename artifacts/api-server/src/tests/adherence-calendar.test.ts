/**
 * Testes do calendário de adesão — ZELO (ZELO-33).
 *
 * "Resolvido" (cor do calendário) e "adesão" (percentual) são conceitos
 * diferentes de propósito — testados separadamente. Doses inseridas
 * DIRETO no banco (não via geração real de tratamento) pra controlar
 * precisamente qual status cai em qual dia civil, sem depender do horário
 * real em que o teste roda.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  usersTable, caregiversTable, familiesTable, patientsTable, medicationsTable,
  treatmentsTable, scheduledDosesTable, doseRecordsTable, subscriptionsTable,
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
let patientId: number;
let medicationAId: number;
let medicationBId: number;
let treatmentAId: number;
let treatmentBId: number;
let primaryCaregiverId: number;

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

/** Insere uma dose já com status final, num dia civil específico, sem passar pela geração real. */
async function insertDose(treatmentId: number, localDate: string, status: "pending" | "taken" | "skipped" | "late" | "postponed", localTime = "08:00") {
  const [dose] = await db
    .insert(scheduledDosesTable)
    .values({
      treatmentId, patientId,
      scheduledAt: new Date(`${localDate}T${localTime}:00-03:00`),
      scheduledLocalDate: localDate, scheduledLocalTime: localTime,
      status,
    })
    .returning();
  return dose.id;
}
async function insertDoseRecord(scheduledDoseId: number, outcome: "taken" | "skipped" | "postponed") {
  await db.insert(doseRecordsTable).values({ scheduledDoseId, patientId, caregiverId: primaryCaregiverId, takenAt: Clock.now(), outcome });
}

/**
 * Idempotente (delete-then-insert) de propósito: a maioria dos testes
 * deste arquivo usa datas de anos passados (pra controlar o dia civil sem
 * depender de quando o teste roda de verdade) e SÓ testam a lógica de
 * cor/percentual — não o limite de plano gratuito, que tem describe block
 * próprio. Sem plano pago como padrão, todo teste cairia sob o clamp de 7
 * dias (ver routes/adherence-calendar.ts) e não encontraria nada nas datas
 * inseridas.
 */
async function setPlan(plan: "free" | "basic" | "premium" | null) {
  await db.delete(subscriptionsTable).where(eq(subscriptionsTable.familyId, familyId));
  if (plan) await db.insert(subscriptionsTable).values({ familyId, plan, status: "active" });
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

  const [family] = await db.insert(familiesTable).values({ name: "Família Calendário Teste", slug: `adherence-cal-${Date.now()}` }).returning();
  familyId = family.id;

  const [user] = await db.insert(usersTable).values({ email: `adherence-cal-${Date.now()}@zelo.test`, name: "Cuidador Calendário", passwordHash: await hashPassword("x"), emailVerified: true, status: "active" }).returning();
  const [caregiver] = await db.insert(caregiversTable).values({ familyId, userId: user.id, name: "Cuidador Calendário", role: "primary_caregiver" }).returning();
  primaryCaregiverId = caregiver.id;
  token = generateAccessToken(user.id, familyId, caregiver.id, "primary_caregiver");

  const [patient] = await db.insert(patientsTable).values({ familyId, name: "Paciente Calendário Teste", timezone: "America/Sao_Paulo" }).returning();
  patientId = patient.id;

  const [medA] = await db.insert(medicationsTable).values({ familyId, name: "Medicamento A Calendário" }).returning();
  medicationAId = medA.id;
  const [medB] = await db.insert(medicationsTable).values({ familyId, name: "Medicamento B Calendário" }).returning();
  medicationBId = medB.id;

  const [treatA] = await db.insert(treatmentsTable).values({
    patientId, medicationId: medicationAId, scheduleType: "times_per_day",
    scheduleConfig: { scheduleType: "times_per_day", times: ["08:00"] }, startDate: "2026-01-01",
  }).returning();
  treatmentAId = treatA.id;
  const [treatB] = await db.insert(treatmentsTable).values({
    patientId, medicationId: medicationBId, scheduleType: "times_per_day",
    scheduleConfig: { scheduleType: "times_per_day", times: ["20:00"] }, startDate: "2026-01-01",
  }).returning();
  treatmentBId = treatB.id;

  await setPlan("premium"); // baseline: a maioria dos testes não é sobre o limite de plano
});

after(async () => {
  Clock.reset();
  await closeServer();
  // O registro retroativo de dose (POST /dose-records) liga o pg-boss por
  // baixo (publica QUEUE_DOSE_TAKEN) — sem parar, os timers internos da
  // fila mantêm o processo vivo pra sempre, mesmo com todo teste já tendo
  // passado (mesmo padrão já usado em todo outro arquivo que toca a fila).
  await boss.stop({ graceful: false });
  await db.delete(familiesTable).where(eq(familiesTable.id, familyId));
});

describe("Cores do calendário — verde/âmbar/cinza, nunca vermelho", () => {
  it("dia com todas as doses resolvidas (taken/skipped/postponed) é verde; dia com alguma sem registro é âmbar; dia sem dose é cinza", async () => {
    await insertDose(treatmentAId, "2026-03-01", "taken");
    await insertDose(treatmentBId, "2026-03-01", "skipped"); // dia todo resolvido -> verde

    await insertDose(treatmentAId, "2026-03-02", "taken");
    await insertDose(treatmentBId, "2026-03-02", "pending"); // sobrou 1 sem registro -> âmbar

    await insertDose(treatmentAId, "2026-03-03", "postponed"); // adiada conta como resolvida -> verde

    await insertDose(treatmentAId, "2026-03-04", "late"); // "late" é sem registro -> âmbar

    // 2026-03-05: nenhuma dose -> cinza (não inserido de propósito)

    const res = await api("GET", `/patients/${patientId}/adherence-calendar?from=2026-03-01&to=2026-03-05`);
    assert.equal(res.status, 200);
    const body = res.body as { days: Array<{ date: string; status: string }> };
    const byDate = new Map(body.days.map((d) => [d.date, d.status]));

    assert.equal(byDate.get("2026-03-01"), "green");
    assert.equal(byDate.get("2026-03-02"), "amber");
    assert.equal(byDate.get("2026-03-03"), "green");
    assert.equal(byDate.get("2026-03-04"), "amber");
    assert.equal(byDate.get("2026-03-05"), "gray");

    assert.ok(!body.days.some((d) => (d.status as string) === "red"), "vermelho não pode existir nesta tela, nem como valor possível");
  });
});

describe("Percentual de adesão — taken/total, não resolvido/total", () => {
  it("skipped e postponed contam pra cor verde mas NÃO contam como adesão no percentual", async () => {
    // 1 taken + 1 skipped + 1 postponed = 3 doses, só 1 é adesão de verdade -> 33%, não 100%.
    await insertDose(treatmentAId, "2026-04-01", "taken");
    await insertDose(treatmentAId, "2026-04-02", "skipped");
    await insertDose(treatmentAId, "2026-04-03", "postponed");

    const res = await api("GET", `/patients/${patientId}/adherence-calendar?from=2026-04-01&to=2026-04-03&medicationId=${medicationAId}`);
    const body = res.body as { summary: { totalScheduled: number; adherenceRate: number } };
    assert.equal(body.summary.totalScheduled, 3);
    assert.ok(Math.abs(body.summary.adherenceRate - 1 / 3) < 0.001, `esperava ~33%, veio ${body.summary.adherenceRate}`);
  });

  it("filtro por medicamento recorta tanto o calendário quanto o resumo", async () => {
    await insertDose(treatmentAId, "2026-05-01", "taken");
    await insertDose(treatmentBId, "2026-05-01", "pending"); // só do medicamento B

    const resA = await api("GET", `/patients/${patientId}/adherence-calendar?from=2026-05-01&to=2026-05-01&medicationId=${medicationAId}`);
    const bodyA = resA.body as { days: Array<{ status: string }>; summary: { totalScheduled: number } };
    assert.equal(bodyA.days[0].status, "green", "só olhando o medicamento A, o dia está inteiro resolvido");
    assert.equal(bodyA.summary.totalScheduled, 1);

    const resB = await api("GET", `/patients/${patientId}/adherence-calendar?from=2026-05-01&to=2026-05-01&medicationId=${medicationBId}`);
    const bodyB = resB.body as { days: Array<{ status: string }> };
    assert.equal(bodyB.days[0].status, "amber", "só olhando o medicamento B, o dia tem dose sem registro");
  });

  it("recuperar uma dose retroativamente (via a rota de verdade) atualiza o percentual e a cor do dia", async () => {
    Clock.freezeAt(new Date("2026-06-05T12:00:00-03:00"));
    const doseId = await insertDose(treatmentAId, "2026-06-01", "late", "08:00");

    const before_ = await api("GET", `/patients/${patientId}/adherence-calendar?from=2026-06-01&to=2026-06-01&medicationId=${medicationAId}`);
    const bodyBefore = before_.body as { days: Array<{ status: string }>; summary: { adherenceRate: number | null } };
    assert.equal(bodyBefore.days[0].status, "amber");
    assert.equal(bodyBefore.summary.adherenceRate, 0);

    const record = await api("POST", `/patients/${patientId}/dose-records`, {
      scheduledDoseId: doseId, takenAt: "2026-06-01T08:05:00-03:00", outcome: "taken", justification: "confirmado depois",
    });
    assert.equal(record.status, 201, JSON.stringify(record.body));

    const after_ = await api("GET", `/patients/${patientId}/adherence-calendar?from=2026-06-01&to=2026-06-01&medicationId=${medicationAId}`);
    const bodyAfter = after_.body as { days: Array<{ status: string }>; summary: { adherenceRate: number | null } };
    assert.equal(bodyAfter.days[0].status, "green", "recuperada retroativamente, o dia vira verde");
    assert.equal(bodyAfter.summary.adherenceRate, 1, "percentual bate com o dado bruto atual, não com uma foto congelada de antes");

    Clock.reset();
  });
});

describe("GET /patients/:id/adherence-calendar/day — detalhe", () => {
  it("traz cada dose do dia com horário, medicamento, estado e quem registrou", async () => {
    const doseId = await insertDose(treatmentAId, "2026-07-01", "taken", "09:00");
    await insertDoseRecord(doseId, "taken");

    const res = await api("GET", `/patients/${patientId}/adherence-calendar/day?date=2026-07-01`);
    assert.equal(res.status, 200);
    const body = res.body as { doses: Array<{ scheduledLocalTime: string; medicationName: string; outcome: string; registeredByCaregiverName: string }> };
    const dose = body.doses.find((d) => d.scheduledLocalTime === "09:00");
    assert.ok(dose);
    assert.equal(dose!.medicationName, "Medicamento A Calendário");
    assert.equal(dose!.outcome, "taken");
    assert.equal(dose!.registeredByCaregiverName, "Cuidador Calendário");
  });
});

describe("Plano gratuito — janela de 7 dias, sem parede", () => {
  it("família sem assinatura paga: intervalo pedido maior que 7 dias vem clampado, com planLimited:true", async () => {
    await setPlan(null); // remove a assinatura premium da baseline — simula família sem plano pago
    Clock.freezeAt(new Date("2026-08-15T12:00:00-03:00"));
    const res = await api("GET", `/patients/${patientId}/adherence-calendar?from=2026-07-01&to=2026-08-15`);
    const body = res.body as { from: string; planLimited: boolean };
    assert.equal(body.planLimited, true);
    assert.equal(body.from, "2026-08-09", "clampado pros últimos 7 dias (inclusive hoje)");
    assert.equal(res.status, 200, "nunca bloqueia — 200 com o que pode mostrar, não 402/403");
    Clock.reset();
  });

  it("família com plano pago ativo: mesmo intervalo NÃO é clampado", async () => {
    await setPlan("premium"); // restaura a baseline pro resto do arquivo — nenhum teste depois deste é sobre plano
    Clock.freezeAt(new Date("2026-08-15T12:00:00-03:00"));

    const res = await api("GET", `/patients/${patientId}/adherence-calendar?from=2026-07-01&to=2026-08-15`);
    const body = res.body as { from: string; planLimited: boolean };
    assert.equal(body.planLimited, false);
    assert.equal(body.from, "2026-07-01");

    Clock.reset();
  });
});

describe("Performance — critério de aceite", () => {
  it("90 dias de histórico respondem em menos de 1s", async () => {
    await setPlan("premium"); // idempotente — garante a baseline mesmo se a ordem dos testes mudar
    const rows = [];
    for (let i = 0; i < 90; i++) {
      const d = new Date("2025-01-01T08:00:00-03:00");
      d.setDate(d.getDate() + i);
      const localDate = d.toISOString().slice(0, 10);
      rows.push({
        treatmentId: treatmentAId, patientId, scheduledAt: d,
        scheduledLocalDate: localDate, scheduledLocalTime: "08:00",
        status: (i % 4 === 0 ? "pending" : "taken") as "pending" | "taken",
      });
    }
    await db.insert(scheduledDosesTable).values(rows);

    const start = Date.now();
    const res = await api("GET", `/patients/${patientId}/adherence-calendar?from=2025-01-01&to=${rows[89].scheduledLocalDate}`);
    const elapsedMs = Date.now() - start;

    assert.equal(res.status, 200);
    assert.ok(elapsedMs < 1000, `deveria responder em menos de 1s, levou ${elapsedMs}ms`);
  });
});

describe("Sem linguagem de culpa na cópia da tela", () => {
  it("AdherenceCalendarPage.tsx nunca usa frases de culpa — sempre 'sem registro', nunca 'perdeu'/'falhou'", () => {
    const path = fileURLToPath(new URL("../../../zelo/src/pages/AdherenceCalendarPage.tsx", import.meta.url));
    const source = readFileSync(path, "utf-8");
    const forbidden = ["você perdeu", "voce perdeu", "falhou em registrar", "não cumpriu", "nao cumpriu"];
    for (const phrase of forbidden) {
      assert.ok(!source.toLowerCase().includes(phrase), `cópia não pode conter "${phrase}"`);
    }
  });
});
