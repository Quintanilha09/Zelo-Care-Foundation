/**
 * Testes do relatório de adesão em PDF — ZELO (ZELO-35).
 *
 * Duas garantias centrais, testadas de forma concreta e não só por
 * inspeção: (1) nenhuma frase do PDF interpreta, sugere ou conclui algo
 * clínico, (2) o rodapé obrigatório está sempre presente — as duas coisas
 * que mantêm o produto fora do enquadramento de dispositivo médico.
 * compress:false em generateReportPdf (lib/adherence-report.ts) de
 * propósito, só pra estes testes poderem ler o texto direto dos bytes
 * crus do PDF, sem precisar de um parser de PDF de verdade.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { eq } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  usersTable, caregiversTable, familiesTable, patientsTable, medicationsTable,
  treatmentsTable, scheduledDosesTable, doseRecordsTable, subscriptionsTable,
  healthMeasurementsTable, adherenceReportsTable,
} from "@workspace/db";
import { generateAccessToken } from "../lib/tokens.ts";
import { hashPassword } from "../lib/password.ts";
import { Clock } from "../lib/clock.ts";
import { computeReportData, generateReportPdf } from "../lib/adherence-report.ts";
import app from "../app.ts";

let testPort: number;
let closeServer: () => Promise<void>;
let familyId: number;
let token: string;
let patientId: number;
let medicationId: number;
let treatmentId: number;
let primaryCaregiverId: number;

async function api(method: string, path: string, body?: unknown, authToken = token): Promise<{ status: number; body: unknown }> {
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
async function rawGet(path: string): Promise<{ status: number; body: Buffer; contentType?: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: "127.0.0.1", port: testPort, path: `/api${path}`, method: "GET" }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks), contentType: res.headers["content-type"] }));
    });
    req.on("error", reject);
    req.end();
  });
}

/**
 * O pdfkit escreve texto em fragmentos hex dentro do operador TJ, quebrados
 * pelo ajuste de kerning entre letras (não como string literal contígua) —
 * uma busca direta de substring nos bytes crus do PDF nunca bate. Extrai o
 * texto reconstruindo cada bloco BT..ET (uma chamada de .text()): fragmentos
 * DENTRO do mesmo bloco se juntam sem separador (o kerning já preserva os
 * espaços reais do texto), blocos DIFERENTES (linhas diferentes) se juntam
 * com espaço, pra nunca colar o fim de uma linha no início da próxima.
 */
function extractPdfText(pdf: Buffer): string {
  const raw = pdf.toString("latin1");
  const blocks = raw.match(/BT[\s\S]*?ET/g) ?? [];
  return blocks
    .map((block) => {
      const hexTokens = block.match(/<([0-9a-fA-F]+)>/g) ?? [];
      return hexTokens.map((tok) => Buffer.from(tok.slice(1, -1), "hex").toString("latin1")).join("");
    })
    .join(" ");
}

async function setPlan(plan: "free" | "basic" | "premium" | null) {
  await db.delete(subscriptionsTable).where(eq(subscriptionsTable.familyId, familyId));
  if (plan) await db.insert(subscriptionsTable).values({ familyId, plan, status: "active" });
}

