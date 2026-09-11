/**
 * Atalhos de estado para desenvolvimento e testes.
 *
 *   POST /api/dev/plano             troca o plano da PRÓPRIA família
 *   POST /api/dev/envelhecer-dose   empurra o `created_at` de um registro
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
import { eq, and } from "drizzle-orm";
import { db } from "@workspace/db";
import { subscriptionsTable, doseRecordsTable, patientsTable } from "@workspace/db";
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

const EnvelhecerBody = z.object({
  recordId: z.number().int().positive(),
  segundos: z.number().int().positive().max(86_400),
});

/**
 * POST /api/dev/envelhecer-dose  { recordId, segundos }
 *
 * ── Por que precisou existir — Issue #136 ────────────────────────────────
 *
 * O "Corrigir" só aparece **depois** que o prazo de desfazer vence (60 s).
 * Isso é o desenho certo: dentro do minuto o caminho é desfazer, e oferecer
 * os dois ao mesmo tempo faria a pessoa escolher entre "apagar" e "emendar"
 * sem ter por que decidir isso.
 *
 * Mas deixa o caminho **inalcançável por um teste de tela**: um registro
 * criado pela API tem segundos de idade, e esperar 60 s por caso, em dois
 * navegadores, custaria minutos de CI por execução. O CI já morreu uma vez
 * no teto de 20 min por causa disso.
 *
 * Então esta rota empurra o `created_at` para trás. É o mesmo desenho do
 * `dev/plano` logo acima, pelo mesmo motivo: um estado real do produto que
 * o teste não conseguiria montar de outro jeito.
 *
 * ── Os limites ───────────────────────────────────────────────────────────
 *
 * Só fora de produção (o router inteiro), só com sessão, e **só registro da
 * família de quem chamou** — o `familyId` vem do JWT. Um registro de outra
 * família responde 404, como manda o invariante 2.
 *
 * Mexe **só** no `created_at`, que é o carimbo de auditoria de quando a
 * linha entrou. Não encosta em `taken_at`, que é o dado clínico.
 */
router.post("/dev/envelhecer-dose", requireAuth, async (req, res): Promise<void> => {
  const body = EnvelhecerBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Informe recordId e segundos." });
    return;
  }

  const [registro] = await db
    .select({ id: doseRecordsTable.id, createdAt: doseRecordsTable.createdAt })
    .from(doseRecordsTable)
    .innerJoin(patientsTable, eq(patientsTable.id, doseRecordsTable.patientId))
    .where(
      and(
        eq(doseRecordsTable.id, body.data.recordId),
        eq(patientsTable.familyId, getAuth(req).familyId),
      ),
    )
    .limit(1);

  if (!registro) {
    res.status(404).json({ error: "Recurso não encontrado" });
    return;
  }

  const novo = new Date(registro.createdAt.getTime() - body.data.segundos * 1000);
  await db
    .update(doseRecordsTable)
    .set({ createdAt: novo })
    .where(eq(doseRecordsTable.id, registro.id));

  res.json({ ok: true, createdAt: novo.toISOString() });
});

export default router;
