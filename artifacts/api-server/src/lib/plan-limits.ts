/**
 * Limites de plano — ZELO (ZELO-38, estendido na ZELO-56).
 *
 * "O paywall é social, não funcional" (decisão de PM): o gratuito é
 * generoso o bastante pra virar hábito, e limita exatamente onde a dor
 * aparece — quando o irmão quer entrar. Este arquivo é o ÚNICO lugar com
 * os números — testar um preço/limite novo nunca deveria exigir tocar em
 * rota nenhuma.
 *
 * Todo limite é aplicado NO SERVIDOR — nunca só escondendo botão no
 * cliente. `null` num limite significa ilimitado.
 *
 * ─────────────────────────────────────────────────────────────────────
 * O QUE NUNCA ENTRA EM PAYWALL (regra fixada ao revisar a ZELO-38):
 * nada que proteja a segurança do paciente. Registrar dose, lembrete,
 * cascata de escalonamento e modo idoso valem em TODOS os planos,
 * inclusive o gratuito — a ZELO-39 já fixava o princípio ("o app continua
 * funcionando com pagamento em atraso; lembrete de remédio nunca é
 * cortado por cartão recusado"). O que um plano maior vende é CAPACIDADE
 * e GESTÃO: mais pacientes, mais cuidadores, histórico longo, consultas,
 * aviso de estoque, relatório.
 *
 * O QUE NÃO ESTÁ AQUI: cobrança institucional (ILPI, casa de repouso).
 * Ela é por leito ativo/mês, com cadastro verificado manualmente e
 * contrato — não um tier self-service. Ver "ZELO - Extensao B2B
 * Institucional.md" §6 e §8, e os portões ZELO-43/44.
 * ─────────────────────────────────────────────────────────────────────
 */
import { eq, and, count } from "drizzle-orm";
import { db } from "@workspace/db";
import { patientsTable, caregiversTable, medicationsTable, subscriptionsTable } from "@workspace/db";

/** Os planos contratáveis sozinho, do menor pro maior. */
export type PlanTier = "free" | "family" | "professional";

export interface PlanLimits {
  maxPatients: number | null;
  maxCaregivers: number | null;
  maxMedications: number | null;
  historyDays: number | null;
  appointments: boolean;
  stockLowAlert: boolean;
}

export const PLAN_LIMITS: Record<PlanTier, PlanLimits> = {
  free: {
    maxPatients: 1,
    maxCaregivers: 1,
    maxMedications: 3,
    historyDays: 7,
    appointments: false,
    stockLowAlert: false,
  },
  family: {
    maxPatients: 5,
    maxCaregivers: null,
    maxMedications: null,
    historyDays: null,
    appointments: true,
    stockLowAlert: true,
  },
  // ZELO-56: cuidador profissional autônomo, acompanhante, home care
  // pequeno — 6 a 15 idosos, cada um com a própria família, sem estrutura
  // institucional. Só a capacidade muda em relação ao Família: nenhum
  // recurso do Família fica de fora aqui.
  professional: {
    maxPatients: 15,
    maxCaregivers: null,
    maxMedications: null,
    historyDays: null,
    appointments: true,
    stockLowAlert: true,
  },
};

export const PLAN_LABELS: Record<PlanTier, string> = {
  free: "Grátis",
  family: "Família",
  professional: "Profissional",
};

/**
 * Traduz a assinatura da família no tier em vigor. Fonte única do
 * mapeamento — nenhuma rota deve olhar `subscriptions.plan` direto.
 *
 * Sem linha em `subscriptions` = gratuito. Plano pago com pagamento
 * atrasado ou cancelado também cai pro gratuito (a regra de downgrade
 * nunca apaga dado; ver isPatientEditable).
 */
export async function getPlanTier(familyId: number): Promise<PlanTier> {
  const [sub] = await db
    .select({ plan: subscriptionsTable.plan, status: subscriptionsTable.status })
    .from(subscriptionsTable)
    .where(eq(subscriptionsTable.familyId, familyId))
    .limit(1);

  if (!sub) return "free";
  if (sub.status !== "active" && sub.status !== "trialing") return "free";

  switch (sub.plan) {
    case "professional":
      return "professional";
    // "basic" e "premium" vêm da fundação e sempre significaram "pagante"
    // no produto — os dois resolvem pro Família.
    case "basic":
    case "premium":
      return "family";
    case "free":
    default:
      return "free";
  }
}

