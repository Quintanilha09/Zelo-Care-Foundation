import { getAuth } from "../lib/auth-types.ts";
/**
 * Atividades de rotina — ZELO (ZELO-37).
 *
 * Registro simples de feito/não-feito (fisioterapia, banho, alimentação,
 * caminhada) — sem meta, sem streak, sem cobrança. "Rotina", não
 * "desempenho": nenhuma consequência quando `done: false`, é só o retrato
 * do dia, igual toda outra tela neutra do produto.
 */
import { Router } from "express";
import { eq, and, desc } from "drizzle-orm";
import { z } from "zod";
import { db } from "@workspace/db";
import { activitiesTable, patientsTable, activityTypeEnum } from "@workspace/db";
import { requireAuth } from "../middleware/require-auth";
import { audit } from "../lib/audit";

const router = Router();

const ACTIVITY_TYPES = activityTypeEnum.enumValues;

const ActivityBody = z.object({
  type: z.enum(ACTIVITY_TYPES),
  occurredAt: z.string(),
  done: z.boolean().default(true),
  notes: z.string().max(2000).optional().nullable(),
});

async function loadPatient(patientId: number, familyId: number) {
  const [patient] = await db
    .select({ id: patientsTable.id })
    .from(patientsTable)
    .where(and(eq(patientsTable.id, patientId), eq(patientsTable.familyId, familyId)))
    .limit(1);
  return patient ?? null;
}

router.get("/patients/:patientId/activities", requireAuth, async (req, res): Promise<void> => {
  const patientId = Number(req.params.patientId);
  if (isNaN(patientId)) { res.status(400).json({ error: "ID inválido" }); return; }

  const patient = await loadPatient(patientId, getAuth(req).familyId);
  if (!patient) { res.status(404).json({ error: "Paciente não encontrado" }); return; }

  const rows = await db
    .select()
    .from(activitiesTable)
    .where(eq(activitiesTable.patientId, patientId))
    .orderBy(desc(activitiesTable.occurredAt));

  res.json(rows);
});

router.post("/patients/:patientId/activities", requireAuth, async (req, res): Promise<void> => {
  const patientId = Number(req.params.patientId);
  if (isNaN(patientId)) { res.status(400).json({ error: "ID inválido" }); return; }

  const patient = await loadPatient(patientId, getAuth(req).familyId);
  if (!patient) { res.status(404).json({ error: "Paciente não encontrado" }); return; }

  const body = ActivityBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }

  const [activity] = await db.insert(activitiesTable).values({
    patientId, type: body.data.type, occurredAt: new Date(body.data.occurredAt),
    done: body.data.done, notes: body.data.notes, caregiverId: getAuth(req).caregiverId,
  }).returning();

  await audit({
    familyId: getAuth(req).familyId, entityType: "activity", entityId: String(activity.id),
    action: "created", actorId: String(getAuth(req).caregiverId), actorType: "caregiver",
  });

  res.status(201).json(activity);
});

router.delete("/patients/:patientId/activities/:activityId", requireAuth, async (req, res): Promise<void> => {
  const patientId = Number(req.params.patientId);
  const activityId = Number(req.params.activityId);
  if (isNaN(patientId) || isNaN(activityId)) { res.status(400).json({ error: "ID inválido" }); return; }

  const patient = await loadPatient(patientId, getAuth(req).familyId);
  if (!patient) { res.status(404).json({ error: "Paciente não encontrado" }); return; }

  const [deleted] = await db
    .delete(activitiesTable)
    .where(and(eq(activitiesTable.id, activityId), eq(activitiesTable.patientId, patientId)))
    .returning({ id: activitiesTable.id });

  if (!deleted) { res.status(404).json({ error: "Atividade não encontrada" }); return; }

  await audit({
    familyId: getAuth(req).familyId, entityType: "activity", entityId: String(activityId),
    action: "deleted", actorId: String(getAuth(req).caregiverId), actorType: "caregiver",
  });

  res.status(204).send();
});

export default router;