async function insertDose(
  localDate: string,
  localTime: string,
  status: "pending" | "taken" | "skipped" | "late" | "postponed" | "partial",
  // Issue #170: a dose da DOSE. `scheduled_doses.dose` é instantâneo — é o
  // que valia no dia —, e era justamente isso que o relatório ignorava.
  doseDoDia = "1 comprimido",
) {
  const [dose] = await db.insert(scheduledDosesTable).values({
    treatmentId, patientId,
    scheduledAt: new Date(`${localDate}T${localTime}:00-03:00`),
    scheduledLocalDate: localDate, scheduledLocalTime: localTime,
    status, dose: doseDoDia,
  }).returning();
  return dose.id;
}
async function insertDoseRecord(scheduledDoseId: number, outcome: "taken" | "skipped" | "postponed" | "partial", takenAtLocal: string) {
  await db.insert(doseRecordsTable).values({ scheduledDoseId, patientId, caregiverId: primaryCaregiverId, takenAt: new Date(takenAtLocal), outcome });
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

  const [family] = await db.insert(familiesTable).values({ name: "Família Relatório Teste", slug: `report-test-${Date.now()}` }).returning();
  familyId = family.id;

  const [user] = await db.insert(usersTable).values({ email: `report-test-${Date.now()}@zelo.test`, name: "Cuidador Relatório", passwordHash: await hashPassword("x"), emailVerified: true, status: "active" }).returning();
  const [caregiver] = await db.insert(caregiversTable).values({ familyId, userId: user.id, name: "Cuidador Relatório", role: "primary_caregiver" }).returning();
  primaryCaregiverId = caregiver.id;
  token = generateAccessToken(user.id, familyId, caregiver.id, "primary_caregiver");

  const [patient] = await db.insert(patientsTable).values({ familyId, name: "Paciente Relatório Teste", timezone: "America/Sao_Paulo" }).returning();
  patientId = patient.id;

  const [medication] = await db.insert(medicationsTable).values({ familyId, name: "Medicamento Relatório Teste" }).returning();
  medicationId = medication.id;

  const [treatment] = await db.insert(treatmentsTable).values({
    patientId, medicationId, scheduleType: "times_per_day",
    scheduleConfig: { scheduleType: "times_per_day", times: ["08:00"] }, startDate: "2026-01-01",
  }).returning();
  treatmentId = treatment.id;
});

after(async () => {
  Clock.reset();
  await closeServer();
  await db.delete(familiesTable).where(eq(familiesTable.id, familyId));
});

describe("Paywall duro — exclusivo do plano pago", () => {
  it("sem plano pago, POST /adherence-report devolve 403 e não cria nada", async () => {
    await setPlan(null);
    const res = await api("POST", `/patients/${patientId}/adherence-report`, { from: "2026-02-01", to: "2026-02-05" });
    assert.equal(res.status, 403);

    const rows = await db.select().from(adherenceReportsTable).where(eq(adherenceReportsTable.patientId, patientId));
    assert.equal(rows.length, 0, "nenhum relatório deveria ter sido criado sem plano pago");
  });

  it("plano free (linha existente, plan='free') também é bloqueado, igual sem linha nenhuma", async () => {
    await setPlan("free");
    const res = await api("POST", `/patients/${patientId}/adherence-report`, { from: "2026-02-01", to: "2026-02-05" });
    assert.equal(res.status, 403);
  });

  it("com plano pago, gera normalmente", async () => {
    await setPlan("premium");
    const res = await api("POST", `/patients/${patientId}/adherence-report`, { from: "2026-02-01", to: "2026-02-05" });
    assert.equal(res.status, 200);
    const body = res.body as { reportId: number; downloadUrl: string; expiresAt: string };
    assert.ok(body.reportId > 0);
    assert.ok(body.downloadUrl.startsWith("/api/reports/"));

    const daysUntilExpiry = (new Date(body.expiresAt).getTime() - Clock.now().getTime()) / 86_400_000;
    assert.ok(daysUntilExpiry > 6.9 && daysUntilExpiry < 7.1, `link deveria expirar em ~7 dias, expira em ${daysUntilExpiry}`);
  });
});

