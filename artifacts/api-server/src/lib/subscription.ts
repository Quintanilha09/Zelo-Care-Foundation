/**
 * Plano da família — ZELO (ZELO-33).
 *
 * Primeira vez que o app checa plano de verdade. O sistema de limites e
 * paywall é a ZELO-39/E8 (Monetização) — este arquivo é só o helper de
 * leitura que ZELO-33 precisa pro limite de 7 dias do histórico, escrito
 * de um jeito que E8 reaproveita depois, não reinventa.
 *
 * Sem linha em `subscriptions` = gratuito (nenhuma rota cria essa linha
 * ainda no cadastro normal — só o seed de demonstração popula uma). Plano
 * pago com pagamento atrasado ou cancelado também conta como gratuito.
 */
import { getPlanTier } from "./plan-limits.ts";

/**
 * "A família paga por algum plano?" — pergunta binária, ainda usada onde
 * a distinção grátis/pago basta (limite de histórico da ZELO-33, paywall
 * duro do relatório da ZELO-35).
 *
 * ZELO-56: a resolução de qual plano está em vigor mudou de lugar e
 * virou `getPlanTier` (plan-limits.ts), que é a fonte única — com mais de
 * um tier pago, "é pago?" deixou de ser suficiente para decidir limite.
 * Este helper passou a derivar de lá em vez de reler a assinatura por
 * conta própria, pra não existirem duas leituras que possam divergir.
 */
export async function hasPaidAccess(familyId: number): Promise<boolean> {
  return (await getPlanTier(familyId)) !== "free";
}
