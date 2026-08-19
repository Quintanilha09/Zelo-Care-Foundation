/**
 * Testes de estoque e alerta calmo de reposição — ZELO (ZELO-34).
 *
 * "Dias restantes" vem da POSOLOGIA PRESCRITA (via expandSchedule, o
 * mesmo motor de recorrência já testado), nunca de quantidade absoluta —
 * a maioria dos testes prova exatamente essa distinção: a MESMA
 * quantidade é ou não "baixa" dependendo só da taxa de consumo do
 * tratamento ativo.
 *
 * decrementStockForDoseTaken é chamado DIRETO (não via fila de verdade) —
 * mesmo padrão já usado em dose-registration.test.ts: em teste, nada
 * consome QUEUE_DOSE_TAKEN de verdade (só o worker registrado em
 * startQueue, que só roda em produção), então "10 doses tomadas" é
 * simulado chamando a função 10 vezes, não criando 10 doses de verdade.
 */
import { describe, it, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { eq, and } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  usersTable, caregiversTable, familiesTable, patientsTable, medicationsTable,
  treatmentsTable, stockEntriesTable,
} from "@workspace/db";
import { generateAccessToken } from "../lib/tokens.ts";
import { hashPassword } from "../lib/password.ts";
import { decrementStockForDoseTaken } from "../lib/stock.ts";
import { Clock } from "../lib/clock.ts";
import { boss } from "../lib/queue.ts";
import app from "../app.ts";

interface StockListItem {
  id: number;
  medicationId: number;
  quantityRemaining: number;
  unit: string;
  prescriptionExpiresAt: string | null;
  daysRemainingByStock: number | null;
  daysUntilPrescriptionExpires: number | null;
  effectiveDaysRemaining: number | null;
  isLow: boolean;
}

let testPort: number;
let closeServer: () => Promise<void>;
let familyId: number;
let token: string;
let hiredToken: string;
let patientId: number;
let medicationId: number;

async function api(method: string, path: string, body: unknown, authToken: string): Promise<{ status: number; body: unknown }> {
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

async function createTreatment(timesPerDay: string[]) {
  const res = await api("POST", `/patients/${patientId}/treatments`, {
    medicationId, scheduleConfig: { scheduleType: "times_per_day", times: timesPerDay },
    startDate: Clock.todayInTimezone("America/Sao_Paulo"),
  }, token);
  return (res.body as { id: number }).id;
}

async function getStockEntry(): Promise<StockListItem | undefined> {
  const res = await api("GET", `/patients/${patientId}/stock`, undefined, token);
  return (res.body as StockListItem[]).find((e) => e.medicationId === medicationId);
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

  const [family] = await db.insert(familiesTable).values({ name: "Família Estoque Teste", slug: `stock-test-${Date.now()}` }).returning();
  familyId = family.id;

  const [user] = await db.insert(usersTable).values({ email: `stock-test-${Date.now()}@zelo.test`, name: "Cuidador Estoque", passwordHash: await hashPassword("x"), emailVerified: true, status: "active" }).returning();
  const [caregiver] = await db.insert(caregiversTable).values({ familyId, userId: user.id, name: "Cuidador Estoque", role: "primary_caregiver" }).returning();
  token = generateAccessToken(user.id, familyId, caregiver.id, "primary_caregiver");

  const [hiredUser] = await db.insert(usersTable).values({ email: `stock-hired-${Date.now()}@zelo.test`, name: "Cuidador Contratado", passwordHash: await hashPassword("x"), emailVerified: true, status: "active" }).returning();
  const [hiredCaregiver] = await db.insert(caregiversTable).values({ familyId, userId: hiredUser.id, name: "Cuidador Contratado", role: "hired_caregiver" }).returning();
  hiredToken = generateAccessToken(hiredUser.id, familyId, hiredCaregiver.id, "hired_caregiver");

  const [patient] = await db.insert(patientsTable).values({ familyId, name: "Paciente Estoque Teste", timezone: "America/Sao_Paulo" }).returning();
  patientId = patient.id;

  const [medication] = await db.insert(medicationsTable).values({ familyId, name: "Medicamento Estoque Teste" }).returning();
  medicationId = medication.id;
});

