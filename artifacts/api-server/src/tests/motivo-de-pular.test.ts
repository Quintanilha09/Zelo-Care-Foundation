/**
 * O motivo de uma dose pulada — Issue #166.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * "PULADO" DIZIA MENOS DO QUE O CUIDADOR SABIA.
 *
 * "Pulou porque estava vomitando" e "pulou porque acabou o remédio" viravam
 * a mesma linha no relatório — e são duas conversas diferentes na consulta.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── Por que uma rota própria, e não o PATCH de correção ──────────────────
 *
 * A correção marca o registro, e essa marca existe para dizer "o que
 * aconteceu foi emendado". Acrescentar um motivo não emenda nada: o desfecho
 * e o horário continuam os mesmos. Usar o PATCH faria a marca mentir.
 *
 * É isso que este arquivo guarda — junto com o 409 de quem tenta trocar um
 * motivo existente por aqui, que **é** emenda e tem de passar pela correção.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { eq, like } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  usersTable, familiesTable, caregiversTable, patientsTable,
  medicationsTable, treatmentsTable, scheduledDosesTable, doseRecordsTable,
} from "@workspace/db";
import { generateAccessToken } from "../lib/tokens.ts";
import { Clock } from "../lib/clock.ts";
import app from "../app.ts";

const SUFIXO = "@motivo.zelo.test";

let testPort: number;
let closeServer: () => Promise<void>;

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
});

after(async () => {
  await closeServer();
  await db.delete(usersTable).where(like(usersTable.email, `%${SUFIXO}`));
  await db.delete(familiesTable).where(like(familiesTable.name, "Família Fictícia Motivo %"));
});

async function api(
  method: string,
  path: string,
  token: string,
  body?: unknown,
): Promise<{ status: number; body: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const dados = body === undefined ? undefined : JSON.stringify(body);
    const req = http.request(
      {
        hostname: "127.0.0.1", port: testPort, path: `/api${path}`, method,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(dados ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(dados) } : {}),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (c: Buffer) => (data += c.toString()));
        res.on("end", () => resolve({
          status: res.statusCode ?? 0,
          body: data ? (JSON.parse(data) as Record<string, unknown>) : {},
        }));
      },
    );
    req.on("error", reject);
    if (dados) req.write(dados);
    req.end();
  });
}

/** Uma família com uma dose já PULADA, sem motivo nenhum. */
async function cenario(rotulo: string) {
  const marca = `${Date.now()}${Math.floor(Math.random() * 10000)}`;

  const [family] = await db
    .insert(familiesTable)
    .values({ name: `Família Fictícia Motivo ${rotulo} ${marca}`, slug: `mot-${rotulo}-${marca}` })
    .returning({ id: familiesTable.id });

  const email = `mot-${rotulo}-${marca}${SUFIXO}`;
  const [user] = await db
    .insert(usersTable)
    .values({
      email, name: "Pessoa Fictícia", passwordHash: "hash-nao-usado",
      emailVerified: true, status: "active", activeFamilyId: family.id,
    })
    .returning({ id: usersTable.id });

  const [caregiver] = await db
    .insert(caregiversTable)
    .values({ familyId: family.id, userId: user.id, name: "Pessoa Fictícia", email, role: "primary_caregiver" })
    .returning({ id: caregiversTable.id });

  const [patient] = await db
    .insert(patientsTable)
    .values({ familyId: family.id, name: "Dona Maria Teste", timezone: "America/Sao_Paulo" })
    .returning({ id: patientsTable.id });

  const [medication] = await db
    .insert(medicationsTable)
    .values({ familyId: family.id, name: "Remédio Fictício (fictício)" })
    .returning({ id: medicationsTable.id });

  const [treatment] = await db
    .insert(treatmentsTable)
    .values({
      patientId: patient.id, medicationId: medication.id, dose: "1 comprimido",
      scheduleType: "times_per_day",
      scheduleConfig: { scheduleType: "times_per_day", times: ["08:00"] },
      startDate: Clock.todayInTimezone("America/Sao_Paulo"), status: "active",
    })
    .returning({ id: treatmentsTable.id });

  const [agendada] = await db
    .insert(scheduledDosesTable)
    .values({
      treatmentId: treatment.id, patientId: patient.id,
      scheduledAt: new Date(Clock.now().getTime() - 60 * 60_000),
      scheduledLocalDate: Clock.todayInTimezone("America/Sao_Paulo"),
      scheduledLocalTime: "08:00", status: "skipped", dose: "1 comprimido",
    })
    .returning({ id: scheduledDosesTable.id });

  const [registro] = await db
    .insert(doseRecordsTable)
    .values({
      scheduledDoseId: agendada.id, patientId: patient.id, caregiverId: caregiver.id,
      takenAt: Clock.now(), outcome: "skipped",
    })
    .returning({ id: doseRecordsTable.id });

  return {
    token: generateAccessToken(user.id, family.id, caregiver.id, "primary_caregiver"),
    patientId: patient.id,
    recordId: registro.id,
  };
}

