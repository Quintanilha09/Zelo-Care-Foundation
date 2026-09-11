/**
 * O dia de TODOS os pacientes, numa resposta só — Issue #178.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * A TELA INICIAL MOSTRAVA UM PACIENTE, E O CUIDADOR TINHA QUATRO.
 *
 * `today-summary` já buscava as doses de todos os pacientes da família — e
 * jogava fora, devolvendo contagem. A tela inicial, que precisava delas,
 * pedia `today-doses` para UM paciente, escolhido e **gravado** pelo app.
 *
 * Com quatro pacientes, qualquer escolha automática está errada três vezes
 * em quatro. O fundador: *"a tela inicial mostra que estou cuidando somente
 * de um paciente mas ao clicar na lista mostram os outros"*.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── O que este arquivo guarda ─────────────────────────────────────────────
 *
 *   1. as doses vêm de todos os pacientes, cada uma sabendo de quem é
 *   2. a madrugada de amanhã fica em lista à parte, nunca misturada
 *   3. as contagens continuam sendo do DIA — a madrugada não as infla
 *   4. paciente de outra família não aparece (invariante 2)
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

const SUFIXO = "@dia-de-todos.zelo.test";
const TZ = "America/Sao_Paulo";
/** Dia fixo: o relógio é congelado, então ele não precisa ser real — precisa ser o mesmo sempre. */
const DIA = "2026-10-15";
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
  await db.delete(familiesTable).where(like(familiesTable.name, "Família Fictícia Dia %"));
});

interface DoseDaTela {
  id: number;
  patientId: number;
  patientName: string;
  scheduledLocalTime: string;
  medicationName: string;
}

interface Resposta {
  patients: Array<{ patientId: number; patientName: string; totalDoses: number; dueNowDoses: number }>;
  doses: DoseDaTela[];
  madrugada: DoseDaTela[];
}

async function oDia(token: string): Promise<Resposta> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port: testPort,
        path: "/api/dashboard/today-summary",
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
      },
      (res) => {
        let data = "";
        res.on("data", (c: Buffer) => (data += c.toString()));
        res.on("end", () => {
          assert.equal(res.statusCode, 200, data);
          resolve(JSON.parse(data) as Resposta);
        });
      },
    );
    req.on("error", reject);
    req.end();
  });
}

function instanteLocal(dia: string, hora: number): Date {
  return new Date(localDayBoundsUtc(dia, TZ).start.getTime() + hora * HORA);
}

