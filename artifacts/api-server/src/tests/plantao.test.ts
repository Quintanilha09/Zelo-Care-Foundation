/**
 * A escala de plantão — Issue #177.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * OS CINCO CRITÉRIOS DE ACEITE, E O QUE MAIS IMPORTA É O ÚLTIMO.
 *
 *   1. dá para dizer quem está de plantão, com recorrência e troca pontual
 *   2. a tela inicial mostra de quem é a vez hoje
 *   3. o primeiro lembrete vai para quem está de plantão
 *   4. sem escala definida, tudo funciona exatamente como hoje
 *   5. NINGUÉM perde acesso nem capacidade por não estar de plantão
 *
 * O quinto é o que impede o desastre: se a escala filtrasse acesso, uma
 * família inteira perderia o app numa noite em que ninguém marcou plantão —
 * e é justamente a noite em que mais precisa.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { eq, and } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  usersTable, caregiversTable, familiesTable, patientsTable, shiftsTable,
  medicationsTable, treatmentsTable, scheduledDosesTable, notificationsTable,
} from "@workspace/db";
import { generateAccessToken } from "../lib/tokens.ts";
import { hashPassword } from "../lib/password.ts";
import { Clock } from "../lib/clock.ts";
import { boss } from "../lib/queue.ts";
import { quemEstaDePlantao } from "../lib/plantao.ts";
import { sendDoseReminder, ESCALATION_LEVEL_FIRST, ESCALATION_LEVEL_BROADCAST } from "../lib/dose-reminders.ts";
import app from "../app.ts";

const FUSO = "America/Sao_Paulo";

let testPort: number;
let closeServer: () => Promise<void>;
let familyId: number;
let patientId: number;
/** A dona da conta, cuidadora principal. */
let token: string;
let anaId: number;
/** Uma segunda cuidadora, que reveza com a primeira. */
let brunoId: number;
let tokenDoBruno: string;