describe("Números batem com o histórico", () => {
  it("tomadas/puladas/sem-registro e % de adesão conferem, adiada conta como pulada", async () => {
    const doseTaken1 = await insertDose("2026-03-01", "08:00", "taken");
    await insertDoseRecord(doseTaken1, "taken", "2026-03-01T08:10:00-03:00");
    const doseTaken2 = await insertDose("2026-03-02", "08:00", "taken");
    await insertDoseRecord(doseTaken2, "taken", "2026-03-02T08:20:00-03:00");
    const doseSkipped = await insertDose("2026-03-03", "08:00", "skipped");
    await insertDoseRecord(doseSkipped, "skipped", "2026-03-03T08:00:00-03:00");
    await insertDose("2026-03-04", "08:00", "postponed"); // adiada — conta como pulada no relatório
    await insertDose("2026-03-05", "08:00", "pending"); // sem registro
    await insertDose("2026-03-06", "08:00", "late"); // sem registro

    const data = await computeReportData(patientId, "2026-03-01", "2026-03-06");
    assert.equal(data.medications.length, 1);
    const med = data.medications[0];
    assert.equal(med.totalScheduled, 6);
    assert.equal(med.taken, 2);
    assert.equal(med.skipped, 2, "1 skipped + 1 postponed");
    assert.equal(med.unregistered, 2, "1 pending + 1 late");
    assert.equal(med.adherenceRate, 2 / 6);

    await db.delete(scheduledDosesTable).where(eq(scheduledDosesTable.patientId, patientId));
  });

  it("padrão de horário real vs prescrito — delta médio calculado só sobre as doses tomadas", async () => {
    const d1 = await insertDose("2026-04-01", "08:00", "taken");
    await insertDoseRecord(d1, "taken", "2026-04-01T08:10:00-03:00"); // +10min
    const d2 = await insertDose("2026-04-02", "08:00", "taken");
    await insertDoseRecord(d2, "taken", "2026-04-02T08:20:00-03:00"); // +20min
    await insertDose("2026-04-03", "08:00", "skipped"); // não entra na média (não foi tomada)

    const data = await computeReportData(patientId, "2026-04-01", "2026-04-03");
    const med = data.medications[0];
    assert.equal(med.actualVsPrescribed.length, 1);
    const avp = med.actualVsPrescribed[0];
    assert.equal(avp.prescribedTime, "08:00");
    assert.equal(avp.sampleSize, 2, "só as 2 doses tomadas entram na média, não a pulada");
    assert.equal(avp.averageActualTime, "08:15", "média de 08:10 e 08:20");
    assert.equal(avp.averageDeltaMinutes, 15);

    await db.delete(scheduledDosesTable).where(eq(scheduledDosesTable.patientId, patientId));
  });

  it("inclui aferições registradas no período, cruas, sem interpretação", async () => {
    const [m] = await db.insert(healthMeasurementsTable).values({
      patientId, type: "blood_pressure", value: "120/80", unit: "mmHg",
      measuredAt: new Date("2026-05-01T10:00:00-03:00"), caregiverId: primaryCaregiverId,
    }).returning();

    const data = await computeReportData(patientId, "2026-05-01", "2026-05-01");
    assert.equal(data.measurements.length, 1);
    assert.equal(data.measurements[0].value, "120/80");
    assert.equal(data.measurements[0].type, "blood_pressure");

    await db.delete(healthMeasurementsTable).where(eq(healthMeasurementsTable.id, m.id));
  });

  it("90 dias de histórico geram o relatório em menos de 5s (critério de aceite)", async () => {
    await setPlan("premium");
    const ids: number[] = [];
    for (let i = 0; i < 90; i++) {
      const date = new Date(Date.UTC(2026, 5, 1 + i)).toISOString().slice(0, 10);
      const id = await insertDose(date, "08:00", i % 3 === 0 ? "skipped" : "taken");
      ids.push(id);
      if (i % 3 !== 0) await insertDoseRecord(id, "taken", `${date}T08:05:00-03:00`);
    }

    const start = Date.now();
    const res = await api("POST", `/patients/${patientId}/adherence-report`, { from: "2026-06-01", to: "2026-08-29" });
    const elapsedMs = Date.now() - start;
    assert.equal(res.status, 200);
    assert.ok(elapsedMs < 5000, `deveria gerar em menos de 5s, levou ${elapsedMs}ms`);

    await db.delete(scheduledDosesTable).where(eq(scheduledDosesTable.patientId, patientId));
  });
});

describe("PDF gerado — conteúdo e regras absolutas", () => {
  it("é um PDF válido, com o rodapé obrigatório e sem nenhuma frase de interpretação clínica", async () => {
    const data = await computeReportData(patientId, "2026-02-01", "2026-02-05");
    const pdf = await generateReportPdf(data);

    assert.equal(pdf.subarray(0, 4).toString("latin1"), "%PDF", "deveria começar com o cabeçalho de um PDF de verdade");

    const text = extractPdfText(pdf);
    assert.ok(
      text.includes("Documento gerado por relato do cuidador"),
      "rodapé obrigatório precisa estar sempre presente"
    );

    const forbidden = [
      "recomendamos", "sugerimos", "você deveria", "aconselhamos",
      "isso indica", "isso pode significar", "risco de", "fora da faixa",
      "faixa de referência", "anormal", "preocupante", "consulte um médico imediatamente",
    ];
    const lower = text.toLowerCase();
    for (const phrase of forbidden) {
      assert.ok(!lower.includes(phrase), `PDF não pode conter "${phrase}" — é relato, não interpretação`);
    }
  });
});

