import { getAuth } from "../lib/auth-types.ts";
/**
 * Aferições de saúde — ZELO (ZELO-37).
 *
 * "Esta é a story onde é mais fácil cruzar a linha do dispositivo médico —
 * e a fronteira precisa estar explícita no código e na interface." Este
 * router é estruturalmente incapaz de reagir a um valor: não há nenhuma
 * comparação de `value` contra faixa nenhuma em lugar nenhum daqui, nenhum
 * cálculo derivado, nenhum disparo de notificação/alerta. `value` é sempre
 * texto bruto ("120/80", "98.6") — nunca convertido pra número, guardado
 * ou comparado. Registrar é o único efeito colateral desta rota.
 *
 * Se o cuidador achar algo preocupante, ele escreve na observação — a ação
 * do app (fora desta rota, ver PatientDetailPage) é oferecer o contato de
 * emergência já cadastrado. Encaminhar, nunca avaliar.
 */
import { Router } from "express";
import { eq, and, desc } from "drizzle-orm";
import { z } from "zod";
import { db } from "@workspace/db";
import { healthMeasurementsTable, patientsTable, measurementTypeEnum } from "@workspace/db";
import { requireAuth } from "../middleware/require-auth";
import { audit } from "../lib/audit";

const router = Router();

const MEASUREMENT_TYPES = measurementTypeEnum.enumValues;

const MeasurementBody = z.object({
  type: z.enum(MEASUREMENT_TYPES),
  value: z.string().min(1).max(50),
  unit: z.string().max(20).optional().nullable(),
  measuredAt: z.string(), // ISO — instante exato de quando foi aferido
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

router.get("/patients/:patientId/health-measurements", requireAuth, async (req, res): Promise<void> => {
  const patientId = Number(req.params.patientId);
  if (isNaN(patientId)) { res.status(400).json({ error: "ID inválido" }); return; }

  const patient = await loadPatient(patientId, getAuth(req).familyId);
  if (!patient) { res.status(404).json({ error: "Paciente não encontrado" }); return; }

  const query = z.object({ type: z.enum(MEASUREMENT_TYPES).optional() }).safeParse(req.query);
  const typeFilter = query.success ? query.data.type : undefined;

  const rows = await db
    .select()
    .from(healthMeasurementsTable)
    .where(and(
      eq(healthMeasurementsTable.patientId, patientId),
      typeFilter ? eq(healthMeasurementsTable.type, typeFilter) : undefined
    ))
    .orderBy(desc(healthMeasurementsTable.measuredAt));

  res.json(rows);
});

router.post("/patients/:patientId/health-measurements", requireAuth, async (req, res): Promise<void> => {
  const patientId = Number(req.params.patientId);
  if (isNaN(patientId)) { res.status(400).json({ error: "ID inválido" }); return; }

  const patient = await loadPatient(patientId, getAuth(req).familyId);
  if (!patient) { res.status(404).json({ error: "Paciente não encontrado" }); return; }

  const body = MeasurementBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }

  const [measurement] = await db.insert(healthMeasurementsTable).values({
    patientId, type: body.data.type, value: body.data.value, unit: body.data.unit,
    measuredAt: new Date(body.data.measuredAt), notes: body.data.notes,
    caregiverId: getAuth(req).caregiverId,
  }).returning();

  await audit({
    familyId: getAuth(req).familyId, entityType: "health_measurement", entityId: String(measurement.id),
    action: "created", actorId: String(getAuth(req).caregiverId), actorType: "caregiver",
  });

  res.status(201).json(measurement);
});

router.delete("/patients/:patientId/health-measurements/:measurementId", requireAuth, async (req, res): Promise<void> => {
  const patientId = Number(req.params.patientId);
  const measurementId = Number(req.params.measurementId);
  if (isNaN(patientId) || isNaN(measurementId)) { res.status(400).json({ error: "ID inválido" }); return; }

  const patient = await loadPatient(patientId, getAuth(req).familyId);
  if (!patient) { res.status(404).json({ error: "Paciente não encontrado" }); return; }

  const [deleted] = await db
    .delete(healthMeasurementsTable)
    .where(and(eq(healthMeasurementsTable.id, measurementId), eq(healthMeasurementsTable.patientId, patientId)))
    .returning({ id: healthMeasurementsTable.id });

  if (!deleted) { res.status(404).json({ error: "Aferição não encontrada" }); return; }

  await audit({
    familyId: getAuth(req).familyId, entityType: "health_measurement", entityId: String(measurementId),
    action: "deleted", actorId: String(getAuth(req).caregiverId), actorType: "caregiver",
  });

  res.status(204).send();
});

export default router;
