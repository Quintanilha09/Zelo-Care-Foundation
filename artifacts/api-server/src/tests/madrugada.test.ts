/**
 * A dose de madrugada, vista na noite anterior — Issue #154.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O DEFEITO: ÀS 22:00, A DOSE DAS 03:00 NÃO EXISTIA EM LUGAR NENHUM.
 *
 * `today-doses` recorta pelo dia civil do paciente. A dose das 03:00 de
 * amanhã está no banco desde que o tratamento foi criado, mas ninguém a via
 * antes de o dia virar — e de manhã ela aparecia como "Perdida", descoberta
 * **depois** do fato.
 *
 * O fundador levantou isso em 11/09/2026: *"e se eu tiver que tomar um
 * remédio de madrugada? Essa pendência será listada? Pois se não for, é
 * capaz que eu esqueça."*
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── Não é sobre o aviso ───────────────────────────────────────────────────
 *
 * O lembrete de madrugada já dispara: o silêncio noturno só cala o broadcast
 * de nível 2, nunca o primeiro aviso (`lib/dose-reminders.ts`). O que faltava
 * era poder se **planejar** — ajustar o despertador, combinar quem acorda.
 * Por isso nada aqui testa notificação: esta issue é sobre a tela.
 *
 * ── O que este arquivo guarda ─────────────────────────────────────────────
 *
 *   1. à noite a dose de madrugada aparece; de dia, não
 *   2. o corte é 18:00 no relógio do PACIENTE — não no de quem olha
 *   3. só a madrugada, não o dia inteiro de amanhã (a de 07:00 fica de fora)
 *   4. ela nunca entra nas contagens de hoje, nem em `doses`
 */

import { describe, it, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { like } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  usersTable, familiesTable, caregiversTable, patientsTable,
  medicationsTable, treatmentsTable, scheduledDosesTable,
} from "@workspace/db";
import { localDayBoundsUtc } from "@workspace/scheduling";
import { generateAccessToken } from "../lib/tokens.ts";
import { Clock } from "../lib/clock.ts";
import app from "../app.ts";

const SUFIXO = "@madrugada.zelo.test";

/**
 * Um dia fixo, e não "hoje". O teste congela o relógio, então a data não
 * precisa ser real — precisa ser a MESMA em toda rodada, senão uma falha de
 * fuso apareceria só em certos dias do ano.
 *
 * São Paulo não tem horário de verão desde 2019, e Tóquio nunca teve: as
 * contas de offset abaixo valem o ano inteiro.
 */
const DIA = "2026-10-15";
const SAO_PAULO = "America/Sao_Paulo";
const TOQUIO = "Asia/Tokyo";
const HORA = 3_600_000;

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

afterEach(() => Clock.reset());

after(async () => {
  Clock.reset();
  await closeServer();
  await db.delete(usersTable).where(like(usersTable.email, `%${SUFIXO}`));
  await db.delete(familiesTable).where(like(familiesTable.name, "Família Fictícia Madrugada %"));
});

interface DoseDaTela {
  id: number;
  scheduledLocalTime: string;
}

interface TelaDeHoje {
  doses: DoseDaTela[];
  madrugada: DoseDaTela[];
  totalDoses: number;
  pendingDoses: number;
  lateDoses: number;
}

async function telaDeHoje(patientId: number, token: string): Promise<TelaDeHoje> {
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
          resolve(JSON.parse(data) as TelaDeHoje);
        });
      },
    );
    req.on("error", reject);
    req.end();
  });
}

/** O instante UTC de uma hora local, no fuso do paciente. */
function instanteLocal(dia: string, hora: number, fuso: string): Date {
  return new Date(localDayBoundsUtc(dia, fuso).start.getTime() + hora * HORA);
}

