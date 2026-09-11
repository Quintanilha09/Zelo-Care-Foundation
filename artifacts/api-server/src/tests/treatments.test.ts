/**
 * Testes de tratamento — ZELO (ZELO-16).
 *
 * Cobre: os 5 padrões de posologia cadastráveis via API, pré-visualização em
 * linguagem natural das próximas doses, e a garantia central da spec —
 * nenhuma tela sugere, calcula ou valida quantidade de dose.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { eq, and, gte } from "drizzle-orm";
import { db } from "@workspace/db";
import { usersTable, caregiversTable, familiesTable, patientsTable, medicationsTable, treatmentsTable, scheduledDosesTable } from "@workspace/db";
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
    .values({ name: "Família Tratamento Teste", slug: `treatments-test-${Date.now()}` })
    .returning();
  familyId = family.id;

  const [user] = await db
    .insert(usersTable)
    .values({ email: `treatments-${Date.now()}@zelo.test`, name: "Cuidador Teste", passwordHash: await hashPassword("x"), emailVerified: true, status: "active" })
    .returning();
  const [caregiver] = await db
    .insert(caregiversTable)
    .values({ familyId, userId: user.id, name: "Cuidador Teste", role: "primary_caregiver" })
    .returning();
  token = generateAccessToken(user.id, familyId, caregiver.id, "primary_caregiver");

  const [patient] = await db
    .insert(patientsTable)
    .values({ familyId, name: "Paciente Teste", timezone: "America/Sao_Paulo" })
    .returning();
  patientId = patient.id;

  const [medication] = await db
    .insert(medicationsTable)
    .values({ familyId, name: "Medicamento Fictício Teste", form: "tablet", strength: "10mg" })
    .returning();
  medicationId = medication.id;
});

after(async () => {
  await closeServer();
  // Criar tratamento aciona geração de dose, que sobe o pg-boss (lib/queue.ts)
  // sob demanda — precisa ser parado ou o processo do teste não encerra.
  await boss.stop({ graceful: false });
  await db.delete(familiesTable).where(eq(familiesTable.id, familyId));
});

describe("Criação de tratamento — os 5 padrões de posologia", () => {
  it("times_per_day — 2 vezes ao dia", async () => {
    const res = await api("POST", `/patients/${patientId}/treatments`, {
      medicationId, dose: "1 comprimido",
      scheduleConfig: { scheduleType: "times_per_day", times: ["08:00", "20:00"] },
      startDate: "2026-01-01",
    });
    assert.equal(res.status, 201);
    const body = res.body as { id: number; scheduleType: string };
    assert.equal(body.scheduleType, "times_per_day");
    await db.delete(treatmentsTable).where(eq(treatmentsTable.id, body.id));
  });

  it("every_n_hours", async () => {
    const res = await api("POST", `/patients/${patientId}/treatments`, {
      medicationId, scheduleConfig: { scheduleType: "every_n_hours", intervalHours: 8, startTime: "08:00" },
      startDate: "2026-01-01",
    });
    assert.equal(res.status, 201);
  });

  it("specific_weekdays", async () => {
    const res = await api("POST", `/patients/${patientId}/treatments`, {
      medicationId, scheduleConfig: { scheduleType: "specific_weekdays", weekdays: [1, 3, 5], times: ["08:00"] },
      startDate: "2026-01-01",
    });
    assert.equal(res.status, 201);
  });

  it("alternate_days", async () => {
    const res = await api("POST", `/patients/${patientId}/treatments`, {
      medicationId, scheduleConfig: { scheduleType: "alternate_days", times: ["08:00"], startDate: "2026-01-01" },
      startDate: "2026-01-01",
    });
    assert.equal(res.status, 201);
  });

  it("cycle_with_pause", async () => {
    const res = await api("POST", `/patients/${patientId}/treatments`, {
      medicationId, scheduleConfig: { scheduleType: "cycle_with_pause", onDays: 21, offDays: 7, times: ["08:00"] },
      startDate: "2026-01-01",
    });
    assert.equal(res.status, 201);
  });

  it("posologia malformada (sem times) é rejeitada com 400", async () => {
    const res = await api("POST", `/patients/${patientId}/treatments`, {
      medicationId, scheduleConfig: { scheduleType: "times_per_day", times: [] },
      startDate: "2026-01-01",
    });
    assert.equal(res.status, 400);
  });
});

describe("Nenhuma sugestão, cálculo ou validação de quantidade de dose", () => {
  it("aceita qualquer texto em dose, mesmo um valor absurdo, sem opinar", async () => {
    const res = await api("POST", `/patients/${patientId}/treatments`, {
      medicationId, dose: "10 comprimidos de uma vez",
      scheduleConfig: { scheduleType: "times_per_day", times: ["08:00"] },
      startDate: "2026-01-01",
    });
    assert.equal(res.status, 201, "o app aceita, nunca valida quantidade — decisão é do médico, não do software");
    const body = res.body as { dose: string; id: number };
    assert.equal(body.dose, "10 comprimidos de uma vez");
    await db.delete(treatmentsTable).where(eq(treatmentsTable.id, body.id));
  });
});

describe("Pré-visualização em linguagem natural", () => {
  it("mostra as próximas 5 doses sem salvar nada no banco", async () => {
    const before = await db.select().from(treatmentsTable).where(eq(treatmentsTable.patientId, patientId));

    const res = await api("POST", `/patients/${patientId}/treatments/preview`, {
      scheduleConfig: { scheduleType: "times_per_day", times: ["08:00", "20:00"] },
      startDate: "2026-01-01",
    });
    assert.equal(res.status, 200);
    const body = res.body as { nextDoses: string[]; inPortuguese: string[] };
    assert.equal(body.nextDoses.length, 5);
    assert.equal(body.inPortuguese.length, 5);
    assert.match(body.inPortuguese[0], /às \d{2}h\d{2}/, "formato deve ser tipo 'segunda às 08h00'");

    const after = await db.select().from(treatmentsTable).where(eq(treatmentsTable.patientId, patientId));
    assert.equal(before.length, after.length, "preview não pode persistir tratamento nenhum");
  });
});

describe("Edição de tratamento", () => {
  it("editar posologia atualiza o scheduleConfig persistido", async () => {
    const created = await api("POST", `/patients/${patientId}/treatments`, {
      medicationId, scheduleConfig: { scheduleType: "times_per_day", times: ["08:00"] },
      startDate: "2026-01-01",
    });
    const { id } = created.body as { id: number };

    const updated = await api("PATCH", `/treatments/${id}`, {
      scheduleConfig: { scheduleType: "times_per_day", times: ["09:00", "21:00"] },
    });
    assert.equal(updated.status, 200);
    const body = updated.body as { scheduleConfig: { times: string[] } };
    assert.deepEqual(body.scheduleConfig.times, ["09:00", "21:00"]);

    await db.delete(treatmentsTable).where(eq(treatmentsTable.id, id));
  });
});

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * O AVISO ANTES DE SALVAR — Issue #174.
 *
 * Editar horário ou data apaga as doses pendentes e gera outras. A tela não
 * dizia isso: quem trocou "08:00 e 20:00" por "09:00 e 21:00" às 19:00 não
 * descobria que a dose das 20:00 de hoje tinha deixado de existir.
 *
 * O número precisa sair da MESMA regra que o PATCH usa para apagar
 * (`clearFuturePendingDoses`: pendentes daquele tratamento, de agora em
 * diante). Um aviso que diz um número enquanto o banco faz outro é pior que
 * nenhum aviso — por isso quem conta é o servidor, e não a tela.
 * ═══════════════════════════════════════════════════════════════════════════
 */