describe("O motivo de uma dose pulada", () => {
  it("acrescentar o motivo NAO marca o registro como corrigido", async () => {
    const c = await cenario("naocorrige");

    const res = await api(
      "POST", `/patients/${c.patientId}/dose-records/${c.recordId}/motivo`, c.token,
      { justification: "Acabou o remédio" },
    );
    assert.equal(res.status, 200, JSON.stringify(res.body));

    const [registro] = await db
      .select({ justification: doseRecordsTable.justification, correctedAt: doseRecordsTable.correctedAt })
      .from(doseRecordsTable)
      .where(eq(doseRecordsTable.id, c.recordId));

    assert.equal(registro.justification, "Acabou o remédio");
    assert.equal(
      registro.correctedAt,
      null,
      "a marca de correção existe para dizer que o que ACONTECEU foi emendado. " +
        "Acrescentar um motivo não emenda nada — o desfecho e o horário são os " +
        "mesmos —, e marcar aqui faria a marca mentir.",
    );
  });

  it("trocar um motivo que ja existe e recusado, e manda usar Corrigir", async () => {
    const c = await cenario("jatem");
    await api("POST", `/patients/${c.patientId}/dose-records/${c.recordId}/motivo`, c.token, {
      justification: "A pessoa recusou",
    });

    const segundo = await api(
      "POST", `/patients/${c.patientId}/dose-records/${c.recordId}/motivo`, c.token,
      { justification: "Na verdade acabou o remédio" },
    );

    // Trocar um motivo existente É emendar o registro, e aí a marca tem de
    // aparecer — por isso este caminho recusa e aponta o outro.
    assert.equal(segundo.status, 409);
    assert.equal(segundo.body.code, "MOTIVO_JA_EXISTE");

    const [registro] = await db
      .select({ justification: doseRecordsTable.justification })
      .from(doseRecordsTable)
      .where(eq(doseRecordsTable.id, c.recordId));
    assert.equal(registro.justification, "A pessoa recusou", "o motivo original não pode ter sido trocado");
  });

  it("motivo vazio nao passa", async () => {
    const c = await cenario("vazio");
    const res = await api(
      "POST", `/patients/${c.patientId}/dose-records/${c.recordId}/motivo`, c.token,
      { justification: "   " },
    );
    assert.equal(res.status, 400, "um motivo em branco é o mesmo que não ter motivo");
  });

  it("registro de outra familia responde 404, nunca 403", async () => {
    const a = await cenario("familiaA");
    const b = await cenario("familiaB");

    // Invariante 2: 403 confirmaria que o recurso existe.
    const res = await api(
      "POST", `/patients/${b.patientId}/dose-records/${b.recordId}/motivo`, a.token,
      { justification: "Acabou o remédio" },
    );
    assert.equal(res.status, 404);
  });
});
