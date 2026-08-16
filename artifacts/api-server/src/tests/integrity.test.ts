/**
 * Testes das proteções de integridade do banco de dados — ZELO
 *
 * Verifica as duas regras críticas garantidas no nível do banco:
 *
 * REGRA #1: Impossível agendar a mesma dose duas vezes para o mesmo
 *           tratamento no mesmo horário — UNIQUE(treatment_id, scheduled_at)
 *
 * REGRA #2: Impossível existir mais de um registro de resultado para a
 *           mesma dose agendada — UNIQUE(scheduled_dose_id) em dose_records
 *
 * Requer banco de dados ativo (DATABASE_URL).
 * Rodar com: pnpm --filter @workspace/api-server run test:all
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { db } from "@workspace/db";
import {
  familiesTable,
  patientsTable,
  caregiversTable,
  medicationsTable,
  treatmentsTable,
  scheduledDosesTable,
  doseRecordsTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";

// IDs gerados durante os testes — limpos em after()
let familyId: number;
let patientId: number;
let caregiverId: number;
let medicationId: number;
let treatmentId: number;
let scheduledDoseId: number;

before(async () => {
  // Cria dados de teste fictícios explicitamente marcados
  const [family] = await db
    .insert(familiesTable)
    .values({ name: "Família Integridade Teste", slug: `integrity-test-${Date.now()}` })
    .returning();
  familyId = family.id;

  const [patient] = await db
    .insert(patientsTable)
    .values({ familyId, name: "Paciente Teste de Integridade", timezone: "America/Sao_Paulo" })
    .returning();
  patientId = patient.id;

  const [caregiver] = await db
    .insert(caregiversTable)
    .values({ familyId, name: "Cuidador Teste", role: "caregiver" })
    .returning();
  caregiverId = caregiver.id;

  const [medication] = await db
    .insert(medicationsTable)
    .values({ familyId, name: "RemédioTeste_Fictício", form: "tablet" })
    .returning();
  medicationId = medication.id;

  const [treatment] = await db
    .insert(treatmentsTable)
    .values({
      patientId,
      medicationId,
      scheduleType: "times_per_day",
      scheduleConfig: { timesPerDay: 1, times: ["08:00"] },
      startDate: "2025-01-01",
    })
    .returning();
  treatmentId = treatment.id;
});

after(async () => {
  // Limpeza em ordem de dependência (filho antes do pai)
  if (scheduledDoseId) {
    await db.delete(doseRecordsTable).where(eq(doseRecordsTable.scheduledDoseId, scheduledDoseId)).catch(() => {});
    await db.delete(scheduledDosesTable).where(eq(scheduledDosesTable.id, scheduledDoseId)).catch(() => {});
  }
  if (treatmentId) await db.delete(treatmentsTable).where(eq(treatmentsTable.id, treatmentId)).catch(() => {});
  if (medicationId) await db.delete(medicationsTable).where(eq(medicationsTable.id, medicationId)).catch(() => {});
  if (patientId) await db.delete(patientsTable).where(eq(patientsTable.id, patientId)).catch(() => {});
  if (familyId) await db.delete(familiesTable).where(eq(familiesTable.id, familyId)).catch(() => {});
});

describe("Integridade #1 — Dose agendada duplicada é impossível no banco", () => {
  const scheduledAt = new Date("2025-06-15T08:00:00.000Z");

  it("insere a primeira dose agendada com sucesso", async () => {
    const [dose] = await db
      .insert(scheduledDosesTable)
      .values({ treatmentId, patientId, scheduledAt })
      .returning();
    scheduledDoseId = dose.id;
    assert.ok(dose.id > 0, "Primeira dose deve ser inserida com sucesso");
  });

  it("rejeita segunda dose idêntica (mesmo treatment, mesmo horário) com erro de constraint", async () => {
    await assert.rejects(
      () => db.insert(scheduledDosesTable).values({ treatmentId, patientId, scheduledAt }).returning(),
      (err: unknown) => {
        // Drizzle pode envolver o erro pg — verificar em err ou em err.cause
        const e = err as { code?: string; message?: string; cause?: { code?: string; message?: string } };
        const code = e.code ?? e.cause?.code;
        const msg = (e.message ?? "") + (e.cause?.message ?? "");
        assert.ok(
          code === "23505" || msg.includes("unique") || msg.includes("duplicate"),
          `Esperava erro de constraint unique, recebeu: code=${code}, msg=${msg}`
        );
        return true;
      },
      "Segundo INSERT deve ser rejeitado pelo banco com constraint unique"
    );
  });

  it("permite dose com mesmo treatment mas horário diferente (sem conflito)", async () => {
    const differentTime = new Date("2025-06-15T20:00:00.000Z");
    const [dose] = await db
      .insert(scheduledDosesTable)
      .values({ treatmentId, patientId, scheduledAt: differentTime })
      .returning();
    assert.ok(dose.id > 0, "Dose com horário diferente deve ser permitida");
    await db.delete(scheduledDosesTable).where(eq(scheduledDosesTable.id, dose.id));
  });
});

describe("Integridade #2 — Registro de dose duplicado é impossível no banco", () => {
  it("insere o primeiro registro de dose com sucesso", async () => {
    assert.ok(scheduledDoseId, "scheduledDoseId deve existir do teste anterior");
    const [record] = await db
      .insert(doseRecordsTable)
      .values({ scheduledDoseId, patientId, caregiverId, takenAt: new Date("2025-06-15T08:03:00.000Z"), outcome: "taken" })
      .returning();
    assert.ok(record.id > 0, "Primeiro registro de dose deve ser inserido com sucesso");
  });

  it("rejeita segundo registro para a mesma dose agendada (dois cuidadores simultâneos)", async () => {
    await assert.rejects(
      () => db
        .insert(doseRecordsTable)
        .values({ scheduledDoseId, patientId, caregiverId, takenAt: new Date("2025-06-15T08:05:00.000Z"), outcome: "taken" })
        .returning(),
      (err: unknown) => {
        // Drizzle pode envolver o erro pg — verificar em err ou em err.cause
        const e = err as { code?: string; message?: string; cause?: { code?: string; message?: string } };
        const code = e.code ?? e.cause?.code;
        const msg = (e.message ?? "") + (e.cause?.message ?? "");
        assert.ok(
          code === "23505" || msg.includes("unique") || msg.includes("duplicate"),
          `Esperava erro de constraint unique, recebeu: code=${code}, msg=${msg}`
        );
        return true;
      },
      "Segundo registro para a mesma dose deve ser rejeitado — sem duplicidade possível"
    );
  });
});
