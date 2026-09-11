/**
 * Corrigir um registro de dose, com rastro — Issue #136.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O QUE ESTE ARQUIVO GUARDA, E É UMA LINHA DE PRODUTO
 *
 * **A correção NUNCA apaga.** Um registro de dose é registro clínico:
 * apagá-lo meia hora depois destrói informação — some quem registrou, some
 * quando, some que houve um engano. O que se faz é **emendar deixando
 * rastro**, e o `audit_log` deste produto é *append-only* exatamente para
 * isso.
 *
 * Se alguém "simplificar" esta rota para um `delete` + `insert`, o histórico
 * passa a mentir por omissão: o relatório do médico mostraria o valor certo
 * sem nenhum sinal de que houve emenda. O primeiro caso aqui falha antes
 * disso chegar ao `main`.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── E a correção não é a porta dos fundos ────────────────────────────────
 *
 * As mesmas três regras de tempo da criação valem aqui: futuro recusado,
 * antecipação exigindo confirmação (#134), e janela retroativa exigindo
 * justificativa (ZELO-24). Sem isso, a regra da #134 valeria só para quem
 * acerta de primeira — bastaria registrar e "corrigir" para contorná-la.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { eq, like, and, desc } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  usersTable,
  familiesTable,
  caregiversTable,
  patientsTable,
  medicationsTable,
  treatmentsTable,
  scheduledDosesTable,
  doseRecordsTable,
  auditLogTable,
} from "@workspace/db";
import { generateAccessToken } from "../lib/tokens.ts";
import { Clock } from "../lib/clock.ts";
import { boss } from "../lib/queue.ts";
import app from "../app.ts";

const SUFIXO = "@corrigir.zelo.test";

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
  // Registrar dose `taken` liga o pg-boss — sem parar, o processo não termina
  // e o job do CI morre no timeout (armadilha da #134).
  await boss.stop({ graceful: false });
  await db.delete(usersTable).where(like(usersTable.email, `%${SUFIXO}`));
  await db.delete(familiesTable).where(like(familiesTable.name, "Família Fictícia Corrigir %"));
});

async function pedir(
  metodo: string,
  path: string,
  opcoes: { token?: string; json?: unknown } = {},
) {
  const corpo = opcoes.json === undefined ? undefined : JSON.stringify(opcoes.json);
  return new Promise<{ status: number; body: Record<string, unknown> }>((resolve, reject) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port: testPort,
        path: `/api${path}`,
        method: metodo,
        headers: {
          "Content-Type": "application/json",
          ...(opcoes.token ? { Authorization: `Bearer ${opcoes.token}` } : {}),
          ...(corpo ? { "Content-Length": Buffer.byteLength(corpo) } : {}),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (c: Buffer) => (data += c.toString()));
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode ?? 0, body: JSON.parse(data) as Record<string, unknown> });
          } catch {
            resolve({ status: res.statusCode ?? 0, body: {} });
          }
        });
      },
    );
    req.on("error", reject);
    if (corpo) req.write(corpo);
    req.end();
  });
}

/** Uma família com principal, observador, e uma dose JÁ REGISTRADA como tomada. */
async function cenario(rotulo: string) {
  const marca = `${Date.now()}${Math.floor(Math.random() * 10000)}`;

  const [family] = await db
    .insert(familiesTable)
    .values({ name: `Família Fictícia Corrigir ${rotulo} ${marca}`, slug: `corr-${rotulo}-${marca}` })
    .returning({ id: familiesTable.id });

  const criarCuidador = async (papel: "primary_caregiver" | "caregiver" | "observer", sufixo: string) => {
    const email = `corr-${rotulo}-${sufixo}-${marca}${SUFIXO}`;
    const [user] = await db
      .insert(usersTable)
      .values({
        email, name: `Pessoa Fictícia ${sufixo}`, passwordHash: "hash-nao-usado",
        emailVerified: true, status: "active", activeFamilyId: family.id,
      })
      .returning({ id: usersTable.id });
    const [c] = await db
      .insert(caregiversTable)
      .values({ familyId: family.id, userId: user.id, name: `Pessoa Fictícia ${sufixo}`, email, role: papel })
      .returning({ id: caregiversTable.id });
    return { id: c.id, nome: `Pessoa Fictícia ${sufixo}`, token: generateAccessToken(user.id, family.id, c.id, papel) };
  };

  const principal = await criarCuidador("primary_caregiver", "Principal");
  const comum = await criarCuidador("caregiver", "Comum");
  const observador = await criarCuidador("observer", "Observador");

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

  const [dose] = await db
    .insert(scheduledDosesTable)
    .values({
      treatmentId: treatment.id, patientId: patient.id,
      scheduledAt: Clock.now(),
      scheduledLocalDate: Clock.todayInTimezone("America/Sao_Paulo"),
      scheduledLocalTime: "08:00", status: "pending",
    })
    .returning({ id: scheduledDosesTable.id });

  const registro = await pedir("POST", `/patients/${patient.id}/dose-records`, {
    token: principal.token,
    json: { scheduledDoseId: dose.id, outcome: "taken" },
  });
  assert.equal(registro.status, 201, JSON.stringify(registro.body));

  return {
    familyId: family.id,
    patientId: patient.id,
    doseId: dose.id,
    recordId: (registro.body as { id: number }).id,
    principal, comum, observador,
  };
}

