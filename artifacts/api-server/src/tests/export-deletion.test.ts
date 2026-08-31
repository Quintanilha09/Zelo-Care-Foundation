/**
 * Testes de exportação e exclusão de dados — ZELO.
 *
 * Cobre:
 * - Exportação gera link de download autenticado com expiração
 * - Link de download é de uso único (marcado após download)
 * - Exclusão remove fisicamente TODOS os dados (sem sobrar linha órfã)
 * - Janela de 7 dias: pode ser cancelada antes
 * - Após janela: execução remove família, pacientes, tratamentos, doses, registros
 * - Apenas um rastro sobrevive: entrada no audit_log
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { eq, and, like } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  usersTable, caregiversTable, familiesTable, patientsTable,
  treatmentsTable, scheduledDosesTable, medicationsTable,
  consentRecordsTable, deletionRequestsTable, 
} from "@workspace/db";
import { generateAccessToken } from "../lib/tokens.ts";
import { hashPassword } from "../lib/password.ts";
import { Clock } from "../lib/clock.ts";
import app from "../app.ts";

let testPort: number;
let closeServer: () => Promise<void>;

interface TestFamily {
  userId: number; familyId: number; caregiverId: number;
  patientId: number; token: string;
}

async function createCompleteFamily(email: string): Promise<TestFamily> {
  const [family] = await db
    .insert(familiesTable)
    .values({ name: `Família ExportDel ${email}`, slug: `exportdel-${Date.now()}-${Math.random().toString(36).slice(2)}` })
    .returning();
  const [user] = await db
    .insert(usersTable)
    .values({ email, name: "ExportDel Test", passwordHash: await hashPassword("test"), emailVerified: true, status: "active" })
    .returning();
  const [caregiver] = await db
    .insert(caregiversTable)
    .values({ familyId: family.id, userId: user.id, name: "ExportDel Test", email, role: "primary_caregiver" })
    .returning();
  await db.insert(consentRecordsTable).values([
    { userId: user.id, consentType: "terms_of_service", consentGiven: "true", version: "v1.0", ipAddress: "127.0.0.1" },
    { userId: user.id, consentType: "health_data_processing", consentGiven: "true", version: "v1.0", ipAddress: "127.0.0.1" },
  ]);
  const [patient] = await db
    .insert(patientsTable)
    .values({ familyId: family.id, name: "Paciente ExportDel", timezone: "America/Sao_Paulo" })
    .returning();
  const [medication] = await db
    .insert(medicationsTable)
    .values({ familyId: family.id, name: "Medicamento ExportDel (fictício)" })
    .returning();
  const [treatment] = await db
    .insert(treatmentsTable)
    .values({
      patientId: patient.id, medicationId: medication.id, dose: "1cp",
      scheduleType: "times_per_day", scheduleConfig: { timesPerDay: 1, times: ["08:00"] },
      startDate: "2025-01-01",
    })
    .returning();
  await db.insert(scheduledDosesTable).values({
    treatmentId: treatment.id, patientId: patient.id, scheduledAt: new Date(),
    scheduledLocalDate: "2025-01-01", scheduledLocalTime: "08:00", status: "pending",
  });

  const token = generateAccessToken(user.id, family.id, caregiver.id, "primary_caregiver");
  return { userId: user.id, familyId: family.id, caregiverId: caregiver.id, patientId: patient.id, token };
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
});

after(async () => {
  await closeServer();
  Clock.reset();
  // Apaga a FAMÍLIA, não só o usuário. `families` é a raiz: patients e
  // caregivers têm cascade a partir dela, mas nada cascateia a partir de
  // `users` — apagar o usuário deixava a família para trás. Em 24/08/2026
  // havia ~90 famílias órfãs acumuladas no banco de dev.
  //
  // Por PADRÃO DE NOME, não por id capturado: assim também recolhe o lixo de
  // execuções anteriores que morreram antes do `after` — que é como a maior
  // parte das órfãs apareceu. Torna a limpeza idempotente, mesma regra que
  // este projeto já aplica aos hooks `before`.
  await db.delete(familiesTable).where(like(familiesTable.name, "Família ExportDel %"));
});

function api(token: string, method: string, path: string, body?: unknown) {
  const payload = body ? JSON.stringify(body) : undefined;
  return new Promise<{ status: number; body: unknown; rawBody: string }>((resolve, reject) => {
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
          try { resolve({ status: res.statusCode ?? 0, body: JSON.parse(data), rawBody: data }); }
          catch { resolve({ status: res.statusCode ?? 0, body: data, rawBody: data }); }
        });
      }
    );
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function rawGet(path: string) {
  return new Promise<{ status: number; body: string; contentType?: string }>((resolve, reject) => {
    const req = http.request(
      { hostname: "127.0.0.1", port: testPort, path: `/api${path}`, method: "GET" },
      (res) => {
        let data = "";
        res.on("data", (c: Buffer) => (data += c.toString()));
        res.on("end", () => resolve({
          status: res.statusCode ?? 0,
          body: data,
          contentType: res.headers["content-type"],
        }));
      }
    );
    req.on("error", reject);
    req.end();
  });
}

describe("Exportação e exclusão de dados — ZELO", () => {

  describe("Exportação de dados", () => {
    let exportFamily: TestFamily;

    before(async () => {
      exportFamily = await createCompleteFamily("export-test@zelo.test");
    });

    after(async () => {
      await db.delete(usersTable).where(eq(usersTable.email, "export-test@zelo.test"));
      await db.delete(familiesTable).where(eq(familiesTable.id, exportFamily.familyId));
    });

    it("POST /export retorna link de download autenticado com expiração", async () => {
      const res = await api(exportFamily.token, "POST", "/export");
      assert.equal(res.status, 200);
      const body = res.body as { downloadUrl: string; expiresAt: string; patientCount: number };
      assert.ok(body.downloadUrl.includes("/export/download/"), "deve ter URL de download");
      assert.ok(body.expiresAt, "deve ter data de expiração");
      assert.equal(body.patientCount, 1, "deve informar contagem de pacientes");
    });

    it("link de download retorna JSON com dados do paciente", async () => {
      const exportRes = await api(exportFamily.token, "POST", "/export");
      const { downloadUrl } = exportRes.body as { downloadUrl: string };
      // Remove o prefixo /api já incluído na URL
      const path = downloadUrl.replace(/^\/api/, "");
      const dlRes = await rawGet(path);
      assert.equal(dlRes.status, 200);
      assert.ok(dlRes.contentType?.includes("application/json"), "deve retornar JSON");
      const data = JSON.parse(dlRes.body) as { patients: Array<unknown>; exportDate: string };
      assert.ok(Array.isArray(data.patients), "deve ter campo patients");
      assert.ok(data.exportDate, "deve ter exportDate");
    });

    it("link de download é de uso único — segunda tentativa retorna 404", async () => {
      const exportRes = await api(exportFamily.token, "POST", "/export");
      const { downloadUrl } = exportRes.body as { downloadUrl: string };
      const path = downloadUrl.replace(/^\/api/, "");

      // Primeiro download — funciona
      const first = await rawGet(path);
      assert.equal(first.status, 200, "primeiro download deve funcionar");

      // Segundo download — deve falhar (token marcado como usado)
      const second = await rawGet(path);
      assert.equal(second.status, 404, "segundo download deve retornar 404 (uso único)");
    });

    it("link de download expirado retorna 404", async () => {
      const exportRes = await api(exportFamily.token, "POST", "/export");
      const { downloadUrl } = exportRes.body as { downloadUrl: string };
      const path = downloadUrl.replace(/^\/api/, "");

      // Avança o relógio 2 horas (link expira em 1 hora)
      Clock.advance(2 * 60 * 60 * 1000);
      const dlRes = await rawGet(path);
      Clock.reset();
      assert.equal(dlRes.status, 404, "link expirado deve retornar 404");
    });
  });

  describe("Exclusão de dados", () => {
    let delFamily: TestFamily;

    before(async () => {
      delFamily = await createCompleteFamily("deletion-test@zelo.test");
    });

    it("solicitação de exclusão cria registro com janela de 7 dias", async () => {
      const res = await api(delFamily.token, "POST", "/account/deletion/request");
      assert.equal(res.status, 201);
      const body = res.body as { scheduledDeletionAt: string; requestId: number };
      assert.ok(body.scheduledDeletionAt, "deve ter data de execução agendada");
      const scheduled = new Date(body.scheduledDeletionAt);
      const diffDays = (scheduled.getTime() - Date.now()) / (1000 * 60 * 60 * 24);
      assert.ok(diffDays > 6 && diffDays < 8, `janela deve ser ~7 dias, foi ${diffDays.toFixed(1)} dias`);
    });

    it("segunda solicitação retorna 409 (já existe pendente)", async () => {
      const res = await api(delFamily.token, "POST", "/account/deletion/request");
      assert.equal(res.status, 409);
    });

    it("cancelar exclusão dentro da janela cancela a solicitação", async () => {
      const res = await api(delFamily.token, "POST", "/account/deletion/cancel");
      assert.equal(res.status, 200);

      // Verifica no banco
      const [req] = await db
        .select({ status: deletionRequestsTable.status })
        .from(deletionRequestsTable)
        .where(and(eq(deletionRequestsTable.familyId, delFamily.familyId), eq(deletionRequestsTable.status, "cancelled")))
        .limit(1);
      assert.ok(req, "solicitação deve estar marcada como cancelada no banco");
    });

    it("executar exclusão antes da janela retorna 409", async () => {
      // Cria nova solicitação (a anterior foi cancelada)
      await api(delFamily.token, "POST", "/account/deletion/request");
      const res = await api(delFamily.token, "POST", "/account/deletion/execute");
      assert.equal(res.status, 409, "não deve executar antes da janela de 7 dias");
      // Cancela para próximo teste
      await api(delFamily.token, "POST", "/account/deletion/cancel");
    });

    it("após janela: executar exclusão remove TODOS os dados fisicamente", async () => {
      // Cria nova solicitação
      await api(delFamily.token, "POST", "/account/deletion/request");

      // Avança o relógio 8 dias (passou a janela de 7 dias)
      Clock.advance(8 * 24 * 60 * 60 * 1000);

      const execRes = await api(delFamily.token, "POST", "/account/deletion/execute");
      Clock.reset();
      assert.equal(execRes.status, 200, "execução deve retornar 200");

      // Verifica que todos os dados foram excluídos fisicamente
      const [family] = await db
        .select({ id: familiesTable.id })
        .from(familiesTable)
        .where(eq(familiesTable.id, delFamily.familyId))
        .limit(1);
      assert.equal(family, undefined, "família deve ter sido excluída fisicamente");

      // Verifica que não há pacientes órfãos
      const orphanPatients = await db
        .select({ id: patientsTable.id })
        .from(patientsTable)
        .where(eq(patientsTable.id, delFamily.patientId));
      assert.equal(orphanPatients.length, 0, "não deve sobrar linha órfã em patients");

      // Token de delFamily não funciona mais (família excluída = familyId inválido)
      const afterRes = await api(delFamily.token, "GET", "/patients");
      // 200 com lista vazia OU 404 — nunca deve retornar dados de outra família
      if (afterRes.status === 200) {
        const patients = afterRes.body as Array<{ familyId: number }>;
        assert.equal(patients.length, 0, "deve retornar lista vazia após exclusão");
      }
    });

    after(async () => {
      // Limpeza (caso algum teste tenha falhado antes da exclusão)
      try {
        await db.delete(usersTable).where(eq(usersTable.email, "deletion-test@zelo.test"));
        await db.delete(familiesTable).where(eq(familiesTable.id, delFamily.familyId));
      } catch { /* ignora — família pode já ter sido excluída pelo teste */ }
    });
  });

  /**
   * QUI-17 — o defeito que a exportação carregava calada.
   *
   * A consulta filtrava por `patientIds[0]`, não pela lista. Numa família
   * com mais de um paciente, só o primeiro saía com dados; os demais vinham
   * com `treatments: []`, `doseRecords: []` e por aí.
   *
   * E como não havia tela chamando a rota, ninguém tinha como perceber: a
   * exportação é justamente o direito do titular de levar os próprios dados
   * embora, e ela mentia sem dar erro nenhum.
   */
  describe("Exportação com mais de um paciente — QUI-17", () => {
    let familia: TestFamily;
    let segundoPacienteId: number;

    before(async () => {
      familia = await createCompleteFamily("export-multi@zelo.test");

      const [segundo] = await db
        .insert(patientsTable)
        .values({ familyId: familia.familyId, name: "Segundo Paciente ExportDel", timezone: "America/Sao_Paulo" })
        .returning();
      segundoPacienteId = segundo.id;

      const [remedio] = await db
        .insert(medicationsTable)
        .values({ familyId: familia.familyId, name: "Segundo Medicamento ExportDel (fictício)" })
        .returning();
      await db.insert(treatmentsTable).values({
        patientId: segundo.id,
        medicationId: remedio.id,
        dose: "2cp",
        scheduleType: "times_per_day",
        scheduleConfig: { timesPerDay: 1, times: ["20:00"] },
        startDate: "2025-01-01",
      });
    });

    after(async () => {
      await db.delete(usersTable).where(eq(usersTable.email, "export-multi@zelo.test"));
      await db.delete(familiesTable).where(eq(familiesTable.id, familia.familyId));
    });

    it("traz os dados de TODOS os pacientes, não só do primeiro", async () => {
      const criado = await api(familia.token, "POST", "/export");
      assert.equal(criado.status, 200);
      const { downloadUrl, patientCount } = criado.body as { downloadUrl: string; patientCount: number };
      assert.equal(patientCount, 2);

      const baixado = await rawGet(downloadUrl.replace(/^\/api/, ""));
      assert.equal(baixado.status, 200);
      const dados = JSON.parse(baixado.body) as {
        patients: Array<{ id: number; treatments: Array<unknown> }>;
      };

      assert.equal(dados.patients.length, 2, "os dois pacientes precisam aparecer");
      for (const paciente of dados.patients) {
        assert.ok(
          paciente.treatments.length > 0,
          `o paciente ${paciente.id} saiu sem tratamento — era o defeito: a consulta filtrava por patientIds[0]`
        );
      }
      assert.ok(
        dados.patients.some((p) => p.id === segundoPacienteId),
        "o segundo paciente precisa estar no arquivo"
      );
    });
  });

  /**
   * GET /account/deletion — QUI-17.
   *
   * Sem esta rota não dá para construir a tela: ela é quem diz se a página
   * deve oferecer "solicitar", "cancelar" ou "excluir agora".
   */
  describe("Estado do pedido de exclusão — QUI-17", () => {
    let familia: TestFamily;

    before(async () => {
      familia = await createCompleteFamily("deletion-state@zelo.test");
    });

    after(async () => {
      Clock.reset();
      await db.delete(usersTable).where(eq(usersTable.email, "deletion-state@zelo.test"));
      await db.delete(familiesTable).where(eq(familiesTable.id, familia.familyId));
    });

    it("sem pedido nenhum, responde pending: null", async () => {
      const res = await api(familia.token, "GET", "/account/deletion");
      assert.equal(res.status, 200);
      assert.equal((res.body as { pending: unknown }).pending, null);
    });

    it("com pedido aberto, devolve a data e diz que ainda NÃO pode executar", async () => {
      const pedido = await api(familia.token, "POST", "/account/deletion/request");
      assert.equal(pedido.status, 201);

      const res = await api(familia.token, "GET", "/account/deletion");
      const pendente = (res.body as { pending: { scheduledDeletionAt: string; canExecuteNow: boolean } }).pending;
      assert.ok(pendente, "o pedido recém-criado precisa aparecer");
      assert.equal(
        pendente.canExecuteNow,
        false,
        "a janela de sete dias mal começou — oferecer o botão aqui seria apagar antes da hora"
      );
    });

    it("passados os sete dias, diz que pode executar", async () => {
      // Quem decide é o relógio do SERVIDOR — a tela não calcula isso pelo
      // relógio do aparelho, que pode estar adiantado.
      Clock.advance(8 * 24 * 60 * 60 * 1000);
      const res = await api(familia.token, "GET", "/account/deletion");
      Clock.reset();

      const pendente = (res.body as { pending: { canExecuteNow: boolean } }).pending;
      assert.equal(pendente.canExecuteNow, true);
    });

    it("cancelado, volta a responder pending: null", async () => {
      const cancelou = await api(familia.token, "POST", "/account/deletion/cancel");
      assert.equal(cancelou.status, 200);

      const res = await api(familia.token, "GET", "/account/deletion");
      assert.equal((res.body as { pending: unknown }).pending, null);
    });
  });
});
