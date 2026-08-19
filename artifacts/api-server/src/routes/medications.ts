import { getAuth } from "../lib/auth-types.ts";
/**
 * Medicamentos — ZELO.
 * familyId vem do token JWT.
 * Nome e princípio ativo são CAMPOS SENSÍVEIS — nunca aparecem em logs.
 */
import { Router } from "express";
import { eq, and } from "drizzle-orm";
import { db } from "@workspace/db";
import { medicationsTable } from "@workspace/db";
import { z } from "zod";
import { requireAuth } from "../middleware/require-auth";
import { audit } from "../lib/audit";
import { checkMedicationLimit } from "../lib/plan-limits.ts";

const router = Router();

const CreateMedicationBody = z.object({
  name: z.string().min(1).max(200),
  activeIngredient: z.string().optional().nullable(),
  form: z.enum(["tablet", "capsule", "liquid", "injection", "patch", "drops", "inhaler", "other"]).optional(),
  strength: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

router.get("/medications", requireAuth, async (req, res): Promise<void> => {
  const meds = await db
    .select()
    .from(medicationsTable)
    .where(eq(medicationsTable.familyId, getAuth(req).familyId))
    .orderBy(medicationsTable.name);
  res.json(meds);
});

router.post("/medications", requireAuth, async (req, res): Promise<void> => {
  const body = CreateMedicationBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }

  const medicationLimit = await checkMedicationLimit(getAuth(req).familyId);
  if (!medicationLimit.allowed) {
    res.status(403).json({ error: medicationLimit.message, code: "PLAN_LIMIT" });
    return;
  }

  // Nota: nome do medicamento NÃO é logado (campo sensível)
  const [med] = await db
    .insert(medicationsTable)
    .values({ ...body.data, familyId: getAuth(req).familyId })
    .returning();

  await audit({
    familyId: getAuth(req).familyId,
    entityType: "medication",
    entityId: String(med.id),
    action: "created",
    actorId: String(getAuth(req).caregiverId),
    actorType: "caregiver",
  });

  res.status(201).json(med);
});

router.get("/medications/:medicationId", requireAuth, async (req, res): Promise<void> => {
  const medicationId = Number(req.params.medicationId);
  if (isNaN(medicationId)) { res.status(400).json({ error: "ID inválido" }); return; }

  const [med] = await db
    .select()
    .from(medicationsTable)
    .where(and(eq(medicationsTable.id, medicationId), eq(medicationsTable.familyId, getAuth(req).familyId)))
    .limit(1);

  if (!med) { res.status(404).json({ error: "Medicamento não encontrado" }); return; }
  res.json(med);
});

router.delete("/medications/:medicationId", requireAuth, async (req, res): Promise<void> => {
  const medicationId = Number(req.params.medicationId);
  if (isNaN(medicationId)) { res.status(400).json({ error: "ID inválido" }); return; }

  const [deleted] = await db
    .delete(medicationsTable)
    .where(and(eq(medicationsTable.id, medicationId), eq(medicationsTable.familyId, getAuth(req).familyId)))
    .returning({ id: medicationsTable.id });

  if (!deleted) { res.status(404).json({ error: "Medicamento não encontrado" }); return; }

  await audit({
    familyId: getAuth(req).familyId,
    entityType: "medication",
    entityId: String(medicationId),
    action: "deleted",
    actorId: String(getAuth(req).caregiverId),
    actorType: "caregiver",
  });

  res.status(204).send();
});

export default router;
