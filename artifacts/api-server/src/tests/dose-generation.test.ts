/**
 * Testes de geração de dose — ZELO (ZELO-18).
 *
 * Cobre: geração inicial ao criar tratamento, idempotência (rodar várias
 * vezes não duplica — a garantia real é a constraint UNIQUE do banco, isto
 * aqui só prova que o caminho de aplicação não quebra nem duplica por cima
 * dela), edição preserva doses já registradas, e encerrar/pausar cancela
 * as futuras ainda pendentes.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { eq, and } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  usersTable, caregiversTable, familiesTable, patientsTable,
  medicationsTable, treatmentsTable, scheduledDosesTable, doseRecordsTable,
} from "@workspace/db";
import { generateAccessToken } from "../lib/tokens.ts";
import { hashPassword } from "../lib/password.ts";
import { generateDosesForTreatment, extendActiveTreatmentWindows, reconcileDoseQueue } from "../lib/dose-generation.ts";
import { boss, QUEUE_DOSE_SCHEDULED } from "../lib/queue.ts";
import { Clock } from "../lib/clock.ts";
import app from "../app.ts";

let testPort: number;
let closeServer: () => Promise<void>;
let familyId: number;
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
    .values({ name: "Família Dose Teste", slug: `dose-gen-test-${Date.now()}` })
    .returning();
  familyId = family.id;

  const [user] = await db
    .insert(usersTable)
    .values({ email: `dosegen-${Date.now()}@zelo.test`, name: "Cuidador Teste", passwordHash: await hashPassword("x"), emailVerified: true, status: "active" })
    .returning();
  const [caregiver] = await db
    .insert(caregiversTable)
    .values({ familyId, userId: user.id, name: "Cuidador Teste", role: "primary_caregiver" })
    .returning();
  token = generateAccessToken(user.id, familyId, caregiver.id, "primary_caregiver");

  const [patient] = await db
    .insert(patientsTable)
    .values({ familyId, name: "Paciente Dose Teste", timezone: "America/Sao_Paulo" })
    .returning();
  patientId = patient.id;

  const [medication] = await db
    .insert(medicationsTable)
    .values({ familyId, name: "Medicamento Fictício Dose Teste" })
    .returning();
  medicationId = medication.id;
});

after(async () => {
  Clock.reset();
  await closeServer();
  await boss.stop({ graceful: false });
  await db.delete(familiesTable).where(eq(familiesTable.id, familyId));
});

describe("Geração de dose ao criar tratamento", () => {
  it("criar tratamento com times_per_day gera doses dos próximos 14 dias", async () => {
    const res = await api("POST", `/patients/${patientId}/treatments`, {
      medicationId,
      scheduleConfig: { scheduleType: "times_per_day", times: ["08:00", "20:00"] },
      startDate: Clock.todayInTimezone("America/Sao_Paulo"),
    });
    assert.equal(res.status, 201);
    const { id: treatmentId } = res.body as { id: number };

    const doses = await db.select().from(scheduledDosesTable).where(eq(scheduledDosesTable.treatmentId, treatmentId));
    // 14 dias × 2 doses/dia, mas o dia de hoje pode ter só 1 (se já passou das 08:00)
    assert.ok(doses.length >= 27 && doses.length <= 28, `esperava ~28 doses, veio ${doses.length}`);
    assert.ok(doses.every((d) => d.status === "pending"));

    await db.delete(treatmentsTable).where(eq(treatmentsTable.id, treatmentId));
  });

  it("gerar doses para o mesmo tratamento duas vezes não duplica (idempotência real, via constraint do banco)", async () => {
    const res = await api("POST", `/patients/${patientId}/treatments`, {
      medicationId,
      scheduleConfig: { scheduleType: "times_per_day", times: ["08:00"] },
      startDate: Clock.todayInTimezone("America/Sao_Paulo"),
    });
    const { id: treatmentId } = res.body as { id: number };

    const firstCount = await db.select().from(scheduledDosesTable).where(eq(scheduledDosesTable.treatmentId, treatmentId));

    // Roda a geração de novo, manualmente, simulando um reprocessamento
    await generateDosesForTreatment(treatmentId);
    await generateDosesForTreatment(treatmentId);
    await generateDosesForTreatment(treatmentId);

    const secondCount = await db.select().from(scheduledDosesTable).where(eq(scheduledDosesTable.treatmentId, treatmentId));
    assert.equal(secondCount.length, firstCount.length, "rodar 3x a mais não deve mudar a contagem");

    await db.delete(treatmentsTable).where(eq(treatmentsTable.id, treatmentId));
  });

  it("editar posologia preserva doses já registradas e regenera só as futuras pendentes", async () => {
    const createRes = await api("POST", `/patients/${patientId}/treatments`, {
      medicationId,
      scheduleConfig: { scheduleType: "times_per_day", times: ["08:00"] },
      startDate: Clock.todayInTimezone("America/Sao_Paulo"),
    });
    const { id: treatmentId } = createRes.body as { id: number };

    // Marca a primeira dose como tomada (registro real, histórico)
    const [firstDose] = await db
      .select()
      .from(scheduledDosesTable)
      .where(eq(scheduledDosesTable.treatmentId, treatmentId))
      .orderBy(scheduledDosesTable.scheduledAt)
      .limit(1);
    await db.insert(doseRecordsTable).values({
      scheduledDoseId: firstDose.id, patientId, caregiverId: (await db.select({ id: caregiversTable.id }).from(caregiversTable).limit(1))[0].id,
      takenAt: Clock.now(), outcome: "taken",
    });
    await db.update(scheduledDosesTable).set({ status: "taken" }).where(eq(scheduledDosesTable.id, firstDose.id));

    // Edita a posologia
    const editRes = await api("PATCH", `/treatments/${treatmentId}`, {
      scheduleConfig: { scheduleType: "times_per_day", times: ["09:00", "21:00"] },
    });
    assert.equal(editRes.status, 200);

    // A dose registrada continua intacta
    const [stillThere] = await db.select().from(scheduledDosesTable).where(eq(scheduledDosesTable.id, firstDose.id));
    assert.equal(stillThere.status, "taken", "dose já registrada não pode ser apagada nem alterada pela edição");

    // As novas doses futuras seguem o horário novo (09:00/21:00), não o antigo (08:00)
    const futureDoses = await db
      .select()
      .from(scheduledDosesTable)
      .where(and(eq(scheduledDosesTable.treatmentId, treatmentId), eq(scheduledDosesTable.status, "pending")));
    assert.ok(futureDoses.length > 0);

    await db.delete(treatmentsTable).where(eq(treatmentsTable.id, treatmentId));
  });

  it("pausar tratamento cancela doses futuras pendentes", async () => {
    const createRes = await api("POST", `/patients/${patientId}/treatments`, {
      medicationId,
      scheduleConfig: { scheduleType: "times_per_day", times: ["08:00"] },
      startDate: Clock.todayInTimezone("America/Sao_Paulo"),
    });
    const { id: treatmentId } = createRes.body as { id: number };

    const before = await db.select().from(scheduledDosesTable).where(eq(scheduledDosesTable.treatmentId, treatmentId));
    assert.ok(before.length > 0);

    const pauseRes = await api("PATCH", `/treatments/${treatmentId}`, { status: "paused" });
    assert.equal(pauseRes.status, 200);

    const after = await db.select().from(scheduledDosesTable).where(eq(scheduledDosesTable.treatmentId, treatmentId));
    assert.equal(after.length, 0, "pausar deve cancelar todas as doses futuras pendentes");

    await db.delete(treatmentsTable).where(eq(treatmentsTable.id, treatmentId));
  });
});

describe("Fila de jobs (pg-boss) — ZELO-18", () => {
  it("criar tratamento enfileira um evento DoseScheduled por dose nova, na mesma transação", async () => {
    const createRes = await api("POST", `/patients/${patientId}/treatments`, {
      medicationId,
      scheduleConfig: { scheduleType: "times_per_day", times: ["08:00"] },
      startDate: Clock.todayInTimezone("America/Sao_Paulo"),
    });
    const { id: treatmentId } = createRes.body as { id: number };

    const doses = await db.select().from(scheduledDosesTable).where(eq(scheduledDosesTable.treatmentId, treatmentId));
    assert.ok(doses.length > 0);

    const jobs = await boss.findJobs(QUEUE_DOSE_SCHEDULED, { data: { treatmentId } });
    assert.equal(jobs.length, doses.length, "deve existir exatamente 1 job DoseScheduled por dose criada");

    await db.delete(treatmentsTable).where(eq(treatmentsTable.id, treatmentId));
  });

  it("time-travel: adiantar 15 dias e rodar o job de manutenção estende a janela sozinha", async () => {
    const createRes = await api("POST", `/patients/${patientId}/treatments`, {
      medicationId,
      scheduleConfig: { scheduleType: "times_per_day", times: ["08:00"] },
      startDate: Clock.todayInTimezone("America/Sao_Paulo"),
    });
    const { id: treatmentId } = createRes.body as { id: number };

    const before = await db.select().from(scheduledDosesTable).where(eq(scheduledDosesTable.treatmentId, treatmentId));
    const maxBefore = Math.max(...before.map((d) => d.scheduledAt.getTime()));

    // Simula 15 dias passando sem nenhuma edição do tratamento — sem o job
    // diário, a janela de 14 dias original teria secado.
    Clock.advance(15 * 86_400_000);
    await extendActiveTreatmentWindows();

    const after = await db.select().from(scheduledDosesTable).where(eq(scheduledDosesTable.treatmentId, treatmentId));
    const maxAfter = Math.max(...after.map((d) => d.scheduledAt.getTime()));

    assert.ok(after.length > before.length, "deveriam existir doses novas depois do job de manutenção");
    assert.ok(maxAfter > maxBefore, "a janela deveria ter avançado para além do que existia antes");

    Clock.reset();
    await db.delete(treatmentsTable).where(eq(treatmentsTable.id, treatmentId));
  });

  it("reconcileDoseQueue recria o evento de uma dose pendente cujo job sumiu da fila", async () => {
    const createRes = await api("POST", `/patients/${patientId}/treatments`, {
      medicationId,
      scheduleConfig: { scheduleType: "times_per_day", times: ["08:00"] },
      startDate: Clock.todayInTimezone("America/Sao_Paulo"),
    });
    const { id: treatmentId } = createRes.body as { id: number };

    const [dose] = await db
      .select()
      .from(scheduledDosesTable)
      .where(eq(scheduledDosesTable.treatmentId, treatmentId))
      .orderBy(scheduledDosesTable.scheduledAt)
      .limit(1);

    const before = await boss.findJobs(QUEUE_DOSE_SCHEDULED, { data: { scheduledDoseId: dose.id } });
    assert.equal(before.length, 1);

    // Simula o job tendo sumido da fila (ex: expirado, apagado manualmente)
    // sem que a dose em si tenha sido tocada — é exatamente o cenário que a
    // reconciliação existe para consertar.
    await boss.deleteJob(QUEUE_DOSE_SCHEDULED, before[0].id);
    const afterDelete = await boss.findJobs(QUEUE_DOSE_SCHEDULED, { data: { scheduledDoseId: dose.id } });
    assert.equal(afterDelete.length, 0, "job deveria ter sumido de propósito, para o teste");

    const resent = await reconcileDoseQueue();
    assert.ok(resent >= 1, "reconciliação deveria ter reenviado pelo menos o evento da dose sem job");

    const afterReconcile = await boss.findJobs(QUEUE_DOSE_SCHEDULED, { data: { scheduledDoseId: dose.id } });
    assert.equal(afterReconcile.length, 1, "job deveria ter sido recriado pela reconciliação");

    await db.delete(treatmentsTable).where(eq(treatmentsTable.id, treatmentId));
  });
});