after(async () => {
  Clock.reset();
  await closeServer();
  // POST /treatments liga o pg-boss por baixo (enfileira o lembrete de
  // dose) — sem parar, os timers internos da fila mantêm o processo vivo
  // pra sempre, mesmo com todo teste já tendo passado (mesmo padrão já
  // usado em todo outro arquivo que toca a fila).
  await boss.stop({ graceful: false });
  await db.delete(familiesTable).where(eq(familiesTable.id, familyId));
});

describe("Decremento automático — ZELO-23/34", () => {
  it("10 doses tomadas decrementam exatamente 10 unidades", async () => {
    const [stock] = await db.insert(stockEntriesTable).values({ patientId, medicationId, quantityRemaining: 30, unit: "comprimidos" }).returning();

    for (let i = 0; i < 10; i++) await decrementStockForDoseTaken(patientId, medicationId);

    const [after_] = await db.select().from(stockEntriesTable).where(eq(stockEntriesTable.id, stock.id));
    assert.equal(after_.quantityRemaining, 20);

    await db.delete(stockEntriesTable).where(eq(stockEntriesTable.id, stock.id));
  });
});

describe("Dias restantes — pela posologia, não por quantidade absoluta", () => {
  // Rede de segurança: se algum teste falhar antes de chegar na própria
  // limpeza (ex.: exceção numa assertion), a linha órfã em stock_entries
  // (chave única por paciente+medicamento) derrubaria em cascata todo
  // teste seguinte que tenta inserir de novo. Isso já aconteceu.
  afterEach(async () => {
    await db.delete(stockEntriesTable).where(and(eq(stockEntriesTable.patientId, patientId), eq(stockEntriesTable.medicationId, medicationId)));
    await db.delete(treatmentsTable).where(and(eq(treatmentsTable.patientId, patientId), eq(treatmentsTable.medicationId, medicationId)));
  });

  it("a MESMA quantidade é baixa numa posologia rápida e não é baixa numa posologia lenta", async () => {
    const slowTreatmentId = await createTreatment(["08:00"]); // ~1 dose/dia
    const [slowStock] = await db.insert(stockEntriesTable).values({ patientId, medicationId, quantityRemaining: 10, unit: "comprimidos" }).returning();

    let entry = await getStockEntry();
    assert.ok(entry && !entry.isLow, `10 comprimidos a ~1/dia é ~10 dias, não deveria ser baixo (veio ${entry?.effectiveDaysRemaining})`);

    await db.delete(treatmentsTable).where(eq(treatmentsTable.id, slowTreatmentId));
    await db.delete(stockEntriesTable).where(eq(stockEntriesTable.id, slowStock.id));

    const fastTreatmentId = await createTreatment(["08:00", "14:00", "20:00"]); // ~3 doses/dia
    const [fastStock] = await db.insert(stockEntriesTable).values({ patientId, medicationId, quantityRemaining: 10, unit: "comprimidos" }).returning();

    entry = await getStockEntry();
    assert.ok(entry && entry.isLow, `10 comprimidos a ~3/dia é ~3,3 dias, deveria ser baixo (veio ${entry?.effectiveDaysRemaining})`);
    assert.ok(entry!.effectiveDaysRemaining !== null && entry!.effectiveDaysRemaining <= 5);

    await db.delete(treatmentsTable).where(eq(treatmentsTable.id, fastTreatmentId));
    await db.delete(stockEntriesTable).where(eq(stockEntriesTable.id, fastStock.id));
  });

  it("receita vencendo antes do estoque acabar antecipa o alerta", async () => {
    const treatmentId = await createTreatment(["08:00"]); // ~1 dose/dia — 100 unidades duraria ~100 dias
    // Precisa partir do dia civil no fuso do paciente (mesma base que
    // computeDaysRemaining usa via Clock.todayInTimezone), não de
    // Clock.now() em UTC — perto da meia-noite UTC os dois divergem em
    // 1 dia e o teste vira flaky dependendo da hora em que roda.
    const todayInPatientTz = Clock.todayInTimezone("America/Sao_Paulo");
    const expiresIn3Days = new Date(new Date(`${todayInPatientTz}T00:00:00Z`).getTime() + 3 * 86_400_000).toISOString().slice(0, 10);
    const [stock] = await db.insert(stockEntriesTable).values({
      patientId, medicationId, quantityRemaining: 100, unit: "comprimidos", prescriptionExpiresAt: expiresIn3Days,
    }).returning();

    const entry = await getStockEntry();
    assert.ok(entry);
    assert.ok(entry!.daysRemainingByStock !== null && entry!.daysRemainingByStock > 50, "sem a receita, o estoque por si só duraria muito mais que 5 dias");
    assert.ok(entry!.isLow, "a receita vencendo em 3 dias deveria disparar o alerta mesmo com estoque de sobra");
    assert.ok(entry!.effectiveDaysRemaining !== null && entry!.effectiveDaysRemaining <= 3.1);

    await db.delete(treatmentsTable).where(eq(treatmentsTable.id, treatmentId));
    await db.delete(stockEntriesTable).where(eq(stockEntriesTable.id, stock.id));
  });

  it("sem tratamento ATIVO pro medicamento, não estima taxa nenhuma (nem alerta, nem 'dias')", async () => {
    const treatmentId = await createTreatment(["08:00"]);
    await api("PATCH", `/treatments/${treatmentId}`, { status: "cancelled" }, token); // não há mais tratamento ativo
    const [stock] = await db.insert(stockEntriesTable).values({ patientId, medicationId, quantityRemaining: 2, unit: "comprimidos" }).returning();

    const entry = await getStockEntry();
    assert.ok(entry);
    assert.equal(entry!.effectiveDaysRemaining, null);
    assert.equal(entry!.isLow, false, "sem taxa pra estimar, não inventa alerta");

    await db.delete(treatmentsTable).where(eq(treatmentsTable.id, treatmentId));
    await db.delete(stockEntriesTable).where(eq(stockEntriesTable.id, stock.id));
  });

  it("sem NENHUM estoque cadastrado, o medicamento nem aparece na listagem — função desligada, sem insistir", async () => {
    const res = await api("GET", `/patients/${patientId}/stock`, undefined, token);
    const body = res.body as Array<{ medicationId: number }>;
    assert.ok(!body.some((e) => e.medicationId === medicationId));
  });
});

