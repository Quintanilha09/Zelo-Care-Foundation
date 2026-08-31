/**
 * Testes dos tiers de plano e do painel do dia consolidado — ZELO-56/57.
 *
 * ZELO-56: os limites deixaram de ser dois (grátis/pago) e viraram uma
 * tabela de N tiers. O que estes testes travam é o mapeamento
 * assinatura → tier → limites aplicado NO SERVIDOR, e a regra que a
 * revisão da ZELO-38 fixou: nada que proteja a segurança do paciente
 * entra em paywall, em nenhum tier.
 *
 * ZELO-57: o painel consolidado precisa ordenar por urgência (não por
 * desempenho) e não pode fazer uma consulta por paciente.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { eq } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  usersTable, caregiversTable, familiesTable, patientsTable, medicationsTable,
  subscriptionsTable, treatmentsTable, scheduledDosesTable,
} from "@workspace/db";
import { generateAccessToken } from "../lib/tokens.ts";
import { hashPassword } from "../lib/password.ts";
import { boss } from "../lib/queue.ts";
import { Clock } from "../lib/clock.ts";
import app from "../app.ts";

let testPort: number;
let closeServer: () => Promise<void>;
let familyId: number;
let token: string;
let medicationId: number;

async function api(method: string, path: string, body?: unknown): Promise<{ status: number; body: unknown }> {
  const payload = body !== undefined ? JSON.stringify(body) : undefined;
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: "127.0.0.1", port: testPort, path: `/api${path}`, method,
        headers: {
          "Content-Type": "application/json", Authorization: `Bearer ${token}`,
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

async function setPlan(plan: "free" | "premium" | "professional" | null): Promise<void> {
  await db.delete(subscriptionsTable).where(eq(subscriptionsTable.familyId, familyId));
  if (plan) await db.insert(subscriptionsTable).values({ familyId, plan, status: "active" });
}

async function createPatient(name: string): Promise<{ status: number; body: unknown }> {
  return api("POST", "/patients", {
    name, timezone: "America/Sao_Paulo",
    healthConsent: { givenBy: "legal_representative", version: "v1.0" },
  });
}

async function cleanupPatients(): Promise<void> {
  await db.delete(patientsTable).where(eq(patientsTable.familyId, familyId));
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

  const [family] = await db.insert(familiesTable).values({ name: "Família Tiers Teste", slug: `tiers-${Date.now()}` }).returning();
  familyId = family.id;
  const [user] = await db.insert(usersTable).values({ email: `tiers-${Date.now()}@zelo.test`, name: "Cuidador", passwordHash: await hashPassword("x"), emailVerified: true, status: "active" }).returning();
  const [caregiver] = await db.insert(caregiversTable).values({ familyId, userId: user.id, name: "Cuidador", role: "primary_caregiver" }).returning();
  token = generateAccessToken(user.id, familyId, caregiver.id, "primary_caregiver");
  const [med] = await db.insert(medicationsTable).values({ familyId, name: "Medicamento Tiers" }).returning();
  medicationId = med.id;
});

after(async () => {
  Clock.reset();
  await closeServer();
  await boss.stop({ graceful: false });
  await db.delete(familiesTable).where(eq(familiesTable.id, familyId));
});

describe("ZELO-56 — tiers de plano", () => {
  it("sem assinatura resolve pro gratuito (1 paciente)", async () => {
    await setPlan(null);
    const me = await api("GET", "/account/me");
    const plan = (me.body as { plan: { tier: string; label: string; limits: { maxPatients: number } } }).plan;
    assert.equal(plan.tier, "free");
    assert.equal(plan.label, "Grátis");
    assert.equal(plan.limits.maxPatients, 1);
    await cleanupPatients();
  });

  it("assinatura premium resolve pro Família (5 pacientes)", async () => {
    await setPlan("premium");
    const me = await api("GET", "/account/me");
    const plan = (me.body as { plan: { tier: string; label: string; isPaid: boolean; limits: { maxPatients: number } } }).plan;
    assert.equal(plan.tier, "family");
    assert.equal(plan.label, "Família");
    assert.equal(plan.isPaid, true);
    assert.equal(plan.limits.maxPatients, 5);
    await setPlan(null);
    await cleanupPatients();
  });

  it("assinatura professional resolve pro Profissional (15 pacientes)", async () => {
    await setPlan("professional");
    const me = await api("GET", "/account/me");
    const plan = (me.body as { plan: { tier: string; label: string; limits: { maxPatients: number } } }).plan;
    assert.equal(plan.tier, "professional");
    assert.equal(plan.label, "Profissional");
    assert.equal(plan.limits.maxPatients, 15);
    await setPlan(null);
    await cleanupPatients();
  });

  it("assinatura cancelada cai pro gratuito, mesmo sendo plano pago", async () => {
    await db.delete(subscriptionsTable).where(eq(subscriptionsTable.familyId, familyId));
    await db.insert(subscriptionsTable).values({ familyId, plan: "professional", status: "cancelled" });
    const me = await api("GET", "/account/me");
    assert.equal((me.body as { plan: { tier: string } }).plan.tier, "free");
    await setPlan(null);
    await cleanupPatients();
  });

  it("o limite de 15 do Profissional é aplicado no servidor, e a mensagem oferece o caminho institucional", async () => {
    await setPlan("professional");
    // 15 cabem
    for (let i = 1; i <= 15; i++) {
      const res = await createPatient(`Paciente ${String(i).padStart(2, "0")}`);
      assert.equal(res.status, 201, `paciente ${i} deveria caber no Profissional`);
    }
    // o 16º não
    const excedente = await createPatient("Paciente 16");
    assert.equal(excedente.status, 403);
    const body = excedente.body as { error: string; code: string };
    assert.equal(body.code, "PLAN_LIMIT");
    assert.match(body.error, /15 pacientes/);
    assert.match(body.error, /institui/i, "no maior tier contratável, a saída oferecida é o atendimento institucional, não um upgrade");

    await setPlan("premium");
    await cleanupPatients();
    await setPlan(null);
  });

  it("no Família cheio, a mensagem oferece o Profissional — não repete 'Família'", async () => {
    await setPlan("premium");
    for (let i = 1; i <= 5; i++) {
      const res = await createPatient(`Fam ${i}`);
      assert.equal(res.status, 201);
    }
    const excedente = await createPatient("Fam 6");
    assert.equal(excedente.status, 403);
    assert.match((excedente.body as { error: string }).error, /Profissional libera até 15/);

    await cleanupPatients();
    await setPlan(null);
  });

  it("registrar dose continua liberado em qualquer tier, inclusive no paciente excedente", async () => {
    await setPlan("professional");
    const p1 = await createPatient("Primeiro");
    const p2 = await createPatient("Segundo");
    const patient2Id = (p2.body as { id: number }).id;
    void p1;

    const [treatment] = await db.insert(treatmentsTable).values({
      patientId: patient2Id, medicationId, scheduleType: "times_per_day",
      scheduleConfig: { scheduleType: "times_per_day", times: ["08:00"] },
      startDate: Clock.todayInTimezone("America/Sao_Paulo"),
    }).returning();
    const [dose] = await db.insert(scheduledDosesTable).values({
      treatmentId: treatment.id, patientId: patient2Id, scheduledAt: Clock.now(),
      scheduledLocalDate: Clock.todayInTimezone("America/Sao_Paulo"),
      scheduledLocalTime: "08:00", status: "pending",
    }).returning();

    // downgrade: no gratuito o "Segundo" vira excedente
    await setPlan(null);

    const res = await api("POST", `/patients/${patient2Id}/dose-records`, {
      scheduledDoseId: dose.id, outcome: "taken",
    });
    assert.equal(res.status, 201, "segurança do paciente nunca entra em paywall, em nenhum tier");

    await setPlan("premium");
    await cleanupPatients();
    await setPlan(null);
  });
});

describe("ZELO-57 — painel do dia consolidado", () => {
  it("ordena por urgência: sem registro primeiro, depois dose para agora, depois o resto", async () => {
    // ── Relógio congelado ao meio-dia, e não por capricho — Issue #41 ──────
    //
    // Este teste monta a dose "sem registro" em `agora - 1 hora`, e o painel
    // filtra as doses pela janela do DIA CIVIL do paciente (dashboard.ts).
    //
    // Rodando às 00:09 de Brasília — que foi o que o CI fez em 31/08/2026 —
    // "agora menos uma hora" é 23:09 do dia ANTERIOR. A dose sai da janela, a
    // paciente perde o `missedDoses`, despenca na ordenação, e o teste reprova
    // acusando o painel de um defeito que é do dado de teste.
    //
    // O painel está certo em olhar o dia civil de quem é cuidado. Quem
    // precisava parar de depender da hora era o teste: em 23 das 24 horas ele
    // passava, e na vigésima quarta bloqueava qualquer PR.
    //
    // Meio-dia UTC é meio-dia menos três em São Paulo — nove da manhã, longe
    // das duas bordas do dia.
    const meioDia = new Date(`${Clock.todayUtc()}T12:00:00.000Z`);
    Clock.freezeAt(meioDia);

    await setPlan("professional");

    const tranquilo = (await createPatient("Zulmira Tranquila")).body as { id: number };
    const comDoseAgora = (await createPatient("Bruno Agora")).body as { id: number };
    const semRegistro = (await createPatient("Ana Sem Registro")).body as { id: number };

    const hoje = Clock.todayInTimezone("America/Sao_Paulo");
    async function addDose(patientId: number, status: "pending" | "late", at: Date) {
      const [t] = await db.insert(treatmentsTable).values({
        patientId, medicationId, scheduleType: "times_per_day",
        scheduleConfig: { scheduleType: "times_per_day", times: ["08:00"] }, startDate: hoje,
      }).returning();
      await db.insert(scheduledDosesTable).values({
        treatmentId: t.id, patientId, scheduledAt: at,
        scheduledLocalDate: hoje, scheduledLocalTime: "08:00", status,
      });
    }

    // "late" = ficou sem registro; "pending" no passado = dose para agora
    await addDose(semRegistro.id, "late", new Date(Clock.now().getTime() - 3_600_000));
    await addDose(comDoseAgora.id, "pending", new Date(Clock.now().getTime() - 60_000));
    // paciente tranquilo: nenhuma dose hoje

    const res = await api("GET", "/dashboard/today-summary");
    assert.equal(res.status, 200);
    const list = (res.body as { patients: Array<{ patientId: number; patientName: string; missedDoses: number; dueNowDoses: number }> }).patients;

    assert.equal(list[0].patientId, semRegistro.id, "quem tem dose sem registro vem primeiro");
    assert.equal(list[0].missedDoses, 1);
    assert.equal(list[1].patientId, comDoseAgora.id, "depois quem tem dose para agora");
    assert.equal(list[1].dueNowDoses, 1);
    assert.equal(list[2].patientId, tranquilo.id, "quem está tranquilo vem por último, mesmo com nome no começo do alfabeto");

    await cleanupPatients();
    await setPlan(null);
    Clock.reset();
  });

  it("nunca devolve percentual de adesão nem nota por paciente — a tela não é um placar", async () => {
    await setPlan("professional");
    await createPatient("Paciente Sem Nota");

    const res = await api("GET", "/dashboard/today-summary");
    const raw = JSON.stringify(res.body);
    for (const proibido of ["adherenceRate", "adherence", "percent", "score", "rank"]) {
      assert.ok(!raw.includes(proibido), `a resposta não pode conter "${proibido}" — ranquear pacientes é o oposto do produto`);
    }

    await cleanupPatients();
    await setPlan(null);
  });

  it("responde rápido com 15 pacientes — o número de consultas não cresce com N", async () => {
    await setPlan("professional");
    for (let i = 1; i <= 15; i++) await createPatient(`Paciente Perf ${String(i).padStart(2, "0")}`);

    const started = Date.now();
    const res = await api("GET", "/dashboard/today-summary");
    const elapsed = Date.now() - started;

    assert.equal(res.status, 200);
    assert.equal((res.body as { patients: unknown[] }).patients.length, 15);
    assert.ok(elapsed < 1000, `painel com 15 pacientes levou ${elapsed}ms — sinal de consulta por paciente (N+1)`);

    await cleanupPatients();
    await setPlan(null);
  });

  it("isolamento: só aparecem pacientes da família do token", async () => {
    await setPlan("professional");
    await createPatient("Da Minha Família");

    const [outraFamilia] = await db.insert(familiesTable).values({ name: "Outra", slug: `tiers-outra-${Date.now()}` }).returning();
    await db.insert(patientsTable).values({ familyId: outraFamilia.id, name: "De Outra Família", timezone: "America/Sao_Paulo" });

    const res = await api("GET", "/dashboard/today-summary");
    const nomes = (res.body as { patients: Array<{ patientName: string }> }).patients.map((p) => p.patientName);
    assert.ok(nomes.includes("Da Minha Família"));
    assert.ok(!nomes.includes("De Outra Família"), "paciente de outra família nunca pode aparecer");

    await db.delete(familiesTable).where(eq(familiesTable.id, outraFamilia.id));
    await cleanupPatients();
    await setPlan(null);
  });
});