describe("Link assinado e expirável", () => {
  it("GET /reports/:token com token válido devolve o PDF (sem autenticação)", async () => {
    await setPlan("premium");
    const gen = await api("POST", `/patients/${patientId}/adherence-report`, { from: "2026-02-01", to: "2026-02-05" });
    const { downloadUrl } = gen.body as { downloadUrl: string };
    const path = downloadUrl.replace("/api", "");

    const res = await rawGet(path);
    assert.equal(res.status, 200);
    assert.equal(res.contentType, "application/pdf");
    assert.equal(res.body.subarray(0, 4).toString("latin1"), "%PDF");
  });

  it("token inválido/inexistente devolve 410, não 404", async () => {
    const res = await rawGet("/reports/token-que-nunca-existiu");
    assert.equal(res.status, 410);
  });

  it("link expirado para de servir o arquivo (410)", async () => {
    await setPlan("premium");
    const gen = await api("POST", `/patients/${patientId}/adherence-report`, { from: "2026-02-01", to: "2026-02-05" });
    const { reportId, downloadUrl } = gen.body as { reportId: number; downloadUrl: string };
    const path = downloadUrl.replace("/api", "");

    await db.update(adherenceReportsTable).set({ expiresAt: new Date(Clock.now().getTime() - 1000) }).where(eq(adherenceReportsTable.id, reportId));

    const res = await rawGet(path);
    assert.equal(res.status, 410);
  });

  it("não é de uso único — abrir duas vezes dentro da validade funciona nas duas", async () => {
    await setPlan("premium");
    const gen = await api("POST", `/patients/${patientId}/adherence-report`, { from: "2026-02-01", to: "2026-02-05" });
    const { downloadUrl } = gen.body as { downloadUrl: string };
    const path = downloadUrl.replace("/api", "");

    const first = await rawGet(path);
    const second = await rawGet(path);
    assert.equal(first.status, 200);
    assert.equal(second.status, 200, "médico pode abrir o link mais de uma vez — não é export de uso único");
  });
});

describe("Isolamento entre famílias", () => {
  it("família B não gera relatório pra paciente de A", async () => {
    const [familyB] = await db.insert(familiesTable).values({ name: "Família B Relatório", slug: `report-b-${Date.now()}` }).returning();
    const [userB] = await db.insert(usersTable).values({ email: `report-b-${Date.now()}@zelo.test`, name: "Cuidador B", passwordHash: await hashPassword("x"), emailVerified: true, status: "active" }).returning();
    const [caregiverB] = await db.insert(caregiversTable).values({ familyId: familyB.id, userId: userB.id, name: "Cuidador B", role: "primary_caregiver" }).returning();
    const tokenB = generateAccessToken(userB.id, familyB.id, caregiverB.id, "primary_caregiver");
    await db.insert(subscriptionsTable).values({ familyId: familyB.id, plan: "premium", status: "active" });

    const res = await api("POST", `/patients/${patientId}/adherence-report`, { from: "2026-02-01", to: "2026-02-05" }, tokenB);
    assert.equal(res.status, 404);

    await db.delete(familiesTable).where(eq(familiesTable.id, familyB.id));
  });
});

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * A DOSE DO PERÍODO, E NÃO A DE HOJE — Issue #170.
 *
 * O relatório lia `treatments.dose`: um campo só, com o valor de AGORA. Num
 * desmame, o PDF de um período passado imprimia a dose do fim para doses que
 * foram do começo — e é o documento que vai ao médico.
 *
 * ── Por que nenhum teste pegou isto ──────────────────────────────────────
 *
 * Porque **nenhum caso mudava a dose depois de registrar**. Todos criavam o
 * tratamento e o relatório no mesmo estado, e nesse estado os dois valores
 * coincidem. O defeito só aparece quando o tempo passa entre uma coisa e
 * outra — que é exatamente o que um desmame faz.
 * ═══════════════════════════════════════════════════════════════════════════
 */