describe("POST /treatments com initialStock", () => {
  it("cria o estoque junto do tratamento; represcrever o mesmo medicamento atualiza em vez de duplicar", async () => {
    const res1 = await api("POST", `/patients/${patientId}/treatments`, {
      medicationId, scheduleConfig: { scheduleType: "times_per_day", times: ["08:00"] },
      startDate: Clock.todayInTimezone("America/Sao_Paulo"),
      initialStock: { quantity: 30, unit: "comprimidos" },
    }, token);
    const treatment1Id = (res1.body as { id: number }).id;

    let [stock] = await db.select().from(stockEntriesTable).where(and(eq(stockEntriesTable.patientId, patientId), eq(stockEntriesTable.medicationId, medicationId)));
    assert.equal(stock.quantityRemaining, 30);

    await api("PATCH", `/treatments/${treatment1Id}`, { status: "cancelled" }, token);
    const res2 = await api("POST", `/patients/${patientId}/treatments`, {
      medicationId, scheduleConfig: { scheduleType: "times_per_day", times: ["08:00"] },
      startDate: Clock.todayInTimezone("America/Sao_Paulo"),
      initialStock: { quantity: 60, unit: "comprimidos" },
    }, token);
    const treatment2Id = (res2.body as { id: number }).id;

    const allStock = await db.select().from(stockEntriesTable).where(and(eq(stockEntriesTable.patientId, patientId), eq(stockEntriesTable.medicationId, medicationId)));
    assert.equal(allStock.length, 1, "represcrever atualiza a mesma linha, não duplica (constraint única por paciente+medicamento)");
    assert.equal(allStock[0].quantityRemaining, 60);

    await db.delete(treatmentsTable).where(eq(treatmentsTable.id, treatment1Id));
    await db.delete(treatmentsTable).where(eq(treatmentsTable.id, treatment2Id));
    await db.delete(stockEntriesTable).where(eq(stockEntriesTable.id, allStock[0].id));
  });

  it("sem initialStock, nenhuma linha de estoque é criada — a função fica desligada", async () => {
    const res = await api("POST", `/patients/${patientId}/treatments`, {
      medicationId, scheduleConfig: { scheduleType: "times_per_day", times: ["08:00"] },
      startDate: Clock.todayInTimezone("America/Sao_Paulo"),
    }, token);
    const treatmentId = (res.body as { id: number }).id;

    const [stock] = await db.select().from(stockEntriesTable).where(and(eq(stockEntriesTable.patientId, patientId), eq(stockEntriesTable.medicationId, medicationId)));
    assert.equal(stock, undefined);

    await db.delete(treatmentsTable).where(eq(treatmentsTable.id, treatmentId));
  });
});