async function api(method: string, path: string, body?: unknown, comToken = token) {
  const payload = body !== undefined ? JSON.stringify(body) : undefined;
  return new Promise<{ status: number; body: unknown }>((resolve, reject) => {
    const req = http.request(
      {
        hostname: "127.0.0.1", port: testPort, path: `/api${path}`, method,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${comToken}`,
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

/** Limpa a escala entre os casos: o arquivo inteiro usa um paciente só. */
async function limparEscala() {
  await db.delete(shiftsTable).where(eq(shiftsTable.patientId, patientId));
}

/** Um instante "YYYY-MM-DDTHH:mm" no fuso do paciente, como Date. */
function em(dia: string, hora: string): Date {
  // -03:00 é o offset de São Paulo o ano inteiro desde 2019 (sem horário de
  // verão). Escrever o offset à mão mantém o teste independente do fuso da
  // máquina que roda a suíte.
  return new Date(`${dia}T${hora}:00-03:00`);
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
    .values({
      name: "Família Fictícia Plantão",
      slug: `plantao-${Date.now()}`,
      /**
       * O silêncio noturno fica DESLIGADO aqui, e é de propósito.
       *
       * O T+30 (transmissão para a família inteira) é calado durante a
       * janela de silêncio no perfil `standard` — o comportamento está
       * certo e tem teste próprio em `dose-reminders.test.ts`. Mas ele
       * fazia este arquivo passar de tarde e reprovar de madrugada:
       * medido à 01:00 de 12/09/2026, a transmissão não saiu e o caso
       * do escalonamento reprovou sem ter nada a ver com plantão.
       *
       * Aqui a pergunta é OUTRA — para quem vai o aviso, e não a que
       * horas ele pode sair. Deixar as duas juntas faz um teste medir
       * duas coisas e não explicar nenhuma.
       */
      quietHoursEnabled: false,
    })
    .returning();
  familyId = family.id;

  const [ana] = await db
    .insert(usersTable)
    .values({
      email: `ana-plantao-${Date.now()}@zelo.test`, name: "Ana Fictícia",
      passwordHash: await hashPassword("x"), emailVerified: true, status: "active",
    })
    .returning();
  const [cuidadoraAna] = await db
    .insert(caregiversTable)
    .values({ familyId, userId: ana.id, name: "Ana Fictícia", role: "primary_caregiver" })
    .returning();
  anaId = cuidadoraAna.id;
  token = generateAccessToken(ana.id, familyId, cuidadoraAna.id, "primary_caregiver");

  const [bruno] = await db
    .insert(usersTable)
    .values({
      email: `bruno-plantao-${Date.now()}@zelo.test`, name: "Bruno Fictício",
      passwordHash: await hashPassword("x"), emailVerified: true, status: "active",
    })
    .returning();
  const [cuidadorBruno] = await db
    .insert(caregiversTable)
    .values({ familyId, userId: bruno.id, name: "Bruno Fictício", role: "caregiver" })
    .returning();
  brunoId = cuidadorBruno.id;
  tokenDoBruno = generateAccessToken(bruno.id, familyId, cuidadorBruno.id, "caregiver");

  const [patient] = await db
    .insert(patientsTable)
    .values({ familyId, name: "Dona Maria Teste", timezone: FUSO })
    .returning();
  patientId = patient.id;
});

after(async () => {
  Clock.reset();
  await closeServer();
  await boss.stop({ graceful: false });
  await db.delete(familiesTable).where(eq(familiesTable.id, familyId));
});

describe("Montar a escala", () => {
  it("aceita recorrencia semanal e troca pontual", async () => {
    await limparEscala();

    const semanal = await api("POST", `/patients/${patientId}/plantao`, {
      caregiverId: anaId, weekday: 2, startTime: "00:00", endTime: "23:59",
    });
    assert.equal(semanal.status, 201, JSON.stringify(semanal.body));

    const pontual = await api("POST", `/patients/${patientId}/plantao`, {
      caregiverId: brunoId, onDate: "2026-10-03",
    });
    assert.equal(pontual.status, 201, JSON.stringify(pontual.body));

    const lista = await api("GET", `/patients/${patientId}/plantao`);
    assert.equal(lista.status, 200);
    const corpo = lista.body as { turnos: Array<{ weekday: number | null; onDate: string | null }> };
    assert.equal(corpo.turnos.length, 2);

    await limparEscala();
  });

  it("recusa um turno que nao diz dia nenhum, e um que diz os dois", async () => {
    const semDia = await api("POST", `/patients/${patientId}/plantao`, { caregiverId: anaId });
    assert.equal(semDia.status, 400, "um turno sem dia não descreve nada");

    const comOsDois = await api("POST", `/patients/${patientId}/plantao`, {
      caregiverId: anaId, weekday: 2, onDate: "2026-10-03",
    });
    assert.equal(comOsDois.status, 400, "toda terça E também dia 3 é uma regra que não existe");
  });

  it("recusa cuidador de outra familia", async () => {
    const [outra] = await db
      .insert(familiesTable)
      .values({ name: "Família Fictícia Vizinha Plantão", slug: `plantao-viz-${Date.now()}` })
      .returning();
    const [deFora] = await db
      .insert(caregiversTable)
      .values({ familyId: outra.id, name: "Pessoa de Outra Casa", role: "caregiver" })
      .returning();

    const res = await api("POST", `/patients/${patientId}/plantao`, {
      caregiverId: deFora.id, weekday: 1,
    });
    // Sem esta checagem daria para pendurar o plantão do paciente numa
    // pessoa de outra casa.
    assert.equal(res.status, 404);

    await db.delete(familiesTable).where(eq(familiesTable.id, outra.id));
  });

  it("paciente de outra familia responde 404, e nao 403", async () => {
    const [outra] = await db
      .insert(familiesTable)
      .values({ name: "Família Fictícia Vizinha 2", slug: `plantao-viz2-${Date.now()}` })
      .returning();
    const [outroPaciente] = await db
      .insert(patientsTable)
      .values({ familyId: outra.id, name: "Seu João Teste", timezone: FUSO })
      .returning();

    const res = await api("GET", `/patients/${outroPaciente.id}/plantao`);
    // 403 confirmaria que o paciente existe. 404 não conta nada.
    assert.equal(res.status, 404);

    await db.delete(familiesTable).where(eq(familiesTable.id, outra.id));
  });
});

describe("De quem e a vez", () => {
  it("sem escala, ninguem esta de plantao — e isso nao e erro", async () => {
    await limparEscala();
    const quem = await quemEstaDePlantao(patientId, FUSO, em("2026-10-06", "10:00"));
    // `null` é a esmagadora maioria das famílias. Quem chama trata isso como
    // "continua como sempre foi".
    assert.equal(quem, null);
  });

  it("a recorrencia semanal vale no dia dela, e so nele", async () => {
    await limparEscala();
    await db.insert(shiftsTable).values({
      patientId, caregiverId: anaId, weekday: 2, startTime: "00:00", endTime: "23:59",
    });

    // 2026-10-06 é uma terça-feira.
    const naTerca = await quemEstaDePlantao(patientId, FUSO, em("2026-10-06", "10:00"));
    assert.equal(naTerca?.caregiverId, anaId);

    const naQuarta = await quemEstaDePlantao(patientId, FUSO, em("2026-10-07", "10:00"));
    assert.equal(naQuarta, null);

    await limparEscala();
  });

  it("a troca pontual VENCE a recorrencia naquele dia", async () => {
    await limparEscala();
    await db.insert(shiftsTable).values([
      { patientId, caregiverId: anaId, weekday: 2, startTime: "00:00", endTime: "23:59" },
      { patientId, caregiverId: brunoId, onDate: "2026-10-06", startTime: "00:00", endTime: "23:59" },
    ]);

    const quem = await quemEstaDePlantao(patientId, FUSO, em("2026-10-06", "10:00"));
    // Quem escreveu "este sábado eu troco com você" estava dizendo que o
    // sábado de sempre não vale desta vez. A troca é o último combinado.
    assert.equal(quem?.caregiverId, brunoId);
    assert.equal(quem?.troca, true);

    // E na terça seguinte a recorrência volta a valer sozinha.
    const naProxima = await quemEstaDePlantao(patientId, FUSO, em("2026-10-13", "10:00"));
    assert.equal(naProxima?.caregiverId, anaId);

    await limparEscala();
  });

  it("o turno da noite atravessa a meia-noite", async () => {
    await limparEscala();
    // Terça, das 22:00 às 06:00.
    await db.insert(shiftsTable).values({
      patientId, caregiverId: brunoId, weekday: 2, startTime: "22:00", endTime: "06:00",
    });

    // 23:00 de terça: dentro do turno que começou hoje.
    const naNoite = await quemEstaDePlantao(patientId, FUSO, em("2026-10-06", "23:00"));
    assert.equal(naNoite?.caregiverId, brunoId);

    /**
     * 02:00 de QUARTA — e este é o caso que separa um plantão de verdade de
     * uma lista de dias.
     *
     * Quem está de plantão às 02:00 é quem pegou o turno às 22:00 de ONTEM.
     * Sem isso, a madrugada — que é exatamente quando a dose se perde —
     * ficaria sem ninguém de plantão.
     */
    const naMadrugada = await quemEstaDePlantao(patientId, FUSO, em("2026-10-07", "02:00"));
    assert.equal(naMadrugada?.caregiverId, brunoId);

    // 10:00 de quarta: o turno já acabou às 06:00.
    const deManha = await quemEstaDePlantao(patientId, FUSO, em("2026-10-07", "10:00"));
    assert.equal(deManha, null);

    await limparEscala();
  });

  it("fora do horario do turno, ninguem esta de plantao", async () => {
    await limparEscala();
    await db.insert(shiftsTable).values({
      patientId, caregiverId: anaId, weekday: 2, startTime: "08:00", endTime: "18:00",
    });

    assert.equal((await quemEstaDePlantao(patientId, FUSO, em("2026-10-06", "12:00")))?.caregiverId, anaId);
    assert.equal(await quemEstaDePlantao(patientId, FUSO, em("2026-10-06", "20:00")), null);

    await limparEscala();
  });

  it("a tela inicial diz de quem e a vez, e se e voce", async () => {
    await limparEscala();
    const agora = Clock.now();
    const hoje = Clock.todayInTimezone(FUSO);
    await db.insert(shiftsTable).values({
      patientId, caregiverId: anaId, onDate: hoje, startTime: "00:00", endTime: "23:59",
    });

    const daAna = await api("GET", "/dashboard/today-summary");
    assert.equal(daAna.status, 200);
    const vistoPelaAna = (daAna.body as {
      plantaoDeHoje: Array<{ caregiverId: number; caregiverName: string; souEu: boolean }>;
    }).plantaoDeHoje;
    const linha = vistoPelaAna.find((l) => l.caregiverId === anaId);
    assert.ok(linha, "a linha do plantão de hoje precisa aparecer");
    assert.equal(linha.souEu, true, "para a Ana, hoje é a vez DELA");

    const doBruno = await api("GET", "/dashboard/today-summary", undefined, tokenDoBruno);
    const vistoPeloBruno = (doBruno.body as {
      plantaoDeHoje: Array<{ caregiverId: number; souEu: boolean }>;
    }).plantaoDeHoje;
    const mesmaLinha = vistoPeloBruno.find((l) => l.caregiverId === anaId);
    assert.ok(mesmaLinha);
    // Quem lê é quem decide a frase, e quem faz essa conta é o servidor: só
    // ele sabe qual caregiverId é o do JWT.
    assert.equal(mesmaLinha.souEu, false);

    assert.ok(agora.getTime() > 0);
    await limparEscala();
  });
});

describe("A escala NAO filtra nada", () => {
  it("quem nao esta de plantao continua vendo o dia inteiro", async () => {
    await limparEscala();
    const hoje = Clock.todayInTimezone(FUSO);
    // Hoje é a vez da Ana. O Bruno está fora da escala.
    await db.insert(shiftsTable).values({
      patientId, caregiverId: anaId, onDate: hoje, startTime: "00:00", endTime: "23:59",
    });

    const daAna = await api("GET", "/dashboard/today-summary");
    const doBruno = await api("GET", "/dashboard/today-summary", undefined, tokenDoBruno);

    const pacientesDaAna = (daAna.body as { patients: Array<{ patientId: number }> }).patients;
    const pacientesDoBruno = (doBruno.body as { patients: Array<{ patientId: number }> }).patients;

    /**
     * ═══════════════════════════════════════════════════════════════════════
     * A LINHA QUE NÃO SE CRUZA.
     *
     * O Bruno não está de plantão hoje, e vê exatamente a mesma coisa que a
     * Ana. Se um dia esta asserção quebrar porque alguém "melhorou" a tela
     * para mostrar só quem está de plantão, uma família inteira perde o app
     * numa noite em que ninguém marcou escala.
     * ═══════════════════════════════════════════════════════════════════════
     */
    assert.deepEqual(
      pacientesDoBruno.map((p) => p.patientId).sort(),
      pacientesDaAna.map((p) => p.patientId).sort(),
      "não estar de plantão não pode esconder paciente nenhum",
    );

    await limparEscala();
  });

  it("quem nao esta de plantao continua podendo mexer na escala e na ficha", async () => {
    await limparEscala();
    const hoje = Clock.todayInTimezone(FUSO);
    await db.insert(shiftsTable).values({
      patientId, caregiverId: anaId, onDate: hoje, startTime: "00:00", endTime: "23:59",
    });

    // O Bruno, fora da escala de hoje, lê a ficha e a escala normalmente...
    const ficha = await api("GET", `/patients/${patientId}`, undefined, tokenDoBruno);
    assert.equal(ficha.status, 200);
    const escala = await api("GET", `/patients/${patientId}/plantao`, undefined, tokenDoBruno);
    assert.equal(escala.status, 200);

    // ...e ainda marca um turno. A escala é combinação da família, não
    // privilégio de quem está nela.
    const novo = await api("POST", `/patients/${patientId}/plantao`, {
      caregiverId: brunoId, weekday: 5,
    }, tokenDoBruno);
    assert.equal(novo.status, 201, JSON.stringify(novo.body));

    await limparEscala();
  });
});

describe("O primeiro lembrete e a escala", () => {
  it("a fonte do plantao NUNCA e consultada para decidir acesso", async () => {
    /**
     * Uma varredura de código, e não um caso de comportamento.
     *
     * O risco desta funcionalidade não é ela não funcionar — é ela funcionar
     * DEMAIS: alguém, um dia, achar natural usar a escala para filtrar a
     * lista de pacientes, esconder uma dose ou tirar um botão. Este teste
     * falha nesse dia, e diz por quê.
     *
     * A lista abaixo é dos arquivos onde a escala PODE ser consultada. Em
     * qualquer outro, `quemEstaDePlantao` é sinal de que a linha foi cruzada.
     */
    const { readFile, readdir } = await import("node:fs/promises");
    const { fileURLToPath } = await import("node:url");
    const raiz = fileURLToPath(new URL("../", import.meta.url));

    const PODEM = new Set([
      "lib/plantao.ts",        // o dono da pergunta
      "routes/plantao.ts",     // guarda e devolve a escala
      "routes/dashboard.ts",   // a linha "de quem é a vez" na tela inicial
      "lib/dose-reminders.ts", // para quem vai o PRIMEIRO lembrete
    ]);

    const achados: string[] = [];
    for (const pasta of ["lib", "routes", "middleware"]) {
      let arquivos: string[];
      try { arquivos = await readdir(raiz + pasta); } catch { continue; }
      for (const nome of arquivos) {
        if (!nome.endsWith(".ts")) continue;
        const caminho = `${pasta}/${nome}`;
        if (PODEM.has(caminho)) continue;
        const fonte = await readFile(raiz + caminho, "utf8");
        if (fonte.includes("quemEstaDePlantao")) achados.push(caminho);
      }
    }

    assert.deepEqual(
      achados,
      [],
      "a escala responde 'de quem é a vez?', nunca 'quem pode?'. Estes arquivos " +
        "passaram a consultá-la: " + achados.join(", ") + ". Se é para decidir " +
        "acesso, capacidade, filtro de lista ou visibilidade de tela, a resposta " +
        "é não — ninguém perde nada por não estar de plantão (Issue #177, e a " +
        "mesma regra da #120).",
    );
  });
});
/**
 * ═══════════════════════════════════════════════════════════════════════════
 * O PRIMEIRO LEMBRETE VAI PARA QUEM ESTÁ DE PLANTÃO.
 *
 * É o critério de aceite que dá utilidade a todo o resto: a escala existe
 * para que o aviso das 22:00 chegue em quem combinou de estar lá às 22:00.
 *
 * E o escalonamento NÃO muda: o T+30 continua chamando a família inteira,
 * porque a essa altura a pergunta deixou de ser "de quem é a vez" e passou a
 * ser "alguém consegue verificar?".
 * ═══════════════════════════════════════════════════════════════════════════
 */
describe("Para quem vai o lembrete", () => {
  let medicationId: number;

  /** Uma dose pendente agora, pronta para o disparo do lembrete. */
  async function doseDeAgora() {
    if (!medicationId) {
      const [med] = await db
        .insert(medicationsTable)
        .values({ familyId, name: "Remédio Fictício Plantão (fictício)" })
        .returning();
      medicationId = med.id;
    }
    const [tratamento] = await db
      .insert(treatmentsTable)
      .values({
        patientId, medicationId, dose: "1 comprimido",
        scheduleType: "times_per_day",
        scheduleConfig: { scheduleType: "times_per_day", times: ["08:00"] },
        startDate: Clock.todayInTimezone(FUSO), status: "active",
      })
      .returning();
    const agora = Clock.now();
    const { localDate, localTime } = {
      localDate: Clock.todayInTimezone(FUSO),
      localTime: "08:00",
    };
    const [dose] = await db
      .insert(scheduledDosesTable)
      .values({
        treatmentId: tratamento.id, patientId,
        scheduledAt: agora,
        scheduledLocalDate: localDate, scheduledLocalTime: localTime,
        status: "pending", dose: "1 comprimido",
      })
      .returning();
    return { doseId: dose.id, treatmentId: tratamento.id };
  }

  async function quemFoiAvisado(doseId: number, nivel: number): Promise<number[]> {
    const linhas = await db
      .select({ caregiverId: notificationsTable.caregiverId })
      .from(notificationsTable)
      .where(and(
        eq(notificationsTable.scheduledDoseId, doseId),
        eq(notificationsTable.escalationLevel, nivel),
      ));
    return linhas.map((l) => l.caregiverId).filter((c): c is number => c !== null).sort();
  }

  it("com escala, o primeiro aviso vai para quem esta de plantao", async () => {
    await limparEscala();
    // O Bruno NÃO é cuidador principal. Sem escala, o primeiro aviso iria
    // para a Ana — é exatamente essa a diferença que a escala faz.
    await db.insert(shiftsTable).values({
      patientId, caregiverId: brunoId,
      onDate: Clock.todayInTimezone(FUSO), startTime: "00:00", endTime: "23:59",
    });

    const { doseId, treatmentId } = await doseDeAgora();
    await sendDoseReminder(doseId, ESCALATION_LEVEL_FIRST);

    assert.deepEqual(
      await quemFoiAvisado(doseId, ESCALATION_LEVEL_FIRST),
      [brunoId],
      "o aviso das 22:00 tem que chegar em quem combinou de estar lá às 22:00",
    );

    await db.delete(treatmentsTable).where(eq(treatmentsTable.id, treatmentId));
    await limparEscala();
  });

  it("sem escala, tudo continua exatamente como era", async () => {
    await limparEscala();
    const { doseId, treatmentId } = await doseDeAgora();
    await sendDoseReminder(doseId, ESCALATION_LEVEL_FIRST);

    // A esmagadora maioria das famílias não tem escala, e para elas nada
    // pode ter mudado: o primeiro aviso continua indo ao cuidador principal.
    assert.deepEqual(await quemFoiAvisado(doseId, ESCALATION_LEVEL_FIRST), [anaId]);

    await db.delete(treatmentsTable).where(eq(treatmentsTable.id, treatmentId));
  });

  it("o escalonamento para a familia inteira nao muda", async () => {
    await limparEscala();
    await db.insert(shiftsTable).values({
      patientId, caregiverId: brunoId,
      onDate: Clock.todayInTimezone(FUSO), startTime: "00:00", endTime: "23:59",
    });

    const { doseId, treatmentId } = await doseDeAgora();
    await sendDoseReminder(doseId, ESCALATION_LEVEL_BROADCAST);

    /**
     * No T+30 a pergunta deixou de ser "de quem é a vez" e virou "alguém
     * consegue verificar?". Filtrar por plantão aqui seria deixar a dose
     * perdida com uma pessoa que talvez esteja dormindo.
     */
    assert.deepEqual(
      await quemFoiAvisado(doseId, ESCALATION_LEVEL_BROADCAST),
      [anaId, brunoId].sort(),
      "o T+30 chama todo mundo que pode registrar, de plantão ou não",
    );

    await db.delete(treatmentsTable).where(eq(treatmentsTable.id, treatmentId));
    await limparEscala();
  });
});
