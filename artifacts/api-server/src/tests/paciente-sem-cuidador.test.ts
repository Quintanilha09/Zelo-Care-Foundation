/**
 * Aviso de paciente sem cuidador responsável — Issue #123.
 *
 * ── Como este arquivo observa um e-mail sem mandar e-mail ────────────────
 *
 * `globalThis.fetch` vira um espião, do mesmo jeito que em `email.test.ts`.
 * O que interessa aqui não é o Resend responder: é **o que o ZELO manda**, e
 * quantas vezes.
 *
 * ── Por que as asserções filtram pelo endereço desta suíte ───────────────
 *
 * O job varre o banco INTEIRO — ele não recebe família por parâmetro, porque
 * em produção ele é um cron sem payload. O banco de teste é compartilhado, e
 * outros arquivos deixam família e paciente para trás. Contar "quantos
 * e-mails saíram" mediria a bagunça dos outros; contar "quantos e-mails
 * foram para o endereço desta família" mede este código.
 *
 * ── O caso que mais importa ──────────────────────────────────────────────
 *
 * O do dado de saúde. O paciente do cenário TEM um medicamento e um
 * tratamento de verdade no banco, e o teste lê o corpo enviado e prova que
 * nada disso aparece. Invariante 3: nome do paciente é o limite.
 */

import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { eq, like } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  usersTable,
  familiesTable,
  caregiversTable,
  patientsTable,
  medicationsTable,
  treatmentsTable,
  caregiverPatientsTable,
} from "@workspace/db";
import { Clock } from "../lib/clock.ts";
import { avisarPacientesSemCuidador, DIAS_ATE_O_AVISO } from "../lib/paciente-sem-cuidador.ts";

const SUFIXO = "@sem-cuidador.zelo.test";
const UM_DIA = 86_400_000;
const REMEDIO = "Remedinho Ficticio 500mg";

type Chamada = { url: string; init: RequestInit };

let chamadas: Chamada[] = [];
let fetchOriginal: typeof globalThis.fetch;
let chaveOriginal: string | undefined;