describe("PATCH /patients/:id/stock/:medicationId — ajuste manual e reposição", () => {
  it("setQuantity corrige pro valor exato; addQuantity soma — e o cálculo de dias restantes nunca quebra depois", async () => {
    const treatmentId = await createTreatment(["08:00", "20:00"]); // ~2 doses/dia
    const [stock] = await db.insert(stockEntriesTable).values({ patientId, medicationId, quantityRemaining: 4, unit: "comprimidos" }).returning();

    let entry = await getStockEntry();
    assert.ok(entry && entry.isLow, "4 unidades a ~2/dia é baixo");

    await api("PATCH", `/patients/${patientId}/stock/${medicationId}`, { addQuantity: 40, reason: "comprei uma caixa nova" }, token);
    entry = await getStockEntry();
    assert.ok(entry);
    assert.equal(entry!.quantityRemaining, 44);
    assert.ok(!entry!.isLow, "depois de repor, não deveria mais estar baixo");

    await api("PATCH", `/patients/${patientId}/stock/${medicationId}`, { setQuantity: 3 }, token);
    entry = await getStockEntry();
    assert.ok(entry && entry.isLow, "corrigir manualmente pra 3 volta a ficar baixo — o cálculo usa o valor atual, não um antigo");

    await db.delete(treatmentsTable).where(eq(treatmentsTable.id, treatmentId));
    await db.delete(stockEntriesTable).where(eq(stockEntriesTable.id, stock.id));
  });

  it("rejeita quando manda os dois (setQuantity e addQuantity) ou nenhum", async () => {
    const [stock] = await db.insert(stockEntriesTable).values({ patientId, medicationId, quantityRemaining: 10, unit: "comprimidos" }).returning();

    const both = await api("PATCH", `/patients/${patientId}/stock/${medicationId}`, { setQuantity: 5, addQuantity: 5 }, token);
    assert.equal(both.status, 400);
    const neither = await api("PATCH", `/patients/${patientId}/stock/${medicationId}`, { reason: "só o motivo" }, token);
    assert.equal(neither.status, 400);

    await db.delete(stockEntriesTable).where(eq(stockEntriesTable.id, stock.id));
  });

  it("cuidador contratado (sem edit_treatment) não pode ajustar estoque", async () => {
    const [stock] = await db.insert(stockEntriesTable).values({ patientId, medicationId, quantityRemaining: 10, unit: "comprimidos" }).returning();
    const res = await api("PATCH", `/patients/${patientId}/stock/${medicationId}`, { addQuantity: 5 }, hiredToken);
    assert.equal(res.status, 403);
    await db.delete(stockEntriesTable).where(eq(stockEntriesTable.id, stock.id));
  });
});