describe("A dose que o relatorio imprime", () => {
  it("e a que valia em cada dose, nao a do tratamento hoje", async () => {
    // Um desmame: 40mg nos três primeiros dias, 10mg nos três seguintes.
    for (const dia of ["2026-04-01", "2026-04-02", "2026-04-03"]) {
      const id = await insertDose(dia, "08:00", "taken", "40mg");
      await insertDoseRecord(id, "taken", `${dia}T08:05:00-03:00`);
    }
    for (const dia of ["2026-04-04", "2026-04-05", "2026-04-06"]) {
      const id = await insertDose(dia, "08:00", "taken", "10mg");
      await insertDoseRecord(id, "taken", `${dia}T08:05:00-03:00`);
    }

    // E o tratamento, HOJE, está numa terceira dose — o desmame terminou.
    await db.update(treatmentsTable).set({ dose: "5mg" }).where(eq(treatmentsTable.id, treatmentId));

    const data = await computeReportData(patientId, "2026-04-01", "2026-04-06");
    const med = data.medications[0];

    assert.ok(
      med.dose?.includes("40mg"),
      "a dose do começo do período tem que aparecer — foi ela que o paciente tomou",
    );
    assert.ok(med.dose?.includes("10mg"), "e a do fim do período também");
    assert.ok(
      !med.dose?.includes("5mg"),
      "a dose de HOJE não pode aparecer num relatório de um período em que ela " +
        "não valia. Era este o defeito da #170, e é o documento que vai ao médico.",
    );
  });

  it("com uma dose so no periodo, a frase sai igual a de sempre", async () => {
    const id = await insertDose("2026-05-10", "08:00", "taken", "1 comprimido");
    await insertDoseRecord(id, "taken", "2026-05-10T08:05:00-03:00");

    const data = await computeReportData(patientId, "2026-05-10", "2026-05-10");

    // O caso comum é este, e ele não pode ter ganhado vírgula nem lista.
    assert.equal(data.medications[0].dose, "1 comprimido");
  });
});

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * "TOMOU EM PARTE" NÃO SOMA COM NENHUM DOS DOIS — Issue #175.
 *
 * Em idoso com dificuldade de engolir — disfagia, demência avançada, náusea
 * de quimioterapia — cuspir metade do comprimido ou vomitar dez minutos
 * depois é rotina. O cuidador escolhia entre duas respostas erradas: marcar
 * tomada, e o médico achar que a dose entrou; ou pular, e ele achar que nem
 * se tentou.
 *
 * O app **não sabe** quanto foi absorvido, e somar em qualquer dos dois lados
 * seria ele decidindo isso (invariante 4). Balde próprio, número próprio, e a
 * frase do cuidador ao lado.
 * ═══════════════════════════════════════════════════════════════════════════
 */
describe("A dose tomada em parte", () => {
  it("conta em balde proprio, sem somar em tomada nem em pulada", async () => {
    const tomada = await insertDose("2026-06-01", "08:00", "taken");
    await insertDoseRecord(tomada, "taken", "2026-06-01T08:05:00-03:00");
    const pulada = await insertDose("2026-06-02", "08:00", "skipped");
    await insertDoseRecord(pulada, "skipped", "2026-06-02T08:05:00-03:00");
    const parcial = await insertDose("2026-06-03", "08:00", "partial");
    await insertDoseRecord(parcial, "partial", "2026-06-03T08:05:00-03:00");

    const data = await computeReportData(patientId, "2026-06-01", "2026-06-03");
    const med = data.medications[0];

    assert.equal(med.partial, 1, "a parcial precisa aparecer, e com nome próprio");
    assert.equal(med.taken, 1, "somar a parcial em tomada diria ao médico que a dose entrou");
    assert.equal(med.skipped, 1, "somar em pulada diria que nem se tentou");
    assert.equal(med.totalScheduled, 3);
  });

  it("a parcial NAO entra no percentual de adesao", async () => {
    const parcial = await insertDose("2026-07-01", "08:00", "partial");
    await insertDoseRecord(parcial, "partial", "2026-07-01T08:05:00-03:00");
    const tomada = await insertDose("2026-07-02", "08:00", "taken");
    await insertDoseRecord(tomada, "taken", "2026-07-02T08:05:00-03:00");

    const data = await computeReportData(patientId, "2026-07-01", "2026-07-02");

    // Adesão é `taken / total`. Contar a parcial ali seria o app afirmando
    // que a dose foi tomada — que é exatamente o que ele não sabe.
    assert.equal(data.medications[0].adherenceRate, 1 / 2);
  });
});

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * OS DEGRAUS COM AS DATAS — Issue #172.
 *
 * A #170 fez o relatório ler a dose de cada dose agendada, mas as juntava em
 * ordem ALFABÉTICA: um desmame saía "10mg, 20mg, 40mg" — a ordem exata do
 * contrário do que aconteceu, e sem dizer quando cada uma valeu.
 *
 * Num documento que vai ao médico, a sequência de um desmame É a informação.
 * ═══════════════════════════════════════════════════════════════════════════
 */
