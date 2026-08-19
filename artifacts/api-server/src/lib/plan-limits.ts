/**
 * Limites de plano — ZELO (ZELO-38).
 *
 * "O paywall é social, não funcional" (decisão de PM): o gratuito é
 * generoso o bastante pra virar hábito, e limita exatamente onde a dor
 * aparece — quando o irmão quer entrar. Este arquivo é o ÚNICO lugar com
 * os números — testar um preço/limite novo nunca deveria exigir tocar em
 * rota nenhuma.
 *
 * Todo limite é aplicado NO SERVIDOR — nunca só escondendo botão no
 * cliente. `null` num limite significa ilimitado.
 */
import { eq, and, count } from "drizzle-orm";
import { db } from "@workspace/db";
import { patientsTable, caregiversTable, medicationsTable } from "@workspace/db";
import { hasPaidAccess } from "./subscription.ts";

export interface PlanLimits {
  maxPatients: number | null;
  maxCaregivers: number | null;
  maxMedications: number | null;
  historyDays: number | null;
  appointments: boolean;
  stockLowAlert: boolean;
}

export const PLAN_LIMITS: { free: PlanLimits; paid: PlanLimits } = {
  free: {
    maxPatients: 1,
    maxCaregivers: 1,
    maxMedications: 3,
    historyDays: 7,
    appointments: false,
    stockLowAlert: false,
  },
  paid: {
    maxPatients: 5,
    maxCaregivers: null,
    maxMedications: null,
    historyDays: null,
    appointments: true,
    stockLowAlert: true,
  },
};

export async function getPlanLimits(familyId: number): Promise<PlanLimits> {
  return (await hasPaidAccess(familyId)) ? PLAN_LIMITS.paid : PLAN_LIMITS.free;
}

export interface LimitCheck { allowed: boolean; message?: string }

// "Quente, não comercial" (texto da própria história) — nunca contagem
// regressiva, nunca escassez artificial, nunca culpa. Todo texto de
// paywall deste arquivo é revisado com essa régua.

export async function checkPatientLimit(familyId: number): Promise<LimitCheck> {
  const limits = await getPlanLimits(familyId);
  if (limits.maxPatients === null) return { allowed: true };
  const [row] = await db.select({ n: count() }).from(patientsTable)
    .where(and(eq(patientsTable.familyId, familyId), eq(patientsTable.archived, false)));
  if ((row?.n ?? 0) >= limits.maxPatients) {
    return { allowed: false, message: `O plano gratuito cuida de ${limits.maxPatients} paciente. O plano Família libera até ${PLAN_LIMITS.paid.maxPatients}.` };
  }
  return { allowed: true };
}

export async function checkCaregiverLimit(familyId: number): Promise<LimitCheck> {
  const limits = await getPlanLimits(familyId);
  if (limits.maxCaregivers === null) return { allowed: true };
  const [row] = await db.select({ n: count() }).from(caregiversTable).where(eq(caregiversTable.familyId, familyId));
  if ((row?.n ?? 0) >= limits.maxCaregivers) {
    return { allowed: false, message: "Cuidar junto é melhor. O plano Família libera cuidadores ilimitados." };
  }
  return { allowed: true };
}

export async function checkMedicationLimit(familyId: number): Promise<LimitCheck> {
  const limits = await getPlanLimits(familyId);
  if (limits.maxMedications === null) return { allowed: true };
  const [row] = await db.select({ n: count() }).from(medicationsTable).where(eq(medicationsTable.familyId, familyId));
  if ((row?.n ?? 0) >= limits.maxMedications) {
    return { allowed: false, message: `O plano gratuito cadastra ${limits.maxMedications} medicamentos. O plano Família libera ilimitado.` };
  }
  return { allowed: true };
}

/**
 * Downgrade NUNCA apaga dado (regra explícita da história): os pacientes
 * mais antigos (por createdAt, sempre a mesma ordem, determinístico)
 * continuam editáveis até o limite do plano atual — os excedentes viram
 * somente-leitura, sempre visíveis, sempre exportáveis, só não aceitam
 * escrita nova enquanto o plano não cobrir eles de novo.
 */
export async function isPatientEditable(patientId: number, familyId: number): Promise<boolean> {
  const limits = await getPlanLimits(familyId);
  if (limits.maxPatients === null) return true;

  const activePatients = await db
    .select({ id: patientsTable.id })
    .from(patientsTable)
    .where(and(eq(patientsTable.familyId, familyId), eq(patientsTable.archived, false)))
    .orderBy(patientsTable.createdAt);

  const editableIds = new Set(activePatients.slice(0, limits.maxPatients).map((p) => p.id));
  return editableIds.has(patientId);
}

export const READ_ONLY_MESSAGE = "Este paciente ficou fora do limite do plano atual — os dados continuam aqui, completos, só não aceitam edição nova. Reative o plano Família pra voltar a editar.";
