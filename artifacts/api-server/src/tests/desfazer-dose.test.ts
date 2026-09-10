/**
 * Desfazer um registro de dose — Issue #135.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O DEFEITO ERA DE ALCANCE, NÃO DE AUSÊNCIA.
 *
 * A rota de desfazer existia desde sempre e estava certa. O que faltava era
 * a tela chegar nela: um único chamador (a tela inicial), um
 * `undoableRecordId` guardado na memória da aba com `setTimeout` de 60 s, e
 * só para quem tivesse **vencido a corrida** do registro.
 *
 * Recarregar a página perdia o desfazer dentro do prazo. A ficha do paciente
 * — onde o fundador registrou a dose por engano — não oferecia nenhum.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── O que este arquivo guarda ─────────────────────────────────────────────
 *
 *   1. `today-doses` manda `desfazerAte` — é o que faz o botão sobreviver a
 *      recarregar a página, porque o prazo deixou de morar no cliente.
 *   2. **Qualquer** cuidador com `register_dose` desfaz, não só quem
 *      registrou.
 *   3. O observador continua de fora.
 *   4. Passado o prazo, 409 com uma mensagem que diz o que fazer.
 *   5. Desfazer devolve a dose para `pending` e apaga o registro.
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
import { boss } from "../lib/queue.ts";
import app from "../app.ts";

const SUFIXO = "@desfazer.zelo.test";

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
  // Mesmo motivo da #134: registrar dose `taken` publica em QUEUE_DOSE_TAKEN
  // e liga o pg-boss. Sem parar, o processo deste arquivo nao termina e o job
  // do CI e cancelado no timeout de 20 min sem nenhum teste falhar.
  await boss.stop({ graceful: false });
  await db.delete(usersTable).where(like(usersTable.email, `%${SUFIXO}`));
  await db.delete(familiesTable).where(like(familiesTable.name, "Família Fictícia Desfazer %"));
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

/** Uma família com principal, um cuidador comum, um observador e uma dose que já chegou. */
async function cenario(rotulo: string) {
  const marca = `${Date.now()}${Math.floor(Math.random() * 10000)}`;

  const [family] = await db
    .insert(familiesTable)
    .values({
      name: `Família Fictícia Desfazer ${rotulo} ${marca}`,
      slug: `desf-${rotulo}-${marca}`,
    })
    .returning({ id: familiesTable.id });

  const criarCuidador = async (
    papel: "primary_caregiver" | "caregiver" | "observer",
    sufixo: string,
  ) => {
    const email = `desf-${rotulo}-${sufixo}-${marca}${SUFIXO}`;
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
      .values({ familyId: family.id, userId: user.id, name: `Pessoa Fictícia ${sufixo}`, email, role: papel })
      .returning({ id: caregiversTable.id });

    return { id: c.id, token: generateAccessToken(user.id, family.id, c.id, papel) };
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
      patientId: patient.id,
      medicationId: medication.id,
      dose: "1 comprimido",
      scheduleType: "times_per_day",
      scheduleConfig: { scheduleType: "times_per_day", times: ["08:00"] },
      startDate: Clock.todayInTimezone("America/Sao_Paulo"),
      status: "active",
    })
    .returning({ id: treatmentsTable.id });

  // Dose já chegada: registrar é o caminho normal, sem antecipação (#134).
  const [dose] = await db
    .insert(scheduledDosesTable)
    .values({
      treatmentId: treatment.id,
      patientId: patient.id,
      scheduledAt: Clock.now(),
      scheduledLocalDate: Clock.todayInTimezone("America/Sao_Paulo"),
      scheduledLocalTime: "08:00",
      status: "pending",
    })
    .returning({ id: scheduledDosesTable.id });

  return { patientId: patient.id, doseId: dose.id, principal, comum, observador };
}

interface DoseDaTela {
  id: number;
  status: string;
  recordId: number | null;
  desfazerAte: string | null;
}

async function telaDeHoje(patientId: number, token: string): Promise<DoseDaTela[]> {
  const r = await pedir("GET", `/patients/${patientId}/today-doses`, { token });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return (r.body as unknown as { doses: DoseDaTela[] }).doses;
}