describe("Os degraus do desmame no relatorio", () => {
  it("saem em ordem cronologica, com o primeiro e o ultimo dia de cada um", async () => {
    for (const dia of ["2026-09-01", "2026-09-02"]) {
      const id = await insertDose(dia, "08:00", "taken", "40mg");
      await insertDoseRecord(id, "taken", `${dia}T08:05:00-03:00`);
    }
    for (const dia of ["2026-09-03", "2026-09-04"]) {
      const id = await insertDose(dia, "08:00", "taken", "20mg");
      await insertDoseRecord(id, "taken", `${dia}T08:05:00-03:00`);
    }
    for (const dia of ["2026-09-05", "2026-09-06"]) {
      const id = await insertDose(dia, "08:00", "taken", "10mg");
      await insertDoseRecord(id, "taken", `${dia}T08:05:00-03:00`);
    }

    const data = await computeReportData(patientId, "2026-09-01", "2026-09-06");
    const med = data.medications[0];

    assert.deepEqual(
      med.dosePeriods,
      [
        { dose: "40mg", from: "2026-09-01", to: "2026-09-02" },
        { dose: "20mg", from: "2026-09-03", to: "2026-09-04" },
        { dose: "10mg", from: "2026-09-05", to: "2026-09-06" },
      ],
      "a ordem tem que ser a do desmame, não a do alfabeto",
    );

    // E a frase impressa carrega as datas, senão o médico vê três doses sem
    // saber qual veio quando.
    assert.equal(
      med.dose,
      "40mg (01/09/2026 a 02/09/2026), 20mg (03/09/2026 a 04/09/2026), 10mg (05/09/2026 a 06/09/2026)",
    );
  });

  it("com uma dose so, nenhuma data aparece", async () => {
    const id = await insertDose("2026-10-20", "08:00", "taken", "1 comprimido");
    await insertDoseRecord(id, "taken", "2026-10-20T08:05:00-03:00");

    const data = await computeReportData(patientId, "2026-10-20", "2026-10-20");
    const med = data.medications[0];

    // A esmagadora maioria dos tratamentos é de dose única. "1 comprimido
    // (20/10/2026 a 20/10/2026)" seria ruído em todo relatório do app.
    assert.equal(med.dose, "1 comprimido");
    assert.deepEqual(med.dosePeriods, [{ dose: "1 comprimido", from: "2026-10-20", to: "2026-10-20" }]);
  });

  it("o PDF imprime um degrau por linha", async () => {
    for (const [dia, dose] of [["2026-11-01", "40mg"], ["2026-11-02", "20mg"]] as const) {
      const id = await insertDose(dia, "08:00", "taken", dose);
      await insertDoseRecord(id, "taken", `${dia}T08:05:00-03:00`);
    }

    const data = await computeReportData(patientId, "2026-11-01", "2026-11-02");
    const texto = extractPdfText(await generateReportPdf(data));

    // Uma tira só com quatro ou cinco degraus é lida torto. Cada degrau na
    // sua linha, com as datas ao lado.
    assert.match(texto, /Doses no per/i);
    assert.match(texto, /40mg.*01\/11\/2026.*02\/11\/2026|40mg.*01\/11\/2026/);
    assert.match(texto, /20mg/);
    // E o app não opina sobre o desenho do desmame em lugar nenhum (inv. 4).
    assert.doesNotMatch(texto, /recomend|sugerimos|deve reduzir|pode parar/i);
  });
});
