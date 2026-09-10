/**
 * Troca o plano da PRÓPRIA família — desenvolvimento e testes apenas.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * PROTEÇÃO DE PRODUÇÃO
 *
 * Este módulo é registrado no router **apenas** quando
 * `allowsDevelopmentShortcuts()` é verdadeiro — mesma porta do `dev-clock.ts`,
 * e pelo mesmo motivo escrito lá: `NODE_ENV !== "production"` monta a rota
 * quando a variável simplesmente não existe, que era o caso do deploy.
 *
 * Em produção as rotas nunca chegam a existir. **Não** acrescente aqui um
 * `if (produção) return 404` — o isolamento certo é não registrar.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * ── Por que ela precisou existir ─────────────────────────────────────────
 *
 * O plano Grátis cuida de **um** paciente (`lib/plan-limits.ts`). Isso deixava
 * uma família inteira de comportamento sem como ser testada pela tela: filtro
 * de paciente descoberto, lista com vários, qualquer coisa que só apareça a
 * partir do segundo paciente. Todo spec de `e2e/` criava exatamente um, e não
 * por escolha — era o teto.
 *
 * Descoberto pelo CI na Issue #122, com o 403 de `PLAN_LIMIT` no lugar do 201.
 *
 * ── E por que ela tem `requireAuth`, diferente do dev-clock ──────────────
 *
 * As rotas de relógio não têm dono: mexem no processo inteiro. Esta mexe num
 * registro de uma família, então o alvo vem do **JWT** e de nenhum outro
 * lugar — `familyId` de corpo ou URL é exatamente o que o invariante 2 proíbe,
 * e um atalho de teste não é motivo para abrir exceção nele.
 */

import { Router } from "express";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@workspace/db";
import { subscriptionsTable } from "@workspace/db";
import { requireAuth } from "../middleware/require-auth";
import { getAuth } from "../lib/auth-types.ts";

const router = Router();

const TrocarPlanoBody = z.object({
  plano: z.enum(["free", "basic", "premium", "professional"]),
});

/**
 * POST /api/dev/plano  { plano: "professional" }
 *
 * Só a família de quem chamou. `UNIQUE(family_id)` na tabela garante uma
 * assinatura por família, então isto é um upsert em cima dessa restrição.
 */
router.post("/dev/plano", requireAuth, async (req, res): Promise<void> => {
  const body = TrocarPlanoBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "plano deve ser free, basic, premium ou professional" });
    return;
  }

  const familyId = getAuth(req).familyId;

  await db
    .insert(subscriptionsTable)
    .values({ familyId, plan: body.data.plano, status: "active" })
    .onConflictDoUpdate({
      target: subscriptionsTable.familyId,
      set: { plan: body.data.plano, status: "active" },
    });

  const [assinatura] = await db
    .select({ plan: subscriptionsTable.plan, status: subscriptionsTable.status })
    .from(subscriptionsTable)
    .where(eq(subscriptionsTable.familyId, familyId))
    .limit(1);

  res.json({ ok: true, plano: assinatura?.plan, status: assinatura?.status });
});

export default router;