describe("Desfazer um registro de dose", () => {
  it("`today-doses` manda `desfazerAte` — e é por isso que recarregar nao perde o botao", async () => {
    const c = await cenario("prazo");

    // Antes de registrar não há prazo nenhum: não existe o que desfazer.
    const antes = await telaDeHoje(c.patientId, c.principal.token);
    const doseAntes = antes.find((d) => d.id === c.doseId)!;
    assert.equal(doseAntes.desfazerAte, null);
    assert.equal(doseAntes.recordId, null);

    const registro = await pedir("POST", `/patients/${c.patientId}/dose-records`, {
      token: c.principal.token,
      json: { scheduledDoseId: c.doseId, outcome: "taken" },
    });
    assert.equal(registro.status, 201, JSON.stringify(registro.body));

    // Depois, o prazo vem pronto do servidor — é o que substitui o
    // `setTimeout` que morria junto com a aba.
    const depois = await telaDeHoje(c.patientId, c.principal.token);
    const doseDepois = depois.find((d) => d.id === c.doseId)!;
    assert.ok(doseDepois.recordId, "a tela precisa saber QUAL registro desfazer");
    assert.ok(doseDepois.desfazerAte, "a tela precisa saber ATÉ QUANDO");
    assert.ok(
      new Date(doseDepois.desfazerAte).getTime() > Clock.now().getTime(),
      "recém-registrada, o prazo tem que estar aberto",
    );
  });

  it("OUTRO cuidador desfaz — nao so quem registrou", async () => {
    const c = await cenario("outro");

    const registro = await pedir("POST", `/patients/${c.patientId}/dose-records`, {
      token: c.principal.token,
      json: { scheduledDoseId: c.doseId, outcome: "taken" },
    });
    const recordId = (registro.body as { id: number }).id;

    // Quem está junto no quarto vê o engano tanto quanto quem tocou no botão.
    const desfeito = await pedir(
      "POST",
      `/patients/${c.patientId}/dose-records/${recordId}/undo`,
      { token: c.comum.token },
    );
    assert.equal(desfeito.status, 200, JSON.stringify(desfeito.body));

    // O registro sumiu e a dose voltou a ser pendente.
    const sobrou = await db
      .select({ id: doseRecordsTable.id })
      .from(doseRecordsTable)
      .where(eq(doseRecordsTable.id, recordId));
    assert.equal(sobrou.length, 0, "o registro tinha que ter sido apagado");

    const [dose] = await db
      .select({ status: scheduledDosesTable.status })
      .from(scheduledDosesTable)
      .where(eq(scheduledDosesTable.id, c.doseId));
    assert.equal(dose.status, "pending", "a dose tem que voltar para a fila");
  });

  it("o observador nao desfaz", async () => {
    const c = await cenario("observador");

    const registro = await pedir("POST", `/patients/${c.patientId}/dose-records`, {
      token: c.principal.token,
      json: { scheduledDoseId: c.doseId, outcome: "taken" },
    });
    const recordId = (registro.body as { id: number }).id;

    const tentativa = await pedir(
      "POST",
      `/patients/${c.patientId}/dose-records/${recordId}/undo`,
      { token: c.observador.token },
    );
    assert.equal(tentativa.status, 403, JSON.stringify(tentativa.body));

    const sobrou = await db
      .select({ id: doseRecordsTable.id })
      .from(doseRecordsTable)
      .where(eq(doseRecordsTable.id, recordId));
    assert.equal(sobrou.length, 1, "o registro tem que continuar de pé");
  });

  it("passado o prazo, 409 — e a mensagem diz o que fazer, nao qual era a regra", async () => {
    const c = await cenario("prazo-vencido");

    const registro = await pedir("POST", `/patients/${c.patientId}/dose-records`, {
      token: c.principal.token,
      json: { scheduledDoseId: c.doseId, outcome: "taken" },
    });
    const recordId = (registro.body as { id: number }).id;

    // Envelhece o registro em vez de esperar um minuto de relógio real.
    await db
      .update(doseRecordsTable)
      .set({ createdAt: new Date(Clock.now().getTime() - 5 * 60_000) })
      .where(eq(doseRecordsTable.id, recordId));

    const tentativa = await pedir(
      "POST",
      `/patients/${c.patientId}/dose-records/${recordId}/undo`,
      { token: c.principal.token },
    );
    assert.equal(tentativa.status, 409, JSON.stringify(tentativa.body));
    assert.equal(tentativa.body.code, "PRAZO_DE_DESFAZER_EXPIROU");

    // O registro continua de pé: prazo vencido não apaga nada.
    const sobrou = await db
      .select({ id: doseRecordsTable.id })
      .from(doseRecordsTable)
      .where(eq(doseRecordsTable.id, recordId));
    assert.equal(sobrou.length, 1);

    // E a tela recebe um prazo já vencido, então o botão não aparece.
    const tela = await telaDeHoje(c.patientId, c.principal.token);
    const dose = tela.find((d) => d.id === c.doseId)!;
    assert.ok(dose.desfazerAte);
    assert.ok(
      new Date(dose.desfazerAte).getTime() < Clock.now().getTime(),
      "o prazo devolvido tem que estar no passado",
    );
  });
});
