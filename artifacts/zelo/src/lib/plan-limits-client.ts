/**
 * Limites de plano no cliente — ZELO.
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

export interface PlanLimitsView {
  maxPatients: number | null;
  maxCaregivers: number | null;
  maxMedications: number | null;
  historyDays: number | null;
  appointments: boolean;
  stockLowAlert: boolean;
}

export interface PlanView {
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

/** Texto espelhado do servidor. Fica igual de propósito — quando a resposta
 *  403 chega de verdade, é a mensagem dela que aparece. */
export function patientLimitMessage(plan: PlanView | null | undefined): string {
  const max = plan?.limits.maxPatients ?? 1;
  return `O plano gratuito cuida de ${max} paciente. O plano Família libera até 5.`;
}

export function caregiverLimitMessage(): string {
  return "Cuidar junto é melhor. O plano Família libera cuidadores ilimitados.";
}

/** O que o plano Família entrega — mostrado na tela quente de limite, pra a
 *  pessoa entender o que ganha, não só o que não pode. */
export const FAMILY_PLAN_HIGHLIGHTS = [
  "Até 5 pacientes",
  "Cuidadores sem limite",
  "Medicamentos sem limite",
  "Histórico completo, sem corte de 7 dias",
  "Agenda de consultas e exames",
  "Aviso de estoque acabando",
];
