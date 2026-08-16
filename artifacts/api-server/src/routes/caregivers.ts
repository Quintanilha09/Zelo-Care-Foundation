import { getAuth } from "../lib/auth-types.ts";
/**
 * Cuidadores — ZELO.
 * familyId vem do token JWT.
 */
import { Router } from "express";
import { eq, and } from "drizzle-orm";
import { db } from "@workspace/db";
import { caregiversTable } from "@workspace/db";
import { z } from "zod";
import { requireAuth, requirePrimaryCaregiver } from "../middleware/require-auth";
import { audit } from "../lib/audit";
import { Clock } from "../lib/clock";

const router = Router();

const UpdateCaregiverBody = z.object({
  name: z.string().min(2).max(100).optional(),
  role: z.enum(["caregiver", "hired_caregiver", "observer"]).optional(),
});

router.get("/caregivers", requireAuth, async (req, res): Promise<void> => {
  const caregivers = await db
    .select()
    .from(caregiversTable)
    .where(eq(caregiversTable.familyId, getAuth(req).familyId))
    .orderBy(caregiversTable.name);
  res.json(caregivers);
});

router.get("/caregivers/:caregiverId", requireAuth, async (req, res): Promise<void> => {
  const caregiverId = Number(req.params.caregiverId);
  if (isNaN(caregiverId)) { res.status(400).json({ error: "ID inválido" }); return; }

  const [caregiver] = await db
    .select()
    .from(caregiversTable)
    .where(and(eq(caregiversTable.id, caregiverId), eq(caregiversTable.familyId, getAuth(req).familyId)))
    .limit(1);

  if (!caregiver) { res.status(404).json({ error: "Cuidador não encontrado" }); return; }
  res.json(caregiver);
});

router.patch("/caregivers/:caregiverId", requirePrimaryCaregiver, async (req, res): Promise<void> => {
  const caregiverId = Number(req.params.caregiverId);
  if (isNaN(caregiverId)) { res.status(400).json({ error: "ID inválido" }); return; }

  const body = UpdateCaregiverBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }

  const [before] = await db
    .select({ role: caregiversTable.role })
    .from(caregiversTable)
    .where(and(eq(caregiversTable.id, caregiverId), eq(caregiversTable.familyId, getAuth(req).familyId)))
    .limit(1);

  if (!before) { res.status(404).json({ error: "Cuidador não encontrado" }); return; }

  const [updated] = await db
    .update(caregiversTable)
    .set({ ...body.data, updatedAt: Clock.now() })
    .where(and(eq(caregiversTable.id, caregiverId), eq(caregiversTable.familyId, getAuth(req).familyId)))
    .returning();

  if (body.data.role && body.data.role !== before.role) {
    await audit({
      familyId: getAuth(req).familyId,
      entityType: "caregiver",
      entityId: String(caregiverId),
      action: "updated",
      actorId: String(getAuth(req).caregiverId),
      actorType: "caregiver",
      diff: JSON.stringify({ before: { role: before.role }, after: { role: body.data.role } }),
    });
  }

  res.json(updated);
});

router.delete("/caregivers/:caregiverId", requirePrimaryCaregiver, async (req, res): Promise<void> => {
  const caregiverId = Number(req.params.caregiverId);
  if (isNaN(caregiverId)) { res.status(400).json({ error: "ID inválido" }); return; }

  // Não pode remover o próprio cuidador principal
  if (caregiverId === getAuth(req).caregiverId) {
    res.status(400).json({ error: "Você não pode remover sua própria conta de cuidador" });
    return;
  }

  const [deleted] = await db
    .delete(caregiversTable)
    .where(and(eq(caregiversTable.id, caregiverId), eq(caregiversTable.familyId, getAuth(req).familyId)))
    .returning({ id: caregiversTable.id });

  if (!deleted) { res.status(404).json({ error: "Cuidador não encontrado" }); return; }

  await audit({
    familyId: getAuth(req).familyId,
    entityType: "caregiver",
    entityId: String(caregiverId),
    action: "deleted",
    actorId: String(getAuth(req).caregiverId),
    actorType: "caregiver",
  });

  res.status(204).send();
});

export default router;