before(() => {
  fetchOriginal = globalThis.fetch;
  chaveOriginal = process.env.RESEND_API_KEY;
  // Sem chave, `enviar()` desiste antes de chamar o `fetch` — e o job não
  // marcaria nada. É exatamente o que acontece em desenvolvimento.
  process.env.RESEND_API_KEY = "re_chave_de_teste";

  globalThis.fetch = ((url: string | URL | Request, init?: RequestInit) => {
    chamadas.push({ url: String(url), init: init ?? {} });
    return Promise.resolve(
      new Response(JSON.stringify({ id: "aceito" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
  }) as typeof globalThis.fetch;
});

after(async () => {
  globalThis.fetch = fetchOriginal;
  if (chaveOriginal === undefined) delete process.env.RESEND_API_KEY;
  else process.env.RESEND_API_KEY = chaveOriginal;
  Clock.reset();

  await db.delete(usersTable).where(like(usersTable.email, `%${SUFIXO}`));
  await db.delete(familiesTable).where(like(familiesTable.name, "Família Fictícia SemCuid %"));
});

beforeEach(() => {
  chamadas = [];
  Clock.reset();
});

interface Cenario {
  familyId: number;
  principalId: number;
  comumId: number;
  emailDoPrincipal: string;
  pacientes: number[];
}

/** Uma família com principal, um segundo cuidador e N pacientes, sem vínculo. */
async function cenario(rotulo: string, nomes: string[]): Promise<Cenario> {
  const marca = `${Date.now()}${Math.floor(Math.random() * 10000)}`;

  const [family] = await db
    .insert(familiesTable)
    .values({
      name: `Família Fictícia SemCuid ${rotulo} ${marca}`,
      slug: `semcuid-${rotulo}-${marca}`,
    })
    .returning({ id: familiesTable.id });

  const criarCuidador = async (papel: "primary_caregiver" | "caregiver", sufixo: string) => {
    const email = `semcuid-${rotulo}-${sufixo}-${marca}${SUFIXO}`;
    const [user] = await db
      .insert(usersTable)
      .values({
        email,
        name: `Pessoa Fictícia ${sufixo}`,
        passwordHash: "hash-nao-usado",
        emailVerified: true,
        status: "active",
        activeFamilyId: family.id,
      })
      .returning({ id: usersTable.id });

    const [c] = await db
      .insert(caregiversTable)
      .values({
        familyId: family.id,
        userId: user.id,
        name: `Pessoa Fictícia ${sufixo}`,
        email,
        role: papel,
      })
      .returning({ id: caregiversTable.id });

    return { id: c.id, email };
  };

  const principal = await criarCuidador("primary_caregiver", "Principal");
  const comum = await criarCuidador("caregiver", "Comum");

  const pacientes: number[] = [];
  for (const nome of nomes) {
    const [p] = await db
      .insert(patientsTable)
      .values({ familyId: family.id, name: nome, timezone: "America/Sao_Paulo" })
      .returning({ id: patientsTable.id });
    pacientes.push(p.id);
  }

  return {
    familyId: family.id,
    principalId: principal.id,
    comumId: comum.id,
    emailDoPrincipal: principal.email,
    pacientes,
  };
}

/** Põe um medicamento e um tratamento de verdade no primeiro paciente. */
async function darUmRemedio(c: Cenario): Promise<void> {
  const [med] = await db
    .insert(medicationsTable)
    .values({ familyId: c.familyId, name: REMEDIO })
    .returning({ id: medicationsTable.id });

  await db.insert(treatmentsTable).values({
    patientId: c.pacientes[0]!,
    medicationId: med.id,
    scheduleType: "times_per_day",
    scheduleConfig: { times: ["08:00"] },
    startDate: Clock.todayInTimezone("America/Sao_Paulo"),
  });
}

/** Envelhece o relógio de "descoberto desde" sem esperar de verdade. */
async function descobertoHa(patientId: number, dias: number): Promise<void> {
  await db
    .update(patientsTable)
    .set({ uncoveredSince: new Date(Clock.now().getTime() - dias * UM_DIA) })
    .where(eq(patientsTable.id, patientId));
}

/** Os e-mails que saíram para ESTA família, já decodificados. */
function emailsPara(endereco: string): Array<{ subject: string; text: string; html: string }> {
  return chamadas
    .map((c) => JSON.parse(String(c.init.body)) as { to: string[]; subject: string; text: string; html: string })
    .filter((corpo) => corpo.to.includes(endereco))
    .map(({ subject, text, html }) => ({ subject, text, html }));
}

describe("Aviso de paciente sem cuidador", () => {
  it("paciente cadastrado hoje não gera aviso; com 2 dias completos, gera", async () => {
    const c = await cenario("janela", ["Dona Maria Teste"]);

    await avisarPacientesSemCuidador();
    assert.equal(
      emailsPara(c.emailDoPrincipal).length,
      0,
      "quem cadastrou o paciente agora não pode ser cobrado no mesmo minuto",
    );

    await descobertoHa(c.pacientes[0]!, DIAS_ATE_O_AVISO);
    chamadas = [];

    await avisarPacientesSemCuidador();
    const emails = emailsPara(c.emailDoPrincipal);
    assert.equal(emails.length, 1);
    assert.ok(emails[0]!.text.includes("Dona Maria Teste"), emails[0]!.text);
  });

  it("vincular alguém dentro da janela impede o aviso", async () => {
    const c = await cenario("vinculado", ["Dona Maria Teste"]);
    await descobertoHa(c.pacientes[0]!, DIAS_ATE_O_AVISO + 5);

    await db.insert(caregiverPatientsTable).values({
      caregiverId: c.comumId,
      patientId: c.pacientes[0]!,
      createdByCaregiverId: c.principalId,
    });

    await avisarPacientesSemCuidador();
    assert.equal(emailsPara(c.emailDoPrincipal).length, 0);

    // E o relógio voltou a zero: é o que faz o aviso valer de novo se a
    // pessoa for desvinculada mais tarde.
    const [p] = await db
      .select({ desde: patientsTable.uncoveredSince })
      .from(patientsTable)
      .where(eq(patientsTable.id, c.pacientes[0]!));
    assert.ok(
      p!.desde.getTime() > Clock.now().getTime() - UM_DIA,
      "o relógio do paciente coberto tinha de ter sido zerado",
    );
  });

  it("três descobertos na mesma família viram UM e-mail, com os três", async () => {
    const c = await cenario("tres", ["Dona Maria Teste", "Seu João Teste", "Dona Rita Teste"]);
    for (const id of c.pacientes) await descobertoHa(id, DIAS_ATE_O_AVISO + 1);

    await avisarPacientesSemCuidador();

    const emails = emailsPara(c.emailDoPrincipal);
    assert.equal(emails.length, 1, "três e-mails sobre o mesmo problema viram regra de filtro");
    for (const nome of ["Dona Maria Teste", "Seu João Teste", "Dona Rita Teste"]) {
      assert.ok(emails[0]!.text.includes(nome), `faltou ${nome} no e-mail`);
    }
  });

  it("o aviso não se repete no dia seguinte se nada mudou", async () => {
    const c = await cenario("repeticao", ["Dona Maria Teste"]);
    await descobertoHa(c.pacientes[0]!, DIAS_ATE_O_AVISO);

    await avisarPacientesSemCuidador();
    assert.equal(emailsPara(c.emailDoPrincipal).length, 1);

    chamadas = [];
    Clock.advance(UM_DIA);
    await avisarPacientesSemCuidador();
    assert.equal(
      emailsPara(c.emailDoPrincipal).length,
      0,
      "aviso diário sobre o mesmo paciente é ruído, e ruído acaba filtrado",
    );
  });

  it("o e-mail não carrega dado de saúde nenhum", async () => {
    const c = await cenario("saude", ["Dona Maria Teste"]);
    await darUmRemedio(c);
    await descobertoHa(c.pacientes[0]!, DIAS_ATE_O_AVISO);

    await avisarPacientesSemCuidador();

    const emails = emailsPara(c.emailDoPrincipal);
    assert.equal(emails.length, 1);

    // O paciente TEM este remédio no banco. O e-mail nomeia a pessoa e para
    // por aí — invariante 3.
    for (const versao of [emails[0]!.text, emails[0]!.html, emails[0]!.subject]) {
      assert.ok(!versao.includes(REMEDIO), "nome de medicamento vazou no e-mail");
      assert.ok(!versao.includes("Remedinho"), "nome de medicamento vazou no e-mail");
      assert.ok(!versao.includes("500mg"), "dose vazou no e-mail");
      assert.ok(!versao.includes("08:00"), "horário de dose vazou no e-mail");
    }
  });

  it("o e-mail diz, com todas as letras, que isto não bloqueia nada", async () => {
    // Sem esta frase alguém lê "sem cuidador responsável" e supõe que o
    // paciente ficou trancado para os outros. Agir com base nessa suposição é
    // pior que não ter recebido aviso nenhum.
    const c = await cenario("naobloqueia", ["Dona Maria Teste"]);
    await descobertoHa(c.pacientes[0]!, DIAS_ATE_O_AVISO);

    await avisarPacientesSemCuidador();

    const emails = emailsPara(c.emailDoPrincipal);
    assert.equal(emails.length, 1);
    assert.ok(emails[0]!.text.includes("não bloqueia nada"), emails[0]!.text);
  });
});