function proximoDia(dia: string): string {
  const d = new Date(`${dia}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** Uma família com dois pacientes, cada um com doses próprias. */
async function cenario(rotulo: string) {
  const marca = `${Date.now()}${Math.floor(Math.random() * 10000)}`;

  const [family] = await db
    .insert(familiesTable)
    .values({ name: `Família Fictícia Dia ${rotulo} ${marca}`, slug: `dia-${rotulo}-${marca}` })
    .returning({ id: familiesTable.id });

  const email = `dia-${rotulo}-${marca}${SUFIXO}`;
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

  async function paciente(nome: string, horas: Array<{ dia: string; hora: number; etiqueta: string }>) {
    const [p] = await db
      .insert(patientsTable)
      .values({ familyId: family.id, name: nome, timezone: TZ })
      .returning({ id: patientsTable.id });

    const [t] = await db
      .insert(treatmentsTable)
      .values({
        patientId: p.id, medicationId: medication.id, dose: "1 comprimido",
        scheduleType: "times_per_day",
        scheduleConfig: { scheduleType: "times_per_day", times: ["09:00"] },
        startDate: DIA, status: "active",
      })
      .returning({ id: treatmentsTable.id });

    const ids: number[] = [];
    for (const h of horas) {
      const [d] = await db
        .insert(scheduledDosesTable)
        .values({
          treatmentId: t.id, patientId: p.id,
          scheduledAt: instanteLocal(h.dia, h.hora),
          scheduledLocalDate: h.dia, scheduledLocalTime: h.etiqueta,
          status: "pending", dose: "1 comprimido",
        })
        .returning({ id: scheduledDosesTable.id });
      ids.push(d.id);
    }
    return { id: p.id, nome, doses: ids };
  }

  const amanha = proximoDia(DIA);
  return {
    token: generateAccessToken(user.id, family.id, caregiver.id, "primary_caregiver"),
    jack: await paciente("Jack Chan Teste", [{ dia: DIA, hora: 9, etiqueta: "09:00" }]),
    // O segundo tem uma dose hoje e uma de madrugada — é ele que prova as
    // duas listas ao mesmo tempo.
    jose: await paciente("Jose Souza Teste", [
      { dia: DIA, hora: 12, etiqueta: "12:00" },
      { dia: amanha, hora: 3, etiqueta: "03:00" },
    ]),
  };
}

describe("O dia de todos os pacientes", () => {
  it("as doses vem de TODOS, e cada uma sabe de quem e", async () => {
    const c = await cenario("todos");
    Clock.freezeAt(instanteLocal(DIA, 14));

    const dia = await oDia(c.token);

    // O defeito inteiro em uma asserção: antes, a tela via um paciente.
    assert.deepEqual(
      dia.doses.map((d) => d.id).sort((a, b) => a - b),
      [c.jack.doses[0], c.jose.doses[0]].sort((a, b) => a - b),
      "as duas doses de hoje precisam vir, de pacientes diferentes",
    );

    // E o nome vem junto: sem ele a tela teria de cruzar com outra lista
    // para saber de quem é cada cartão.
    const doJack = dia.doses.find((d) => d.id === c.jack.doses[0])!;
    assert.equal(doJack.patientName, "Jack Chan Teste");
    assert.equal(doJack.patientId, c.jack.id);
  });

  it("de dia, a madrugada de amanha nem e buscada", async () => {
    const c = await cenario("dedia");
    Clock.freezeAt(instanteLocal(DIA, 14));

    const dia = await oDia(c.token);
    assert.deepEqual(dia.madrugada, [], "às 14:00 não há o que se organizar para a noite");
  });

  it("a noite, a madrugada vem em lista A PARTE", async () => {
    const c = await cenario("anoite");
    Clock.freezeAt(instanteLocal(DIA, 22));

    const dia = await oDia(c.token);

    assert.deepEqual(
      dia.madrugada.map((d) => d.id),
      [c.jose.doses[1]],
      "às 22:00, quem vai dormir precisa saber que há remédio às 03:00",
    );
    // Nunca misturada: a tela responde "está tudo em dia hoje?", e uma dose
    // de amanhã no meio das de hoje mudaria a pergunta.
    assert.ok(
      !dia.doses.some((d) => d.id === c.jose.doses[1]),
      "a dose de amanhã não pode aparecer entre as de hoje",
    );
  });

  it("a madrugada nao infla as contagens do dia", async () => {
    const c = await cenario("contagem");
    Clock.freezeAt(instanteLocal(DIA, 22));

    const dia = await oDia(c.token);
    const jose = dia.patients.find((p) => p.patientId === c.jose.id)!;

    // Só a dose das 12:00 é de hoje. Se a madrugada entrasse na conta, a
    // faixa "Tudo em dia hoje" sumiria numa noite em que o dia ESTÁ em dia.
    assert.equal(jose.totalDoses, 1, "a dose das 03:00 de amanhã não é de hoje");
  });

  it("paciente de outra familia nao aparece", async () => {
    const a = await cenario("familiaA");
    const b = await cenario("familiaB");
    Clock.freezeAt(instanteLocal(DIA, 14));

    const dia = await oDia(a.token);
    const idsDeB = new Set([b.jack.id, b.jose.id]);

    // Invariante 2. A rota filtra por `familyId` do JWT, e este caso existe
    // para o dia em que alguém trocar o filtro por um id vindo da URL.
    assert.ok(
      !dia.doses.some((d) => idsDeB.has(d.patientId)),
      "nenhuma dose de outra família pode vazar na tela inicial",
    );
    assert.ok(!dia.patients.some((p) => idsDeB.has(p.patientId)));
  });
});
