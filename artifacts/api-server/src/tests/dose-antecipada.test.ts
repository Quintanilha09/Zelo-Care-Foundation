/**
 * Dose registrada antes da hora — Issue #134.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O DEFEITO QUE ESTE ARQUIVO EXISTE PARA IMPEDIR DE VOLTAR
 *
 * Em 10/09/2026 o fundador mediu, às 00:49, que dava para marcar como tomada
 * a dose agendada para as **23:00 do mesmo dia**. A rota fazia duas checagens
 * de tempo e nenhuma comparava `takenAt` com `scheduledAt`: `takenAt` era
 * *agora*, o futuro era zero, o passado era zero, e as ~22 horas de distância
 * não eram olhadas por ninguém.
 *
 * O dano é silencioso e é sobre remédio: a dose sai da lista de pendentes, o
 * lembrete não dispara, e ninguém mais é avisado de que ela existe.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── E o segundo caminho, que é o mais frágil ──────────────────────────────
 *
 * `POST /patient-access/taken` (ZELO-40, o aparelho do próprio paciente) é um
 * `insert` **separado**, sem nenhuma checagem de tempo. Fechar só a rota do
 * cuidador teria deixado aberta justamente a superfície do botão gigante na
 * frente de quem está sendo cuidado. Os dois casos aqui embaixo guardam isso.
 *
 * ── O que este arquivo NÃO deve virar ─────────────────────────────────────
 *
 * Um teste de que "registrar dose é difícil". Registrar dose é o dado vital
 * do produto e **nunca é bloqueado** — nem por plano, nem por pagamento
 * atrasado, nem por isto. O caso `confirmarAntecipacao` existe para provar
 * que o caminho continua aberto para quem realmente deu o remédio adiantado.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { eq, like } from "drizzle-orm";
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
} from "@workspace/db";
import { generateAccessToken } from "../lib/tokens.ts";
import { Clock } from "../lib/clock.ts";
import app from "../app.ts";

const SUFIXO = "@antecipada.zelo.test";

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
  await db.delete(familiesTable).where(like(familiesTable.name, "Família Fictícia Antecipada %"));
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

/**
 * Uma família, um paciente e **três doses agendadas** em distâncias
 * diferentes do agora: muito à frente, logo ali, e já vencida.
 *
 * As três de propósito. Com uma dose só, "a regra recusou" e "a regra recusa
 * tudo" são indistinguíveis — e uma regra que recusasse tudo passaria num
 * teste que só olhasse a dose distante.
 */
async function cenario(rotulo: string) {
  const marca = `${Date.now()}${Math.floor(Math.random() * 10000)}`;
  const agora = Clock.now();

  const [family] = await db
    .insert(familiesTable)
    .values({
      name: `Família Fictícia Antecipada ${rotulo} ${marca}`,
      slug: `antec-${rotulo}-${marca}`,
    })
    .returning({ id: familiesTable.id });

  const email = `antec-${rotulo}-${marca}${SUFIXO}`;
  const [user] = await db
    .insert(usersTable)
    .values({
      email,
      name: "Pessoa Fictícia Cuidadora",
      passwordHash: "hash-nao-usado",
      emailVerified: true,
      status: "active",
      activeFamilyId: family.id,
    })
    .returning({ id: usersTable.id });

  const [caregiver] = await db
    .insert(caregiversTable)
    .values({
      familyId: family.id,
      userId: user.id,
      name: "Pessoa Fictícia Cuidadora",
      email,
      role: "primary_caregiver",
    })
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
      patientId: patient.id,
      medicationId: medication.id,
      dose: "1 comprimido",
      scheduleType: "times_per_day",
      scheduleConfig: { scheduleType: "times_per_day", times: ["09:00", "13:00", "23:00"] },
      startDate: Clock.todayInTimezone("America/Sao_Paulo"),
      status: "active",
    })
    .returning({ id: treatmentsTable.id });

  const agendar = async (deslocamentoMs: number, etiqueta: string) => {
    const quando = new Date(agora.getTime() + deslocamentoMs);
    const [d] = await db
      .insert(scheduledDosesTable)
      .values({
        treatmentId: treatment.id,
        patientId: patient.id,
        scheduledAt: quando,
        scheduledLocalDate: Clock.todayInTimezone("America/Sao_Paulo"),
        scheduledLocalTime: etiqueta,
        status: "pending",
      })
      .returning({ id: scheduledDosesTable.id });
    return d.id;
  };

  return {
    familyId: family.id,
    patientId: patient.id,
    token: generateAccessToken(user.id, family.id, caregiver.id, "primary_caregiver"),
    // 22 h à frente: o caso exato do relato.
    distante: await agendar(22 * 3_600_000, "23:00"),
    // 20 min à frente: dentro da janela de 1 h — o caso comum de quem dá o
    // remédio pouco antes de sair, e que NÃO pode ganhar atrito nenhum.
    logoAli: await agendar(20 * 60_000, "13:00"),
    // 3 h atrasada: o eixo retroativo, que esta issue não encosta.
    vencida: await agendar(-3 * 3_600_000, "09:00"),
  };
}