export async function getPlanLimits(familyId: number): Promise<PlanLimits> {
  return PLAN_LIMITS[await getPlanTier(familyId)];
}

export interface LimitCheck { allowed: boolean; message?: string }

// "Quente, não comercial" (texto da própria história) — nunca contagem
// regressiva, nunca escassez artificial, nunca culpa. Todo texto de
// paywall deste arquivo é revisado com essa régua.

/** O próximo tier acima do atual, se existir — é ele que a mensagem de
 *  limite oferece. Quem já está no maior plano contratável não recebe
 *  oferta de upgrade: recebe o caminho do atendimento institucional. */
function nextTier(tier: PlanTier): PlanTier | null {
  if (tier === "free") return "family";
  if (tier === "family") return "professional";
  return null;
}

function upgradeSuffix(tier: PlanTier, describe: (limits: PlanLimits) => string): string {
  const next = nextTier(tier);
  if (!next) {
    return " Se você cuida de mais gente que isso, fale com a gente sobre o atendimento para instituições.";
  }
  return ` O plano ${PLAN_LABELS[next]} ${describe(PLAN_LIMITS[next])}`;
}

export async function checkPatientLimit(familyId: number): Promise<LimitCheck> {
  const tier = await getPlanTier(familyId);
  const limits = PLAN_LIMITS[tier];
  if (limits.maxPatients === null) return { allowed: true };

  const [row] = await db.select({ n: count() }).from(patientsTable)
    .where(and(eq(patientsTable.familyId, familyId), eq(patientsTable.archived, false)));
  if ((row?.n ?? 0) >= limits.maxPatients) {
    const pessoa = limits.maxPatients === 1 ? "1 paciente" : `até ${limits.maxPatients} pacientes`;
    return {
      allowed: false,
      message: `O plano ${PLAN_LABELS[tier]} cuida de ${pessoa}.` +
        upgradeSuffix(tier, (l) => `libera até ${l.maxPatients}.`),
    };
  }
  return { allowed: true };
}

export async function checkCaregiverLimit(familyId: number): Promise<LimitCheck> {
  const tier = await getPlanTier(familyId);
  const limits = PLAN_LIMITS[tier];
  if (limits.maxCaregivers === null) return { allowed: true };

  const [row] = await db.select({ n: count() }).from(caregiversTable).where(eq(caregiversTable.familyId, familyId));
  if ((row?.n ?? 0) >= limits.maxCaregivers) {
    return { allowed: false, message: "Cuidar junto é melhor. O plano Família libera cuidadores ilimitados." };
  }
  return { allowed: true };
}

export async function checkMedicationLimit(familyId: number): Promise<LimitCheck> {
  const tier = await getPlanTier(familyId);
  const limits = PLAN_LIMITS[tier];
  if (limits.maxMedications === null) return { allowed: true };

  const [row] = await db.select({ n: count() }).from(medicationsTable).where(eq(medicationsTable.familyId, familyId));
  if ((row?.n ?? 0) >= limits.maxMedications) {
    return {
      allowed: false,
      message: `O plano ${PLAN_LABELS[tier]} cadastra ${limits.maxMedications} medicamentos. O plano Família libera ilimitado.`,
    };
  }
  return { allowed: true };
}

/**
 * Downgrade NUNCA apaga dado (regra explícita da história): os pacientes
 * mais antigos (por createdAt, sempre a mesma ordem, determinístico)
 * continuam editáveis até o limite do plano atual — os excedentes viram
 * somente-leitura, sempre visíveis, sempre exportáveis, só não aceitam
 * escrita nova enquanto o plano não cobrir eles de novo.
 *
 * Vale só pra CRESCER (criar tratamento novo). REGISTRAR DOSE nunca passa
 * por aqui — ver o cabeçalho de routes/dose-records.ts.
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