describe("Corrigir um registro de dose", () => {
  it("emenda SEM apagar, e o audit_log guarda o antes e o depois", async () => {
    const c = await cenario("emenda");

    const r = await pedir("PATCH", `/patients/${c.patientId}/dose-records/${c.recordId}`, {
      token: c.principal.token,
      json: { outcome: "skipped" },
    });
    assert.equal(r.status, 200, JSON.stringify(r.body));

    // A LINHA CONTINUA SENDO A MESMA. Um `delete` + `insert` daria outro id, e
    // é justamente isso que não pode acontecer.
    const [depois] = await db
      .select()
      .from(doseRecordsTable)
      .where(eq(doseRecordsTable.id, c.recordId));
    assert.ok(depois, "o registro nao pode ter sido apagado");
    assert.equal(depois.outcome, "skipped");
    assert.ok(depois.correctedAt, "a marca de correcao precisa existir");
    assert.equal(depois.correctedByCaregiverId, c.principal.id);

    // E o rastro, no log que ninguém reescreve.
    const [entrada] = await db
      .select({ diff: auditLogTable.diff })
      .from(auditLogTable)
      .where(and(
        eq(auditLogTable.entityType, "dose_record"),
        eq(auditLogTable.entityId, String(c.recordId)),
        eq(auditLogTable.action, "updated"),
      ))
      .orderBy(desc(auditLogTable.id))
      .limit(1);
    assert.ok(entrada, "a correcao precisa aparecer no audit_log");
    const diff = JSON.parse(entrada.diff ?? "{}") as {
      antes?: { outcome?: string };
      depois?: { outcome?: string };
    };
    assert.equal(diff.antes?.outcome, "taken", "o valor ANTES tem que estar guardado");
    assert.equal(diff.depois?.outcome, "skipped");
  });

  it("a dose agendada acompanha o desfecho corrigido", async () => {
    const c = await cenario("status");

    await pedir("PATCH", `/patients/${c.patientId}/dose-records/${c.recordId}`, {
      token: c.principal.token,
      json: { outcome: "skipped" },
    });

    // Sem isto, o cartão diria "Tomado" e o relatório diria `skipped`.
    const [dose] = await db
      .select({ status: scheduledDosesTable.status })
      .from(scheduledDosesTable)
      .where(eq(scheduledDosesTable.id, c.doseId));
    assert.equal(dose.status, "skipped");
  });

  it("QUALQUER cuidador corrige; o observador nao", async () => {
    const c = await cenario("papeis");

    const doComum = await pedir("PATCH", `/patients/${c.patientId}/dose-records/${c.recordId}`, {
      token: c.comum.token,
      json: { outcome: "skipped" },
    });
    assert.equal(doComum.status, 200, JSON.stringify(doComum.body));

    const doObservador = await pedir("PATCH", `/patients/${c.patientId}/dose-records/${c.recordId}`, {
      token: c.observador.token,
      json: { outcome: "taken" },
    });
    assert.equal(doObservador.status, 403, JSON.stringify(doObservador.body));
  });

  it("corrigir NAO e a porta dos fundos: horario no futuro continua recusado", async () => {
    const c = await cenario("futuro");

    const r = await pedir("PATCH", `/patients/${c.patientId}/dose-records/${c.recordId}`, {
      token: c.principal.token,
      json: { takenAt: new Date(Clock.now().getTime() + 3 * 3_600_000).toISOString() },
    });
    assert.equal(r.status, 400, JSON.stringify(r.body));

    // Nada mudou.
    const [intacto] = await db
      .select({ correctedAt: doseRecordsTable.correctedAt })
      .from(doseRecordsTable)
      .where(eq(doseRecordsTable.id, c.recordId));
    assert.equal(intacto.correctedAt, null);
  });

  it("horario muito antigo pede justificativa, e com ela entra", async () => {
    const c = await cenario("retroativo");
    const bemAntes = new Date(Clock.now().getTime() - 30 * 3_600_000).toISOString();

    const sem = await pedir("PATCH", `/patients/${c.patientId}/dose-records/${c.recordId}`, {
      token: c.principal.token,
      json: { takenAt: bemAntes },
    });
    assert.equal(sem.status, 400, JSON.stringify(sem.body));
    assert.equal(sem.body.code, "JUSTIFICATION_REQUIRED");

    const com = await pedir("PATCH", `/patients/${c.patientId}/dose-records/${c.recordId}`, {
      token: c.principal.token,
      json: { takenAt: bemAntes, justification: "anotei so no dia seguinte" },
    });
    assert.equal(com.status, 200, JSON.stringify(com.body));
  });

  it("corrigir sem mudar nada e recusado", async () => {
    const c = await cenario("vazio");

    // Carimbar "corrigido" num registro intacto sujaria o histórico com um
    // evento que não houve.
    const r = await pedir("PATCH", `/patients/${c.patientId}/dose-records/${c.recordId}`, {
      token: c.principal.token,
      json: {},
    });
    assert.equal(r.status, 400, JSON.stringify(r.body));
  });

  it("registro de outra familia responde 404, nunca 403", async () => {
    const a = await cenario("famA");
    const b = await cenario("famB");

    // Invariante 2: recurso de outra família não existe, não é "proibido".
    const r = await pedir("PATCH", `/patients/${b.patientId}/dose-records/${b.recordId}`, {
      token: a.principal.token,
      json: { outcome: "skipped" },
    });
    assert.equal(r.status, 404, JSON.stringify(r.body));

    const [intacto] = await db
      .select({ outcome: doseRecordsTable.outcome })
      .from(doseRecordsTable)
      .where(eq(doseRecordsTable.id, b.recordId));
    assert.equal(intacto.outcome, "taken", "nada da outra familia pode ter mudado");
  });
});
