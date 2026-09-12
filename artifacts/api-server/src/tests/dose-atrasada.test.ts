/**
 * Quando a tela pode dizer "Atrasado" — Issue #153.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O DEFEITO: A TELA DEPENDIA DE UM JOB PARA SABER QUE JÁ PASSOU DA HORA.
 *
 * O status `late` do banco é decidido por `LATE_GRACE_MINUTES` (30) mais um
 * cron a cada 15 minutos. Somando, **uma dose atrasada podia parecer
 * "Pendente" por até 45 minutos** — foi o que o fundador fotografou às 09:58,
 * com uma dose das 09:00.
 *
 * Agora `today-doses` devolve `atrasadaApartirDe`: o instante em que a dose
 * passa a contar como atrasada. A tela compara com o relógio dela e acerta na
 * hora, sem esperar job nenhum.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── O que este arquivo guarda ─────────────────────────────────────────────
 *
 *   1. o instante vem, e é `scheduledAt` + a carência — não um número solto
 *   2. ele existe para TODA dose, inclusive as que ainda vão acontecer: é a
 *      tela que compara, e um `null` a obrigaria a adivinhar
 *   3. o status `late` do banco continua intocado — a #153 mexe na exibição,
 *      não na regra de negócio
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { like } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  usersTable, familiesTable, caregiversTable, patientsTable,
  medicationsTable, treatmentsTable, scheduledDosesTable,
} from "@workspace/db";
import { generateAccessToken } from "../lib/tokens.ts";
import { Clock } from "../lib/clock.ts";
import { LATE_GRACE_MINUTES } from "../lib/dose-generation.ts";
import { localDayBoundsUtc } from "@workspace/scheduling";
import app from "../app.ts";

const SUFIXO = "@atrasada.zelo.test";

let testPort: number;
let closeServer: () => Promise<void>;

/**
 * O relógio deste arquivo fica parado no meio do dia — Issue #189.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O CENÁRIO AGENDA UMA DOSE EM `agora - 1 h`, E ISSO ATRAVESSA A MEIA-NOITE.
 *
 * A dose nasce com `scheduledLocalDate` = hoje, mas `scheduledAt` uma hora
 * atrás. Rodando às 00:08, essa hora atrás é ONTEM — e `today-doses`, que
 * recorta por instante, não devolve a dose. Três casos reprovavam o código
 * que está certo.
 *
 * Medido em 12/09/2026 às 00:08, na árvore limpa do `main`. O CI roda em UTC,
 * então a janela de falha era 03:00–04:00 UTC, todo dia — um PR aberto ali
 * ficava vermelho sem motivo e o auto-merge não disparava.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── Por que congelar, e não deslocar as doses ────────────────────────────
 *
 * Dava para agendar "daqui a menos tempo" e caber no dia. Mas aí o teste
 * passaria a depender da hora em que roda de outro jeito: perto das 00:30 a
 * folga acabaria de novo, e alguém descobriria isso outra madrugada.
 *
 * Meio-dia em São Paulo tem doze horas de folga para cada lado. O que o
 * arquivo mede — a distância entre `scheduledAt` e a carência — não depende
 * da hora de parede, e agora o teste também não.
 */
const FUSO = "America/Sao_Paulo";

/**
 * O PRÓXIMO meio-dia em São Paulo — sempre à frente do relógio real.
 *
 * ── Por que à frente, e nunca atrás ─────────────────────────────────────
 *
 * `generateAccessToken` tira `iat` e `exp` do `Clock` (de propósito: é o que
 * faz `Clock.advance` funcionar nos testes de escalonamento), mas quem
 * confere o token é o `jwt.verify`, que usa o relógio REAL do sistema.
 *
 * Congelar o relógio no passado emite um token que já nasce vencido para
 * quem o confere — todo caso deste arquivo respondeu 401 quando tentei uma
 * data fixa de março. Para a frente não há esse problema: `exp` fica no
 * futuro, e o `verify` não reprova `iat` futuro (não há `maxAge` aqui).
 *
 * O salto é de no máximo 24 h, e nada neste arquivo depende de qual dia é.
 */
function proximoMeioDia(): Date {
  const agora = new Date();
  for (const daquiADias of [0, 1]) {
    const dia = new Intl.DateTimeFormat("en-CA", {
      timeZone: FUSO, year: "numeric", month: "2-digit", day: "2-digit",
    }).format(new Date(agora.getTime() + daquiADias * 86_400_000));
    // Meio-dia = começo do dia civil + 12 h. O Brasil não tem horário de
    // verão desde 2019; se voltasse, o pior caso seria congelar às 11:00 ou
    // 13:00 — e as doze horas de folga para cada lado continuam de pé.
    const meioDia = new Date(localDayBoundsUtc(dia, FUSO).start.getTime() + 12 * 3_600_000);
    if (meioDia.getTime() >= agora.getTime()) return meioDia;
  }
  throw new Error("não achei o próximo meio-dia");
}

before(async () => {
  Clock.freezeAt(proximoMeioDia());

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
  // Sem isto o relógio parado vaza para o próximo arquivo da suíte, que roda
  // no mesmo processo — e o defeito reapareceria em outro lugar, pior de achar.
  Clock.reset();
  await closeServer();
  await db.delete(usersTable).where(like(usersTable.email, `%${SUFIXO}`));
  await db.delete(familiesTable).where(like(familiesTable.name, "Família Fictícia Atrasada %"));
});

