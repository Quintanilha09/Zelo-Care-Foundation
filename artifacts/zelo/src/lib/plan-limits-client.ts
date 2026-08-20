/**
 * Limites de plano no cliente — ZELO (ZELO-38, estendido na ZELO-56).
 *
 * A AUTORIDADE continua sendo o servidor (api-server/src/lib/plan-limits.ts),
 * e nada aqui substitui a checagem dele: toda rota que cria recurso contado
 * responde 403 `{ code: "PLAN_LIMIT" }` e esse caminho segue tratado. O que
 * este módulo faz é evitar um desrespeito com o tempo de quem usa — levar o
 * cuidador por um formulário inteiro (nome, data de nascimento, consentimento)
 * pra só no "Salvar" dizer que o plano não permite.
 *
 * Se cliente e servidor divergirem por qualquer motivo, o servidor vence e a
 * mensagem exibida passa a ser a dele.
 */

export type PlanTier = "free" | "family" | "professional";

export interface PlanLimitsView {
  maxPatients: number | null;
  maxCaregivers: number | null;
  maxMedications: number | null;
  historyDays: number | null;
  appointments: boolean;
  stockLowAlert: boolean;
}

export interface PlanView {
  tier: PlanTier;
  label: string;
  isPaid: boolean;
  limits: PlanLimitsView;
}

/** `null` num limite significa ilimitado — mesma convenção do servidor. */
function reached(current: number, max: number | null): boolean {
  return max !== null && current >= max;
}

export function patientLimitReached(plan: PlanView | null | undefined, activePatients: number): boolean {
  if (!plan) return false; // sem plano carregado ainda, nunca bloquear por conta própria
  return reached(activePatients, plan.limits.maxPatients);
}

export function caregiverLimitReached(plan: PlanView | null | undefined, caregivers: number): boolean {
  if (!plan) return false;
  return reached(caregivers, plan.limits.maxCaregivers);
}

const NEXT_TIER: Record<PlanTier, PlanTier | null> = {
  free: "family",
  family: "professional",
  professional: null,
};

const TIER_LABEL: Record<PlanTier, string> = {
  free: "Grátis",
  family: "Família",
  professional: "Profissional",
};

const TIER_MAX_PATIENTS: Record<PlanTier, number | null> = {
  free: 1,
  family: 5,
  professional: 15,
};

/** Texto espelhado do servidor. Fica igual de propósito — quando a resposta
 *  403 chega de verdade, é a mensagem dela que aparece. */
export function patientLimitMessage(plan: PlanView | null | undefined): string {
  const tier = plan?.tier ?? "free";
  const max = plan?.limits.maxPatients ?? 1;
  const quantos = max === 1 ? "1 paciente" : `até ${max} pacientes`;
  const next = NEXT_TIER[tier];
  const oferta = next
    ? ` O plano ${TIER_LABEL[next]} libera até ${TIER_MAX_PATIENTS[next]}.`
    : " Se você cuida de mais gente que isso, fale com a gente sobre o atendimento para instituições.";
  return `O plano ${TIER_LABEL[tier]} cuida de ${quantos}.${oferta}`;
}

export function caregiverLimitMessage(): string {
  return "Cuidar junto é melhor. O plano Família libera cuidadores ilimitados.";
}

/** O que o próximo plano entrega — mostrado na tela quente de limite, pra a
 *  pessoa entender o que ganha, não só o que não pode. */
export function planHighlights(currentTier: PlanTier | undefined): { title: string; items: string[] } {
  const next = NEXT_TIER[currentTier ?? "free"];
  if (next === "professional") {
    return {
      title: "Com o plano Profissional:",
      items: [
        "Até 15 pacientes",
        "Painel do dia com todos eles numa tela",
        "Cuidadores e medicamentos sem limite",
        "Histórico completo e relatório para o médico",
      ],
    };
  }
  if (next === "family") {
    return {
      title: "Com o plano Família:",
      items: [
        "Até 5 pacientes",
        "Cuidadores sem limite",
        "Medicamentos sem limite",
        "Histórico completo, sem corte de 7 dias",
        "Agenda de consultas e exames",
        "Aviso de estoque acabando",
      ],
    };
  }
  // Já está no maior plano contratável sozinho — o caminho daqui é
  // atendimento institucional, que não é self-service (ver §6 do
  // documento de extensão B2B).
  return {
    title: "Cuida de mais gente que isso?",
    items: [
      "Existe atendimento para casas de repouso e empresas de cuidado",
      "Cobrança por leito, com implantação acompanhada",
      "Acesso das famílias incluído e sem limite",
    ],
  };
}
