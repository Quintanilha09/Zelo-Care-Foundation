/**
 * O remédio "se necessário" — Issue #169.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * OS CINCO CRITÉRIOS DE ACEITE, E UM SEXTO QUE É O INVARIANTE 4.
 *
 *   1. dá para cadastrar, com intervalo mínimo e teto diário opcionais
 *   2. não gera dose agendada, não fica pendente e não entra na adesão
 *   3. registrar mostra a última vez e a contagem do dia
 *   4. o uso aparece no relatório do médico, em seção própria
 *   5. lembrete nenhum dispara para ele
 *   6. o app NÃO julga: nada na resposta diz se pode ou não pode dar
 * ═══════════════════════════════════════════════════════════════════════════
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
import { Clock } from "../lib/clock.ts";
import { boss } from "../lib/queue.ts";
import { generateDosesForTreatment } from "../lib/dose-generation.ts";
import { computeReportData, generateReportPdf } from "../lib/adherence-report.ts";
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

/** Cria um "se necessário" e devolve o id. */
async function criarSeNecessario(receita?: { intervaloMinimoHoras?: number; tetoDiario?: number }) {
  const res = await api("POST", `/patients/${patientId}/treatments`, {
    medicationId,
    dose: "1 comprimido",
    scheduleConfig: { scheduleType: "se_necessario", ...receita },
    startDate: Clock.todayInTimezone("America/Sao_Paulo"),
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
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
    .values({ name: "Família Fictícia Se Necessário", slug: `prn-test-${Date.now()}` })
    .returning();
  familyId = family.id;

  const [user] = await db
    .insert(usersTable)
    .values({
      email: `prn-${Date.now()}@zelo.test`, name: "Cuidador Teste",
      passwordHash: await hashPassword("x"), emailVerified: true, status: "active",
    })
    .returning();
  const [caregiver] = await db
    .insert(caregiversTable)
    .values({ familyId, userId: user.id, name: "Cuidador Teste", role: "primary_caregiver" })
    .returning();
  token = generateAccessToken(user.id, familyId, caregiver.id, "primary_caregiver");

  // Um paciente só no arquivo inteiro: o plano gratuito permite um, e criar
  // outro devolveria PLAN_LIMIT no meio de um teste que não é sobre plano.
  const [patient] = await db
    .insert(patientsTable)
    .values({ familyId, name: "Dona Maria Teste", timezone: "America/Sao_Paulo" })
    .returning();
  patientId = patient.id;

  const [medication] = await db
    .insert(medicationsTable)
    .values({ familyId, name: "Dipirona Fictícia (fictício)" })
    .returning();
  medicationId = medication.id;
});

after(async () => {
  Clock.reset();
  await closeServer();
  await boss.stop({ graceful: false });
  await db.delete(familiesTable).where(eq(familiesTable.id, familyId));
});

describe("Cadastrar um se necessario", () => {
  it("aceita com intervalo minimo e teto diario", async () => {
    const id = await criarSeNecessario({ intervaloMinimoHoras: 6, tetoDiario: 4 });

    const [t] = await db.select().from(treatmentsTable).where(eq(treatmentsTable.id, id));
    assert.equal(t.scheduleType, "se_necessario");
    assert.deepEqual(t.scheduleConfig, {
      scheduleType: "se_necessario", intervaloMinimoHoras: 6, tetoDiario: 4,
    });

    await db.delete(treatmentsTable).where(eq(treatmentsTable.id, id));
  });

  it("aceita sem nenhum dos dois: a receita pode nao dizer", async () => {
    const id = await criarSeNecessario();
    const [t] = await db.select().from(treatmentsTable).where(eq(treatmentsTable.id, id));
    // Ausente, e não zero. Um `0` seria o app inventando um limite que
    // ninguém prescreveu.
    assert.deepEqual(t.scheduleConfig, { scheduleType: "se_necessario" });
    await db.delete(treatmentsTable).where(eq(treatmentsTable.id, id));
  });

  it("recusa times: se tem horario, nao e se necessario", async () => {
    const res = await api("POST", `/patients/${patientId}/treatments`, {
      medicationId,
      dose: "1 comprimido",
      scheduleConfig: { scheduleType: "se_necessario", times: ["08:00"] },
      startDate: Clock.todayInTimezone("America/Sao_Paulo"),
    });
    // O zod é estrito: um campo a mais não passa despercebido virando um
    // tratamento que a tela não sabe desenhar.
    assert.equal(res.status, 400);
  });
});

describe("O se necessario nao tem dose agendada", () => {
  it("criar nao gera nenhuma, e rodar a geracao de novo tambem nao", async () => {
    const id = await criarSeNecessario({ intervaloMinimoHoras: 6 });

    const logoDepois = await db
      .select().from(scheduledDosesTable).where(eq(scheduledDosesTable.treatmentId, id));
    assert.equal(logoDepois.length, 0, "criar um se necessário não pode agendar nada");

    // O job diário passa por todo tratamento ativo. Se ele gerasse aqui, o
    // remédio apareceria como pendente amanhã de manhã.
    const criadas = await generateDosesForTreatment(id);
    assert.equal(criadas, 0);

    const depoisDoJob = await db
      .select().from(scheduledDosesTable).where(eq(scheduledDosesTable.treatmentId, id));
    assert.equal(depoisDoJob.length, 0);

    await db.delete(treatmentsTable).where(eq(treatmentsTable.id, id));
  });

  it("nao aparece nas doses de hoje, mas aparece em Se precisar", async () => {
    const id = await criarSeNecessario({ intervaloMinimoHoras: 6, tetoDiario: 4 });

    const res = await api("GET", `/patients/${patientId}/today-doses`);
    assert.equal(res.status, 200);
    const corpo = res.body as {
      doses: Array<{ treatmentId: number }>;
      sePrecisar: Array<{ treatmentId: number; intervaloMinimoHoras: number | null; tetoDiario: number | null; usosHoje: number; ultimoUso: string | null }>;
    };

    assert.ok(
      !corpo.doses.some((d) => d.treatmentId === id),
      "no meio das doses do dia ele pareceria tarefa pendente",
    );
    const meu = corpo.sePrecisar.find((s) => s.treatmentId === id);
    assert.ok(meu, "a seção própria é onde ele vive");
    // A receita volta CRUA, do jeito que foi digitada.
    assert.equal(meu.intervaloMinimoHoras, 6);
    assert.equal(meu.tetoDiario, 4);
    assert.equal(meu.usosHoje, 0);
    assert.equal(meu.ultimoUso, null);

    await db.delete(treatmentsTable).where(eq(treatmentsTable.id, id));
  });
});

describe("Registrar um uso", () => {
  it("grava a dose ja tomada e o registro dela", async () => {
    const id = await criarSeNecessario();

    const res = await api("POST", `/patients/${patientId}/treatments/${id}/uso`, {});
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const criado = res.body as { recordId: number; scheduledDoseId: number };

    const [dose] = await db
      .select().from(scheduledDosesTable).where(eq(scheduledDosesTable.id, criado.scheduledDoseId));
    // Nasce TOMADA e nunca foi pendente — por isso não há o que atrasar.
    assert.equal(dose.status, "taken");
    assert.equal(dose.dose, "1 comprimido");

    const [registro] = await db
      .select().from(doseRecordsTable).where(eq(doseRecordsTable.id, criado.recordId));
    assert.equal(registro.outcome, "taken");

    await db.delete(treatmentsTable).where(eq(treatmentsTable.id, id));
  });

  it("devolve a ultima vez e a contagem do dia — e nenhum veredito", async () => {
    const id = await criarSeNecessario({ intervaloMinimoHoras: 6, tetoDiario: 4 });

    const primeiro = await api("POST", `/patients/${patientId}/treatments/${id}/uso`, {});
    assert.equal(primeiro.status, 201);
    const antes = primeiro.body as { ultimoUsoAntesDeste: string | null; usosHojeAntesDeste: number };
    assert.equal(antes.ultimoUsoAntesDeste, null, "o primeiro uso não tem um anterior");
    assert.equal(antes.usosHojeAntesDeste, 0);

    // Segundo uso, MINUTOS depois do primeiro — bem dentro do intervalo de
    // 6 h que a receita pede.
    const segundo = await api("POST", `/patients/${patientId}/treatments/${id}/uso`, {});
    assert.equal(
      segundo.status,
      201,
      "o app NUNCA recusa um uso por causa do intervalo: isso seria prescrever",
    );
    const depois = segundo.body as { ultimoUsoAntesDeste: string | null; usosHojeAntesDeste: number };
    assert.ok(depois.ultimoUsoAntesDeste, "a última vez é fato registrado, e a tela mostra");
    assert.equal(depois.usosHojeAntesDeste, 1);

    /**
     * O INVARIANTE 4, medido no corpo da resposta.
     *
     * Mostrar "a última foi há 2 h" é registro. Dizer "ainda não pode dar" é
     * prescrição. Se um dia alguém acrescentar um `podeDar`, um `bloqueado`
     * ou um `aviso` aqui, este teste reprova — e é para reprovar.
     */
    const cru = JSON.stringify(segundo.body);
    for (const proibido of ["podeDar", "bloqueado", "excedeu", "aguarde", "aindaNaoPode", "limiteAtingido"]) {
      assert.ok(!cru.includes(proibido), `a resposta não pode julgar: achei "${proibido}"`);
    }

    await db.delete(treatmentsTable).where(eq(treatmentsTable.id, id));
  });

  it("aceita um horario de antes, e recusa um do futuro", async () => {
    const id = await criarSeNecessario();
    const agora = Clock.now();

    const ontem = new Date(agora.getTime() - 20 * 3_600_000).toISOString();
    const retro = await api("POST", `/patients/${patientId}/treatments/${id}/uso`, { takenAt: ontem });
    // "Dei ontem à noite e esqueci de marcar" é o caso comum, e não pede
    // justificativa nenhuma: sem hora marcada não há atraso a justificar.
    assert.equal(retro.status, 201, JSON.stringify(retro.body));

    const amanha = new Date(agora.getTime() + 4 * 3_600_000).toISOString();
    const futuro = await api("POST", `/patients/${patientId}/treatments/${id}/uso`, { takenAt: amanha });
    assert.equal(futuro.status, 400);

    await db.delete(treatmentsTable).where(eq(treatmentsTable.id, id));
  });

  it("dois usos no mesmo minuto exato: os dois entram", async () => {
    const id = await criarSeNecessario();
    const instante = new Date(Clock.now().getTime() - 3_600_000).toISOString();

    const a = await api("POST", `/patients/${patientId}/treatments/${id}/uso`, { takenAt: instante });
    const b = await api("POST", `/patients/${patientId}/treatments/${id}/uso`, { takenAt: instante });
    // `UNIQUE(treatment_id, scheduled_at)` existe para a agenda não duplicar
    // dose. Aqui ele encontraria um caso legítimo — recusar seria dizer ao
    // cuidador que ele não pode registrar o que fez.
    assert.equal(a.status, 201, JSON.stringify(a.body));
    assert.equal(b.status, 201, JSON.stringify(b.body));

    const doses = await db
      .select().from(scheduledDosesTable).where(eq(scheduledDosesTable.treatmentId, id));
    assert.equal(doses.length, 2);

    await db.delete(treatmentsTable).where(eq(treatmentsTable.id, id));
  });

  it("a rota recusa um tratamento de horario fixo", async () => {
    const criado = await api("POST", `/patients/${patientId}/treatments`, {
      medicationId,
      dose: "1 comprimido",
      scheduleConfig: { scheduleType: "times_per_day", times: ["08:00"] },
      startDate: Clock.todayInTimezone("America/Sao_Paulo"),
    });
    const id = (criado.body as { id: number }).id;

    const res = await api("POST", `/patients/${patientId}/treatments/${id}/uso`, {});
    // Um remédio de hora marcada já tem dose agendada. Registrar por aqui
    // criaria uma dose fora da agenda dele — duas verdades no mesmo dia.
    assert.equal(res.status, 400);
    assert.equal((res.body as { code?: string }).code, "NAO_E_SE_NECESSARIO");

    await db.delete(treatmentsTable).where(eq(treatmentsTable.id, id));
  });

  it("tratamento de outra familia responde 404, e nao 403", async () => {
    const [outra] = await db
      .insert(familiesTable)
      .values({ name: "Família Fictícia Vizinha", slug: `prn-vizinha-${Date.now()}` })
      .returning();
    const [outroPaciente] = await db
      .insert(patientsTable)
      .values({ familyId: outra.id, name: "Seu João Teste", timezone: "America/Sao_Paulo" })
      .returning();

    const res = await api("POST", `/patients/${outroPaciente.id}/treatments/1/uso`, {});
    // 403 confirmaria que o paciente existe. 404 não conta nada.
    assert.equal(res.status, 404);

    await db.delete(familiesTable).where(eq(familiesTable.id, outra.id));
  });
});

describe("O se necessario no relatorio do medico", () => {
  it("nao entra na adesao, e sai em secao propria com data, hora e motivo", async () => {
    const id = await criarSeNecessario({ intervaloMinimoHoras: 6 });
    const agora = Clock.now();
    const quando = new Date(agora.getTime() - 2 * 3_600_000);

    const res = await api("POST", `/patients/${patientId}/treatments/${id}/uso`, {
      takenAt: quando.toISOString(),
      justification: "Dor de cabeça",
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));

    /**
     * O período vai de ONTEM até hoje, e não de hoje a hoje.
     *
     * "Duas horas atrás" cai em ontem quando a suíte roda na primeira hora
     * depois da meia-noite — e um teste que passa de tarde e reprova de
     * madrugada ensina a desligá-lo. Medido às 00:08 de 12/09/2026, que foi
     * exatamente quando isto apareceu.
     */
    const hoje = Clock.todayInTimezone("America/Sao_Paulo");
    const ontem = new Date(Date.parse(`${hoje}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
    const data = await computeReportData(patientId, ontem, hoje);

    /**
     * ESTE É O CRITÉRIO DE ACEITE INTEIRO.
     *
     * Se o uso entrasse na adesão, o percentual do remédio de horário fixo
     * mudaria por causa de um resgate — e é esse número que o relatório
     * existe para levar ao médico.
     */
    assert.ok(
      !data.medications.some((m) => m.medicationName.includes("Dipirona")),
      "o se necessário não pode aparecer entre os medicamentos com adesão",
    );

    const uso = data.prnUses.find((u) => u.medicationName.includes("Dipirona"));
    assert.ok(uso, "mas o uso tem que aparecer: é sinal clínico");
    assert.ok(
      uso.localDate === hoje || uso.localDate === ontem,
      `o uso tem que cair num dos dois dias do período, e veio ${uso.localDate}`,
    );
    assert.match(uso.localTime, /^\d{2}:\d{2}$/);
    assert.equal(uso.justification, "Dor de cabeça");

    await db.delete(treatmentsTable).where(eq(treatmentsTable.id, id));
  });

  it("o PDF traz a secao, e nao opina sobre ela", async () => {
    const id = await criarSeNecessario();
    await api("POST", `/patients/${patientId}/treatments/${id}/uso`, { justification: "Dor" });

    const hoje = Clock.todayInTimezone("America/Sao_Paulo");
    const ontem = new Date(Date.parse(`${hoje}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
    const data = await computeReportData(patientId, ontem, hoje);
    const pdf = await generateReportPdf(data);
    const texto = pdf.toString("latin1");

    assert.ok(texto.length > 0);
    // Nenhuma leitura clínica do número de usos. "3 usos em 7 dias, acima do
    // habitual" seria o app interpretando — invariante 4.
    for (const proibido of ["acima do habitual", "uso excessivo", "recomendamos", "atenção:"]) {
      assert.ok(!texto.toLowerCase().includes(proibido), `o PDF não pode opinar: "${proibido}"`);
    }

    await db.delete(treatmentsTable).where(eq(treatmentsTable.id, id));
  });
});

describe("Nenhum lembrete dispara para o se necessario", () => {
  it("nao ha dose agendada, e por isso nao ha o que lembrar", async () => {
    const id = await criarSeNecessario();

    // A cascata de lembrete (lib/dose-reminders.ts) é alimentada por dose
    // agendada pendente. Sem nenhuma, ela não tem por onde começar — e é
    // assim, e não com uma exceção espalhada em cada job, que a garantia
    // vale.
    const pendentes = await db
      .select()
      .from(scheduledDosesTable)
      .where(and(
        eq(scheduledDosesTable.treatmentId, id),
        eq(scheduledDosesTable.status, "pending"),
      ));
    assert.equal(pendentes.length, 0);

    await db.delete(treatmentsTable).where(eq(treatmentsTable.id, id));
  });
});
/**
 * ═══════════════════════════════════════════════════════════════════════════
 * A SEGUNDA GARANTIA, DITA EM VOZ ALTA.
 *
 * "Não gera dose agendada" tem HOJE duas garantias independentes:
 *
 *   1. `dose-generation.ts` sai fora antes de expandir (a linha explícita)
 *   2. `lib/scheduling` não conhece o tipo, e a expansão devolve lista vazia
 *
 * A segunda é implícita — e uma garantia implícita é a que some sem ninguém
 * notar. Se um dia alguém acrescentar `se_necessario` ao `ScheduleConfig`
 * (para sugerir horários, por exemplo), a expansão passaria a devolver datas
 * e o remédio voltaria a aparecer como pendente.
 *
 * Este teste falha nesse dia, e diz por quê.
 * ═══════════════════════════════════════════════════════════════════════════
 */
describe("A expansao de agenda nunca aprende o se necessario", () => {
  it("lib/scheduling nao conhece o tipo", async () => {
    const { readFile } = await import("node:fs/promises");
    const { fileURLToPath } = await import("node:url");
    const raiz = fileURLToPath(new URL("../../../../lib/scheduling/src/", import.meta.url));

    for (const arquivo of ["types.ts", "recurrence.ts"]) {
      const fonte = await readFile(raiz + arquivo, "utf8");
      assert.ok(
        !fonte.includes("se_necessario"),
        `lib/scheduling/src/${arquivo} não pode conhecer "se_necessario". ` +
          "Esta biblioteca só sabe de RELÓGIO, e o \"se precisar\" não tem um. " +
          "Se ele entrar aqui, a expansão passa a devolver datas e o remédio " +
          "volta a aparecer como dose pendente — que é exatamente o defeito " +
          "que a Issue #169 existiu para consertar.",
      );
    }
  });
});
describe("O se necessario no calendario", () => {
  it("um dia com so um uso continua cinza, e nao verde", async () => {
    const id = await criarSeNecessario();
    const res = await api("POST", `/patients/${patientId}/treatments/${id}/uso`, {});
    assert.equal(res.status, 201, JSON.stringify(res.body));

    const hoje = Clock.todayInTimezone("America/Sao_Paulo");
    const cal = await api("GET", `/patients/${patientId}/adherence-calendar?from=${hoje}&to=${hoje}`);
    assert.equal(cal.status, 200, JSON.stringify(cal.body));

    const corpo = cal.body as { days: Array<{ date: string; status: string }> };
    const oDia = corpo.days.find((d) => d.date === hoje);
    assert.ok(oDia);
    /**
     * Verde no calendário significa "tudo o que estava MARCADO foi feito".
     *
     * Num domingo sem remédio nenhum marcado, uma dipirona dada por dor de
     * cabeça não é adesão a coisa alguma — e pintar o dia de verde diria ao
     * cuidador que ele cumpriu um plano que não existia.
     */
    assert.equal(
      oDia.status,
      "gray",
      "sem dose marcada não há o que pintar: o uso de um se necessário não pode virar dia verde",
    );

    await db.delete(treatmentsTable).where(eq(treatmentsTable.id, id));
  });
});