interface DoseDaTela {
  id: number;
  status: string;
  scheduledAt: string;
  atrasadaApartirDe: string | null;
}

async function telaDeHoje(patientId: number, token: string): Promise<DoseDaTela[]> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port: testPort,
        path: `/api/patients/${patientId}/today-doses`,
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
      },
      (res) => {
        let data = "";
        res.on("data", (c: Buffer) => (data += c.toString()));
        res.on("end", () => {
          assert.equal(res.statusCode, 200, data);
          resolve((JSON.parse(data) as { doses: DoseDaTela[] }).doses);
        });
      },
    );
    req.on("error", reject);
    req.end();
  });
}

/** Uma família com duas doses hoje: uma que já passou da hora e outra que não. */
async function cenario(rotulo: string) {
  const marca = `${Date.now()}${Math.floor(Math.random() * 10000)}`;
  const agora = Clock.now();

  const [family] = await db
    .insert(familiesTable)
    .values({ name: `Família Fictícia Atrasada ${rotulo} ${marca}`, slug: `atr-${rotulo}-${marca}` })
    .returning({ id: familiesTable.id });

  const email = `atr-${rotulo}-${marca}${SUFIXO}`;
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
      scheduleConfig: { scheduleType: "times_per_day", times: ["08:00", "20:00"] },
      startDate: Clock.todayInTimezone("America/Sao_Paulo"), status: "active",
    })
    .returning({ id: treatmentsTable.id });

  const agendar = async (deslocamentoMs: number, etiqueta: string) => {
    const [d] = await db
      .insert(scheduledDosesTable)
      .values({
        treatmentId: treatment.id, patientId: patient.id,
        scheduledAt: new Date(agora.getTime() + deslocamentoMs),
        scheduledLocalDate: Clock.todayInTimezone("America/Sao_Paulo"),
        scheduledLocalTime: etiqueta, status: "pending",
      })
      .returning({ id: scheduledDosesTable.id });
    return d.id;
  };

  return {
    patientId: patient.id,
    token: generateAccessToken(user.id, family.id, caregiver.id, "primary_caregiver"),
    // Uma hora atrás: passou da carência de 30 min com folga.
    passouDaHora: await agendar(-60 * 60_000, "08:00"),
    // Dez minutos à frente: nem chegou.
    aindaVem: await agendar(10 * 60_000, "20:00"),
  };
}

describe("Quando a tela pode dizer que a dose atrasou", () => {
  it("o instante e `scheduledAt` mais a carencia — e nao um numero solto", async () => {
    const c = await cenario("instante");
    const doses = await telaDeHoje(c.patientId, c.token);

    const dose = doses.find((d) => d.id === c.passouDaHora);
    assert.ok(dose, "a dose de uma hora atrás precisa estar no dia de hoje");
    assert.ok(dose.atrasadaApartirDe, "a tela precisa do instante para decidir sozinha");

    const esperado = new Date(dose.scheduledAt).getTime() + LATE_GRACE_MINUTES * 60_000;
    assert.equal(
      new Date(dose.atrasadaApartirDe).getTime(),
      esperado,
      "o instante tem que sair da MESMA carência que o job usa — dois donos para o " +
        "mesmo número é como a tela e o banco passam a discordar",
    );
  });

  it("a dose de uma hora atras JA passou do instante; a de daqui a pouco, nao", async () => {
    const c = await cenario("comparacao");
    const doses = await telaDeHoje(c.patientId, c.token);
    const agora = Clock.now().getTime();

    const velha = doses.find((d) => d.id === c.passouDaHora)!;
    const nova = doses.find((d) => d.id === c.aindaVem)!;

    assert.ok(
      new Date(velha.atrasadaApartirDe!).getTime() < agora,
      "uma dose de uma hora atrás tem que estar atrasada AGORA, sem esperar o cron",
    );
    assert.ok(
      new Date(nova.atrasadaApartirDe!).getTime() > agora,
      "uma dose que nem chegou não pode aparecer como atrasada",
    );
  });

  it("vem para TODA dose, inclusive as que ainda nao chegaram", async () => {
    const c = await cenario("todas");
    const doses = await telaDeHoje(c.patientId, c.token);

    // `null` obrigaria a tela a adivinhar: ela compara instantes, e um campo
    // ausente viraria "não sei" no meio de uma decisão que precisa ser binária.
    const semInstante = doses.filter((d) => !d.atrasadaApartirDe);
    assert.deepEqual(semInstante.map((d) => d.id), [], "toda dose precisa trazer o instante");
  });

  it("o status `late` do banco nao e tocado — a #153 mexe na EXIBICAO", async () => {
    const c = await cenario("status");
    const doses = await telaDeHoje(c.patientId, c.token);

    // As duas nasceram `pending` e nada nesta issue as marca. Quem marca
    // continua sendo o job, e é dele que dependem a cascata de lembretes, o
    // relatório de adesão e o histórico.
    const velha = doses.find((d) => d.id === c.passouDaHora)!;
    assert.equal(
      velha.status,
      "pending",
      "a tela decide o que MOSTRAR; marcar `late` continua sendo trabalho do job",
    );
  });
});