function proximoDia(dia: string): string {
  const d = new Date(`${dia}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Uma família com dois pacientes em fusos opostos, cada um com uma dose de
 * madrugada. Os dois existem para a mesma pergunta: **no mesmo instante**, um
 * está de noite e o outro de manhã.
 */
async function cenario(rotulo: string) {
  const marca = `${Date.now()}${Math.floor(Math.random() * 10000)}`;

  const [family] = await db
    .insert(familiesTable)
    .values({ name: `Família Fictícia Madrugada ${rotulo} ${marca}`, slug: `mad-${rotulo}-${marca}` })
    .returning({ id: familiesTable.id });

  const email = `mad-${rotulo}-${marca}${SUFIXO}`;
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

  const [medication] = await db
    .insert(medicationsTable)
    .values({ familyId: family.id, name: "Remédio Fictício (fictício)" })
    .returning({ id: medicationsTable.id });

  /** Um paciente num fuso, com o tratamento e as doses que ele precisa ter. */
  async function paciente(nome: string, fuso: string, diaDele: string) {
    const [p] = await db
      .insert(patientsTable)
      .values({ familyId: family.id, name: nome, timezone: fuso })
      .returning({ id: patientsTable.id });

    const [t] = await db
      .insert(treatmentsTable)
      .values({
        patientId: p.id, medicationId: medication.id, dose: "1 comprimido",
        scheduleType: "times_per_day",
        scheduleConfig: { scheduleType: "times_per_day", times: ["09:00", "03:00"] },
        startDate: diaDele, status: "active",
      })
      .returning({ id: treatmentsTable.id });

    const agendar = async (dia: string, hora: number, etiqueta: string) => {
      const [d] = await db
        .insert(scheduledDosesTable)
        .values({
          treatmentId: t.id, patientId: p.id,
          scheduledAt: instanteLocal(dia, hora, fuso),
          scheduledLocalDate: dia, scheduledLocalTime: etiqueta, status: "pending",
        })
        .returning({ id: scheduledDosesTable.id });
      return d.id;
    };

    const amanha = proximoDia(diaDele);
    return {
      id: p.id,
      hoje09: await agendar(diaDele, 9, "09:00"),
      madrugada03: await agendar(amanha, 3, "03:00"),
      // Fora da madrugada: é amanhã de manhã, e amanhã de manhã dá tempo de
      // ver amanhã de manhã. Guarda a regra de NÃO mostrar o dia inteiro.
      amanha07: await agendar(amanha, 7, "07:00"),
    };
  }

  return {
    token: generateAccessToken(user.id, family.id, caregiver.id, "primary_caregiver"),
    // Em São Paulo o dia do teste é o DIA; em Tóquio, que está nove horas à
    // frente, o mesmo instante das 22:00 já caiu no dia seguinte.
    saoPaulo: await paciente("Dona Maria Teste", SAO_PAULO, DIA),
    toquio: await paciente("Dona Rosa Teste", TOQUIO, proximoDia(DIA)),
  };
}

/** 22:00 em São Paulo no dia do teste — e 10:00 da manhã em Tóquio. */
const NOITE_EM_SAO_PAULO = instanteLocal(DIA, 22, SAO_PAULO);

describe("A madrugada seguinte na tela inicial", () => {
  it("a noite, a dose das 03:00 de amanha aparece", async () => {
    const c = await cenario("noite");
    Clock.freezeAt(NOITE_EM_SAO_PAULO);

    const tela = await telaDeHoje(c.saoPaulo.id, c.token);
    assert.deepEqual(
      tela.madrugada.map((d) => d.id),
      [c.saoPaulo.madrugada03],
      "às 22:00, quem vai dormir precisa saber que há remédio às 03:00",
    );
  });

  it("de dia, a mesma dose nao aparece — a tela do dia continua sendo do dia", async () => {
    const c = await cenario("dia");
    Clock.freezeAt(instanteLocal(DIA, 10, SAO_PAULO));

    const tela = await telaDeHoje(c.saoPaulo.id, c.token);
    assert.deepEqual(tela.madrugada, [], "às 10:00 não há o que se organizar para a noite");
  });

  it("o corte e as 18:00 em ponto, e nao um minuto antes", async () => {
    const c = await cenario("corte");

    // 17:59 — a seção ainda não existe.
    Clock.freezeAt(new Date(instanteLocal(DIA, 18, SAO_PAULO).getTime() - 60_000));
    assert.deepEqual((await telaDeHoje(c.saoPaulo.id, c.token)).madrugada, []);

    // 18:00 — existe. Um teste só com 22:00 e 10:00 passaria com o corte em
    // qualquer hora entre as duas, e a constante deixaria de ter dono.
    Clock.reset();
    Clock.freezeAt(instanteLocal(DIA, 18, SAO_PAULO));
    assert.deepEqual(
      (await telaDeHoje(c.saoPaulo.id, c.token)).madrugada.map((d) => d.id),
      [c.saoPaulo.madrugada03],
    );
  });

  it("so a madrugada — a dose das 07:00 de amanha fica de fora", async () => {
    const c = await cenario("recorte");
    Clock.freezeAt(NOITE_EM_SAO_PAULO);

    const tela = await telaDeHoje(c.saoPaulo.id, c.token);
    // A tela inicial responde "está tudo em dia hoje?". A madrugada entra
    // porque é a única parte do amanhã que não dá para ver amanhã de manhã a
    // tempo; o resto do dia seguinte transformaria a tela num calendário.
    assert.ok(
      !tela.madrugada.some((d) => d.id === c.saoPaulo.amanha07),
      "07:00 de amanhã dá para ver amanhã de manhã — não é madrugada",
    );
  });

  it("o corte e 18:00 no relogio do PACIENTE, nao no de quem olha", async () => {
    const c = await cenario("fuso");
    // O mesmo instante: 22:00 em São Paulo, 10:00 da manhã em Tóquio.
    Clock.freezeAt(NOITE_EM_SAO_PAULO);

    const emSaoPaulo = await telaDeHoje(c.saoPaulo.id, c.token);
    const emToquio = await telaDeHoje(c.toquio.id, c.token);

    // ZELO-19. Se a decisão fosse do navegador — ou do fuso do processo —, as
    // duas telas diriam a mesma coisa, e uma delas estaria errada.
    assert.equal(emSaoPaulo.madrugada.length, 1, "em São Paulo é noite");
    assert.deepEqual(emToquio.madrugada, [], "em Tóquio ainda é de manhã");
  });

  it("a dose de amanha nunca entra nas contagens de hoje", async () => {
    const c = await cenario("contagem");
    Clock.freezeAt(NOITE_EM_SAO_PAULO);

    const tela = await telaDeHoje(c.saoPaulo.id, c.token);

    // Só a dose das 09:00 é de hoje. Se a madrugada entrasse na conta, a
    // faixa "Tudo em dia hoje" sumiria numa noite em que o dia ESTÁ em dia —
    // e o app passaria a cobrar por algo que ainda nem chegou.
    assert.deepEqual(tela.doses.map((d) => d.id), [c.saoPaulo.hoje09], "`doses` é de hoje");
    assert.equal(tela.totalDoses, 1);
    assert.equal(tela.pendingDoses, 1);
    assert.equal(tela.lateDoses, 0);
  });
});
