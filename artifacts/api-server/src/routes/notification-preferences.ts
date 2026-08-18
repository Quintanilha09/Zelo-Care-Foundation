import { getAuth } from "../lib/auth-types.ts";
/**
 * Preferências de notificação por paciente — ZELO (ZELO-26).
 *
 * Padrão é tudo ativado. Só existe linha no banco quando o cuidador
 * desliga uma categoria explicitamente — ver notification-preferences.ts
 * no pacote de schema.
 */
import { Router } from "express";
import { eq, and } from "drizzle-orm";
import { z } from "zod";
import { db } from "@workspace/db";
import { notificationPreferencesTable, notificationCategoryEnum } from "@workspace/db";
import { requireAuth } from "../middleware/require-auth";
import { verifyPatientBelongsToFamily } from "../lib/family-access.ts";
import { Clock } from "../lib/clock.ts";

const router = Router();

const CATEGORIES = notificationCategoryEnum.enumValues;

const UpdateBody = z.object({
  category: z.enum(CATEGORIES),
  enabled: z.boolean(),
});

router.get("/patients/:patientId/notification-preferences", requireAuth, async (req, res): Promise<void> => {
  const patientId = Number(req.params.patientId);
  if (isNaN(patientId)) { res.status(400).json({ error: "ID inválido" }); return; }

  const { familyId, caregiverId } = getAuth(req);
  const belongs = await verifyPatientBelongsToFamily(patientId, familyId);
  if (!belongs) { res.status(404).json({ error: "Paciente não encontrado" }); return; }

  const rows = await db
    .select({ category: notificationPreferencesTable.category, enabled: notificationPreferencesTable.enabled })
    .from(notificationPreferencesTable)
    .where(and(eq(notificationPreferencesTable.caregiverId, caregiverId), eq(notificationPreferencesTable.patientId, patientId)));

  const overrides = new Map(rows.map((r) => [r.category, r.enabled]));
  const preferences = CATEGORIES.map((category) => ({
    category,
    enabled: overrides.get(category) ?? true,
  }));

  res.json({ preferences });
});

router.patch("/patients/:patientId/notification-preferences", requireAuth, async (req, res): Promise<void> => {
  const patientId = Number(req.params.patientId);
  if (isNaN(patientId)) { res.status(400).json({ error: "ID inválido" }); return; }

  const parsed = UpdateBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Corpo inválido", details: parsed.error.issues }); return; }

  const { familyId, caregiverId } = getAuth(req);
  const belongs = await verifyPatientBelongsToFamily(patientId, familyId);
  if (!belongs) { res.status(404).json({ error: "Paciente não encontrado" }); return; }

  const { category, enabled } = parsed.data;
  await db
    .insert(notificationPreferencesTable)
    .values({ caregiverId, patientId, category, enabled })
    .onConflictDoUpdate({
      target: [notificationPreferencesTable.caregiverId, notificationPreferencesTable.patientId, notificationPreferencesTable.category],
      set: { enabled, updatedAt: Clock.now() },
    });

  res.json({ category, enabled });
});

export default router;
