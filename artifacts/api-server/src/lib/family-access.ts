/**
 * Isolamento de acesso por família — ZELO.
 *
 * Todo acesso a dado de paciente deve passar por este módulo.
 * O familyId é sempre verificado antes de qualquer query de dados sensíveis.
 * Isso garante que dado de uma família nunca vaza para outra, nem por bug.
 *
 * Padrão obrigatório para routes que lidam com pacientes:
 *   1. Extraia familyId do path param
 *   2. Verifique que o recurso pertence à família (verifyPatientBelongsToFamily)
 *   3. Só então execute a query principal
 *
 * Nunca acesse dados de paciente sem passar por uma dessas funções.
 */

import { eq, and } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  patientsTable,
  caregiversTable,
  medicationsTable,
} from "@workspace/db";

/** Verifica que o paciente pertence à família. Retorna null se não pertencer. */
export async function verifyPatientBelongsToFamily(
  patientId: number,
  familyId: number
): Promise<boolean> {
  const [patient] = await db
    .select({ id: patientsTable.id })
    .from(patientsTable)
    .where(
      and(
        eq(patientsTable.id, patientId),
        eq(patientsTable.familyId, familyId)
      )
    )
    .limit(1);
  return !!patient;
}

/** Verifica que o cuidador pertence à família. */
export async function verifyCaregiverBelongsToFamily(
  caregiverId: number,
  familyId: number
): Promise<boolean> {
  const [caregiver] = await db
    .select({ id: caregiversTable.id })
    .from(caregiversTable)
    .where(
      and(
        eq(caregiversTable.id, caregiverId),
        eq(caregiversTable.familyId, familyId)
      )
    )
    .limit(1);
  return !!caregiver;
}

/** Verifica que o medicamento pertence à família. */
export async function verifyMedicationBelongsToFamily(
  medicationId: number,
  familyId: number
): Promise<boolean> {
  const [med] = await db
    .select({ id: medicationsTable.id })
    .from(medicationsTable)
    .where(
      and(
        eq(medicationsTable.id, medicationId),
        eq(medicationsTable.familyId, familyId)
      )
    )
    .limit(1);
  return !!med;
}

/**
 * Resposta padronizada de acesso negado por isolamento de família.
 * Retorna 404 (não 403) para não confirmar a existência do recurso.
 */
export const FAMILY_ACCESS_DENIED = {
  status: 404,
  body: { error: "Recurso não encontrado" },
} as const;
