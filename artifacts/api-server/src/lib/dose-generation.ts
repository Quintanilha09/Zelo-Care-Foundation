/**
 * Geração de doses — ZELO (ZELO-18).
 *
 * Usa o motor de recorrência puro (@workspace/scheduling) para expandir a
 * posologia de um tratamento numa janela de tempo, e persiste o resultado
 * em scheduled_doses. A idempotência não depende deste código — depende da
 * constraint UNIQUE(treatment_id, scheduled_at) no banco (Fase 01). Rodar
 * esta função várias vezes para o mesmo tratamento nunca duplica dose.
 *
 * LIMITAÇÃO CONHECIDA: a janela só é gerada na criação/edição do tratamento,
 * ainda não existe o job diário que estende a janela conforme o tempo passa
 * (isso é a parte do pg-boss desta história, que fica pra próxima rodada).
 * Um tratamento contínuo antigo, sem edição, vai ficar sem dose nova depois
 * de 14 dias até esse job existir.
 */
import { and, eq, gte } from "drizzle-orm";
import { db } from "@workspace/db";
import { treatmentsTable, patientsTable, scheduledDosesTable } from "@workspace/db";
import { expandSchedule } from "@workspace/scheduling";
import type { ScheduleConfig } from "@workspace/scheduling";
import { Clock } from "./clock.ts";

export const DOSE_WINDOW_DAYS = 14;

/**
 * Gera e persiste as doses dos próximos DOSE_WINDOW_DAYS dias para um
 * tratamento. Idempotente: pode ser chamada quantas vezes for preciso.
 */
export async function generateDosesForTreatment(treatmentId: number): Promise<number> {
  const [row] = await db
    .select({
      treatment: treatmentsTable,
      patientTimezone: patientsTable.timezone,
    })
    .from(treatmentsTable)
    .innerJoin(patientsTable, eq(treatmentsTable.patientId, patientsTable.id))
    .where(eq(treatmentsTable.id, treatmentId))
    .limit(1);

  if (!row || row.treatment.status !== "active") return 0;

  const windowStart = Clock.now();
  const windowEnd = new Date(windowStart.getTime() + DOSE_WINDOW_DAYS * 86_400_000);

  const dates = expandSchedule(
    {
      schedule: row.treatment.scheduleConfig as ScheduleConfig,
      treatmentStartDate: row.treatment.startDate,
      treatmentEndDate: row.treatment.endDate,
      timezone: row.patientTimezone,
    },
    windowStart,
    windowEnd
  );

  if (dates.length === 0) return 0;

  const inserted = await db
    .insert(scheduledDosesTable)
    .values(
      dates.map((scheduledAt) => ({
        treatmentId,
        patientId: row.treatment.patientId,
        scheduledAt,
        dose: row.treatment.dose,
      }))
    )
    // A constraint UNIQUE(treatment_id, scheduled_at) do banco é quem garante
    // idempotência de verdade — isto aqui só evita o erro 23505 subir até o
    // chamador quando a dose já existe.
    .onConflictDoNothing()
    .returning({ id: scheduledDosesTable.id });

  return inserted.length;
}

/**
 * Ao editar a posologia, remove as doses FUTURAS ainda pendentes (nunca as
 * já registradas — isso é histórico) e regenera a partir do schedule novo.
 * Chame antes de gerar de novo.
 */
export async function clearFuturePendingDoses(treatmentId: number): Promise<void> {
  await db
    .delete(scheduledDosesTable)
    .where(
      and(
        eq(scheduledDosesTable.treatmentId, treatmentId),
        eq(scheduledDosesTable.status, "pending"),
        gte(scheduledDosesTable.scheduledAt, Clock.now())
      )
    );
}

/** Cancela doses futuras pendentes quando um tratamento é encerrado/pausado. */
export async function cancelFutureDoses(treatmentId: number): Promise<void> {
  await clearFuturePendingDoses(treatmentId);
}