async function registrouDeVerdade(scheduledDoseId: number): Promise<boolean> {
  const linhas = await db
    .select({ id: doseRecordsTable.id })
    .from(doseRecordsTable)
    .where(eq(doseRecordsTable.scheduledDoseId, scheduledDoseId));
  return linhas.length > 0;
}

describe("Registro de dose antes da hora", () => {
  it("dose de daqui a 22 h é recusada, e NADA é gravado", async () => {
    const c = await cenario("distante");

    const r = await pedir("POST", `/patients/${c.patientId}/dose-records`, {
      token: c.token,
      json: { scheduledDoseId: c.distante, outcome: "taken" },
    });

    assert.equal(r.status, 400, JSON.stringify(r.body));
    assert.equal(r.body.code, "ANTECIPACAO_REQUERIDA");
    // O horário volta na resposta para a tela poder perguntar sem adivinhar.
    assert.equal(r.body.scheduledLocalTime, "23:00");

    // A recusa não pode ter deixado meio registro para trás.
    assert.equal(await registrouDeVerdade(c.distante), false, "gravou apesar do 400");
  });

  it("a mesma dose entra com `confirmarAntecipacao` — o caminho nunca fecha", async () => {
    const c = await cenario("confirma");

    const r = await pedir("POST", `/patients/${c.patientId}/dose-records`, {
      token: c.token,
      json: { scheduledDoseId: c.distante, outcome: "taken", confirmarAntecipacao: true },
    });

    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(await registrouDeVerdade(c.distante), true);
  });

  it("dose de daqui a 20 min entra sem atrito — a janela existe para isto", async () => {
    const c = await cenario("janela");

    // Sem `confirmarAntecipacao`: quem dá o remédio pouco antes da hora não
    // pode ganhar uma pergunta a cada vez.
    const r = await pedir("POST", `/patients/${c.patientId}/dose-records`, {
      token: c.token,
      json: { scheduledDoseId: c.logoAli, outcome: "taken" },
    });

    assert.equal(r.status, 201, JSON.stringify(r.body));
  });

  it("dose ATRASADA continua entrando — esta issue não encosta no retroativo", async () => {
    const c = await cenario("vencida");

    const r = await pedir("POST", `/patients/${c.patientId}/dose-records`, {
      token: c.token,
      json: { scheduledDoseId: c.vencida, outcome: "taken" },
    });

    assert.equal(r.status, 201, JSON.stringify(r.body));
  });

  it("`Pular` uma dose distante também é recusado", async () => {
    const c = await cenario("pular");

    // O toque acidental resolve a dose do mesmo jeito, com o outro botão.
    const r = await pedir("POST", `/patients/${c.patientId}/dose-records`, {
      token: c.token,
      json: { scheduledDoseId: c.distante, outcome: "skipped" },
    });

    assert.equal(r.status, 400, JSON.stringify(r.body));
    assert.equal(r.body.code, "ANTECIPACAO_REQUERIDA");
  });
});
