/**
 * Testes de ciclo de vida de tratamento — ZELO (ZELO-20).
 *
 * Cobre os 3 critérios de aceite: time-travel encerra e para de gerar dose;
 * aviso de encerramento sem recomendação clínica; histórico continua
 * acessível. Mais: aviso de véspera é idempotente, lembrete de revisão
 * contínua dispara e é resetado por ack, e reativar regenera doses.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { eq } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  usersTable, caregiversTable, familiesTable, patientsTable,
  medicationsTable, treatmentsTable, scheduledDosesTable, notificationsTable,
} from "@workspace/db";
import { tomorrowInTimezone } from "@workspace/scheduling";
import { generateAccessToken } from "../lib/tokens.ts";
import { hashPassword } from "../lib/password.ts";
import { boss } from "../lib/queue.ts";
import { Clock } from "../lib/clock.ts";
import {
  closeExpiredTreatments, sendEndingSoonNotices, sendContinuousReviewReminders, REVIEW_INTERVAL_DAYS,
} from "../lib/treatment-lifecycle.ts";
import app from "../app.ts";

let testPort: number;
let closeServer: () => Promise<void>;
let familyId: number;
let token: string;
let medicationId: number;

// Nenhuma mensagem de ciclo de vida pode conter recomendação clínica — só
// fato neutro. Lista de termos que NUNCA podem aparecer. "Confirme com o
// médico se deve continuar" (texto oficial da spec) é uma pergunta dirigida
// ao médico, não uma opinião do app — por isso o bloqueio é em frases que
// dão a opinião diretamente ("você pode parar"), não em "deve" isolado.
const FORBIDDEN_CLINICAL_PHRASES = [
  "você pode parar", "não continue", "você deve parar", "pode continuar sem",
  "recomendamos", "sugerimos", "é seguro", "não é seguro", "interrompa o tratamento",
];

function assertNoClinicalLanguage(text: string) {
  const lower = text.toLowerCase();
  for (const phrase of FORBIDDEN_CLINICAL_PHRASES) {
    assert.ok(!lower.includes(phrase), `mensagem não pode conter "${phrase}": "${text}"`);
  }
}

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

async function createPatient(name: string) {
  const res = await api("POST", "/patients", {
    name, timezone: "America/Sao_Paulo",
    healthConsent: { givenBy: "self", version: "1.0" },
  });
  return (res.body as { id: number }).id;
}

async function createTreatment(patientId: number, endDate: string | null) {
  const res = await api("POST", `/patients/${patientId}/treatments`, {
    medicationId,
    scheduleConfig: { scheduleType: "times_per_day", times: ["08:00"] },
    startDate: Clock.todayInTimezone("America/Sao_Paulo"),
    endDate,
  });
  return (res.body as { id: number }).id;
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
    .values({ name: "Família Ciclo de Vida Teste", slug: `lifecycle-test-${Date.now()}` })
    .returning();
  familyId = family.id;

  const [user] = await db
    .insert(usersTable)
    .values({ email: `lifecycle-${Date.now()}@zelo.test`, name: "Cuidador Teste", passwordHash: await hashPassword("x"), emailVerified: true, status: "active" })
    .returning();
  const [caregiver] = await db
    .insert(caregiversTable)
    .values({ familyId, userId: user.id, name: "Cuidador Teste", role: "primary_caregiver" })
    .returning();
  token = generateAccessToken(user.id, familyId, caregiver.id, "primary_caregiver");

  const [medication] = await db
    .insert(medicationsTable)
    .values({ familyId, name: "Medicamento Fictício Ciclo de Vida" })
    .returning();
  medicationId = medication.id;
});

after(async () => {
  Clock.reset();
  await closeServer();
  await boss.stop({ graceful: false });
  await db.delete(familiesTable).where(eq(familiesTable.id, familyId));
});

// closeExpiredTreatments/sendEndingSoonNotices/sendContinuousReviewReminders
// são jobs GLOBAIS (varrem todo tratamento ativo do banco, não só desta
// família) — por isso todo teste abaixo limpa seus próprios paciente e
// tratamento no final, e as asserções sobre a contagem de retorno usam
// ">= 1" em vez de igualdade exata, pra não quebrar se sobrar algo de fora.

describe("closeExpiredTreatments — encerramento automático", () => {
  it("time-travel até depois da data final encerra o tratamento e para de gerar dose", async () => {
    const patientId = await createPatient("Paciente Antibiótico");
    const endDate = Clock.todayInTimezone("America/Sao_Paulo"); // termina hoje
    const treatmentId = await createTreatment(patientId, endDate);

    // Ainda no dia final: continua ativo, doses do próprio dia existem.
    await closeExpiredTreatments();
    const [stillActive] = await db.select().from(treatmentsTable).where(eq(treatmentsTable.id, treatmentId));
    assert.equal(stillActive.status, "active", "não deve fechar no próprio dia final");

    // Adianta 2 dias — já passou da data final.
    Clock.advance(2 * 86_400_000);
    const closedAfter = await closeExpiredTreatments();
    assert.ok(closedAfter >= 1);

    const [finished] = await db.select().from(treatmentsTable).where(eq(treatmentsTable.id, treatmentId));
    assert.equal(finished.status, "finished");

    const futureDoses = await db
      .select()
      .from(scheduledDosesTable)
      .where(eq(scheduledDosesTable.treatmentId, treatmentId));
    assert.equal(futureDoses.filter((d) => d.status === "pending").length, 0, "não pode sobrar dose pendente após encerrar");

    const [notif] = await db
      .select()
      .from(notificationsTable)
      .where(eq(notificationsTable.treatmentId, treatmentId));
    assert.equal(notif.type, "treatment_ending");
    assertNoClinicalLanguage(notif.body!);

    Clock.reset();
    await db.delete(treatmentsTable).where(eq(treatmentsTable.id, treatmentId));
    await db.delete(patientsTable).where(eq(patientsTable.id, patientId));
  });

  it("histórico do tratamento encerrado continua acessível e íntegro", async () => {
    const patientId = await createPatient("Paciente Historico Preservado");
    const endDate = Clock.todayInTimezone("America/Sao_Paulo");
    const treatmentId = await createTreatment(patientId, endDate);

    Clock.advance(2 * 86_400_000);
    await closeExpiredTreatments();

    const getRes = await api("GET", `/treatments/${treatmentId}`);
    assert.equal(getRes.status, 200);
    const treatment = getRes.body as { status: string; id: number };
    assert.equal(treatment.status, "finished");
    assert.equal(treatment.id, treatmentId);

    const listRes = await api("GET", `/patients/${patientId}/treatments`);
    const list = listRes.body as Array<{ id: number }>;
    assert.ok(list.some((t) => t.id === treatmentId), "tratamento encerrado continua na listagem (histórico), não é apagado");

    Clock.reset();
    await db.delete(treatmentsTable).where(eq(treatmentsTable.id, treatmentId));
    await db.delete(patientsTable).where(eq(patientsTable.id, patientId));
  });
});

describe("sendEndingSoonNotices — aviso de véspera", () => {
  it("avisa uma vez quando falta 1 dia, texto neutro, e não repete no dia seguinte de novo", async () => {
    const patientId = await createPatient("Paciente Vespera");
    const tomorrow = tomorrowInTimezone(Clock.now(), "America/Sao_Paulo");
    const treatmentId = await createTreatment(patientId, tomorrow);

    const sentFirst = await sendEndingSoonNotices();
    assert.ok(sentFirst >= 1);

    const notifs = await db.select().from(notificationsTable).where(eq(notificationsTable.treatmentId, treatmentId));
    assert.equal(notifs.length, 1);
    assert.equal(notifs[0].body, `O tratamento com Medicamento Fictício Ciclo de Vida termina amanhã. Confirme com o médico se deve continuar.`);
    assertNoClinicalLanguage(notifs[0].body!);

    // Rodar de novo no mesmo dia não deve duplicar — endingNoticeSentAt já setado.
    await sendEndingSoonNotices();
    const notifsAfter = await db.select().from(notificationsTable).where(eq(notificationsTable.treatmentId, treatmentId));
    assert.equal(notifsAfter.length, 1, "não pode reenviar o aviso de véspera uma segunda vez");

    await db.delete(treatmentsTable).where(eq(treatmentsTable.id, treatmentId));
    await db.delete(patientsTable).where(eq(patientsTable.id, patientId));
  });
});

describe("sendContinuousReviewReminders — revisão de tratamento contínuo", () => {
  it("lembra depois de ~6 meses, e confirmar (ack) reinicia a contagem", async () => {
    const patientId = await createPatient("Paciente Continuo");
    const treatmentId = await createTreatment(patientId, null); // sem data de fim = contínuo

    await sendContinuousReviewReminders();
    const notifsBefore = await db.select().from(notificationsTable).where(eq(notificationsTable.treatmentId, treatmentId));
    assert.equal(notifsBefore.length, 0, "não deve lembrar antes de 6 meses");

    Clock.advance((REVIEW_INTERVAL_DAYS + 1) * 86_400_000);
    await sendContinuousReviewReminders();

    const [notif] = await db.select().from(notificationsTable).where(eq(notificationsTable.treatmentId, treatmentId));
    assert.equal(notif.type, "continuous_review");
    assertNoClinicalLanguage(notif.body!);
    assert.ok(notif.body!.includes("vale conferir a receita"));

    // Confirmar a notificação (ack) reinicia a contagem — rodar de novo não deve lembrar de novo.
    await api("POST", `/notifications/${notif.id}/ack`);
    await sendContinuousReviewReminders();
    const [treatmentAfterAck] = await db.select().from(treatmentsTable).where(eq(treatmentsTable.id, treatmentId));
    assert.ok(treatmentAfterAck.lastReviewedAt, "ack deve preencher lastReviewedAt");

    const notifsAfterAck = await db.select().from(notificationsTable).where(eq(notificationsTable.treatmentId, treatmentId));
    assert.equal(notifsAfterAck.length, 1, "logo após confirmar, não deve lembrar de novo");

    Clock.reset();
    await db.delete(treatmentsTable).where(eq(treatmentsTable.id, treatmentId));
    await db.delete(patientsTable).where(eq(patientsTable.id, patientId));
  });
});

describe("Reativar tratamento encerrado — ZELO-20", () => {
  it("PATCH status=active regenera as doses futuras", async () => {
    const patientId = await createPatient("Paciente Reativado");
    const endDate = Clock.todayInTimezone("America/Sao_Paulo");
    const treatmentId = await createTreatment(patientId, endDate);

    Clock.advance(2 * 86_400_000);
    await closeExpiredTreatments();
    const [finished] = await db.select().from(treatmentsTable).where(eq(treatmentsTable.id, treatmentId));
    assert.equal(finished.status, "finished");

    const newEnd = new Date(Clock.now().getTime() + 30 * 86_400_000).toISOString().slice(0, 10);
    const patchRes = await api("PATCH", `/treatments/${treatmentId}`, { status: "active", endDate: newEnd });
    assert.equal(patchRes.status, 200);

    const dosesAfter = await db
      .select()
      .from(scheduledDosesTable)
      .where(eq(scheduledDosesTable.treatmentId, treatmentId));
    assert.ok(dosesAfter.some((d) => d.status === "pending"), "reativar deve regenerar doses futuras pendentes");

    Clock.reset();
    await db.delete(treatmentsTable).where(eq(treatmentsTable.id, treatmentId));
    await db.delete(patientsTable).where(eq(patientsTable.id, patientId));
  });
});
