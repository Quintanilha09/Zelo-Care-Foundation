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
import { eq } from "drizzle-orm";
import { db } from "@workspace/db";
import { subscriptionsTable } from "@workspace/db";

export async function hasPaidAccess(familyId: number): Promise<boolean> {
  const [sub] = await db
    .select({ plan: subscriptionsTable.plan, status: subscriptionsTable.status })
    .from(subscriptionsTable)
    .where(eq(subscriptionsTable.familyId, familyId))
    .limit(1);

  if (!sub) return false;
  if (sub.plan === "free") return false;
  return sub.status === "active" || sub.status === "trialing";
}