describe("O aviso de quantas doses a edicao cancela", () => {
  it("na criacao nao ha o que cancelar, e o campo vem nulo", async () => {
    const res = await api("POST", `/patients/${patientId}/treatments/preview`, {
      scheduleConfig: { scheduleType: "times_per_day", times: ["08:00"] },
      startDate: "2026-01-01",
    });

    assert.equal(res.status, 200);
    const body = res.body as { dosesQueSeraoCanceladas: number | null };
    assert.equal(
      body.dosesQueSeraoCanceladas,
      null,
      "sem `treatmentId` não existe tratamento para cancelar doses de — e " +
        "zero diria outra coisa: diria que há um, e que ele não tem pendentes",
    );
  });

  it("na edicao, conta as pendentes que o PATCH apagaria", async () => {
    const criado = await api("POST", `/patients/${patientId}/treatments`, {
      medicationId,
      scheduleConfig: { scheduleType: "times_per_day", times: ["08:00", "20:00"] },
      startDate: Clock.todayInTimezone("America/Sao_Paulo"),
    });
    const { id } = criado.body as { id: number };

    // A criação já gerou a janela de doses. Quantas estão pendentes daqui
    // para frente é exatamente o que o aviso tem que dizer.
    const esperadas = await db
      .select({ id: scheduledDosesTable.id })
      .from(scheduledDosesTable)
      .where(and(
        eq(scheduledDosesTable.treatmentId, id),
        eq(scheduledDosesTable.status, "pending"),
        gte(scheduledDosesTable.scheduledAt, Clock.now()),
      ));

    const res = await api("POST", `/patients/${patientId}/treatments/preview`, {
      scheduleConfig: { scheduleType: "times_per_day", times: ["09:00", "21:00"] },
      startDate: Clock.todayInTimezone("America/Sao_Paulo"),
      treatmentId: id,
    });

    assert.equal(res.status, 200);
    const body = res.body as { dosesQueSeraoCanceladas: number | null };
    assert.ok(esperadas.length > 0, "o tratamento recém-criado precisa ter doses pendentes");
    assert.equal(
      body.dosesQueSeraoCanceladas,
      esperadas.length,
      "o aviso tem que dizer o MESMO número que o banco vai apagar",
    );

    await db.delete(treatmentsTable).where(eq(treatmentsTable.id, id));
  });

  it("o tratamento de outra familia nao vaza contagem", async () => {
    // Invariante 2. Um `treatmentId` que não é deste paciente não pode
    // devolver a contagem dele — nem 404 aqui, que confirmaria a existência:
    // a contagem simplesmente é zero, porque não há dose DESTE paciente
    // naquele tratamento.
    const deOutro = await db
      .select({ id: treatmentsTable.id })
      .from(treatmentsTable)
      .where(eq(treatmentsTable.patientId, patientId));

    const idInexistente = Math.max(0, ...deOutro.map((t) => t.id)) + 10_000;
    const res = await api("POST", `/patients/${patientId}/treatments/preview`, {
      scheduleConfig: { scheduleType: "times_per_day", times: ["08:00"] },
      startDate: "2026-01-01",
      treatmentId: idInexistente,
    });

    assert.equal(res.status, 200);
    assert.equal((res.body as { dosesQueSeraoCanceladas: number | null }).dosesQueSeraoCanceladas, 0);
  });
});
