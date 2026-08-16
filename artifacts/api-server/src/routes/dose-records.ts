import { getAuth } from "../lib/auth-types.ts";
/**
 * Registros de dose — ZELO.
 * familyId vem do token JWT. Constraint UNIQUE(scheduled_dose_id) retorna 409.
 */
import { Router } from "express";
import { eq, and, gte, lte } from "drizzle-orm";
import { db } from "@workspace/db";
import { doseRecordsTable, scheduledDosesTable, caregiversTable, patientsTable } from "@workspace/db";
import { z } from "zod";
import { requireAuth } from "../middleware/require-auth";
import { safeLog } from "../lib/safe-logger";
import { audit } from "../lib/audit";
import { Clock } from "../lib/clock";

const router = Router();

const ListQuery = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
});

const CreateDoseRecordBody = z.object({
  scheduledDoseId: z.number().int().positive(),
  // patientId vem de req.params — não aceitar do body evita confusão
  takenAt: z.string(),
  outcome: z.enum(["taken", "skipped"]),
  notes: z.string().optional().nullable(),
});

// ── Listar registros de dose de um paciente ───────────────────────────────

router.get("/patients/:patientId/dose-records", requireAuth, async (req, res): Promise<void> => {
  const patientId = Number(req.params.patientId);
  if (isNaN(patientId)) { res.status(400).json({ error: "ID inválido" }); return; }

  // Verifica isolamento: paciente pertence à família do token
  const [patient] = await db
    .select({ id: patientsTable.id })
    .from(patientsTable)
    .where(and(eq(patientsTable.id, patientId), eq(patientsTable.familyId, getAuth(req).familyId)))
    .limit(1);
  if (!patient) { res.status(404).json({ error: "Paciente não encontrado" }); return; }

  const query = ListQuery.safeParse(req.query);
  const conditions = [eq(doseRecordsTable.patientId, patientId)];
  if (query.success && query.data.from) conditions.push(gte(doseRecordsTable.takenAt, new Date(query.data.from)));
  if (query.success && query.data.to) conditions.push(lte(doseRecordsTable.takenAt, new Date(query.data.to)));

  const records = await db
    .select({
      id: doseRecordsTable.id,
      scheduledDoseId: doseRecordsTable.scheduledDoseId,
      patientId: doseRecordsTable.patientId,
      caregiverId: doseRecordsTable.caregiverId,
      caregiverName: caregiversTable.name,
      takenAt: doseRecordsTable.takenAt,
      outcome: doseRecordsTable.outcome,
      notes: doseRecordsTable.notes,
      createdAt: doseRecordsTable.createdAt,
    })
    .from(doseRecordsTable)
    .leftJoin(caregiversTable, eq(doseRecordsTable.caregiverId, caregiversTable.id))
    .where(and(...conditions))
    .orderBy(doseRecordsTable.takenAt);

  res.json(records);
});

// ── Registrar dose ────────────────────────────────────────────────────────

router.post("/patients/:patientId/dose-records", requireAuth, async (req, res): Promise<void> => {
  const patientId = Number(req.params.patientId);
  if (isNaN(patientId)) { res.status(400).json({ error: "ID inválido" }); return; }

  const body = CreateDoseRecordBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }

  // Verifica isolamento
  const [patient] = await db
    .select({ id: patientsTable.id })
    .from(patientsTable)
    .where(and(eq(patientsTable.id, patientId), eq(patientsTable.familyId, getAuth(req).familyId)))
    .limit(1);
  if (!patient) { res.status(404).json({ error: "Paciente não encontrado" }); return; }

  // Verifica que a dose agendada pertence ao paciente
  const [scheduled] = await db
    .select({ id: scheduledDosesTable.id, patientId: scheduledDosesTable.patientId })
    .from(scheduledDosesTable)
    .where(eq(scheduledDosesTable.id, body.data.scheduledDoseId))
    .limit(1);

  if (!scheduled || scheduled.patientId !== patientId) {
    res.status(404).json({ error: "Dose agendada não encontrada" });
    return;
  }

  try {
    const [record] = await db
      .insert(doseRecordsTable)
      .values({
        scheduledDoseId: body.data.scheduledDoseId,
        patientId,
        caregiverId: getAuth(req).caregiverId,
        takenAt: new Date(body.data.takenAt),
        outcome: body.data.outcome,
        notes: body.data.notes ?? null,
      })
      .returning();

    await db
      .update(scheduledDosesTable)
      .set({ status: body.data.outcome === "taken" ? "taken" : "skipped", updatedAt: Clock.now() })
      .where(eq(scheduledDosesTable.id, body.data.scheduledDoseId));

    safeLog.info({
      action: "created", entityType: "dose_record",
      familyId: getAuth(req).familyId,
      scheduledDoseId: record.scheduledDoseId,
      outcome: record.outcome,
    }, "Dose registrada");

    await audit({
      familyId: getAuth(req).familyId,
      entityType: "dose_record",
      entityId: String(record.id),
      action: "created",
      actorId: String(getAuth(req).caregiverId),
      actorType: "caregiver",
      ipAddress: req.ip,
    });

    res.status(201).json(record);
  } catch (err: unknown) {
    const pgErr = err as { code?: string; cause?: { code?: string } };
    if (pgErr?.code === "23505" || pgErr?.cause?.code === "23505") {
      res.status(409).json({ error: "Dose já registrada para esse horário agendado" });
      return;
    }
    throw err;
  }
});

export default router;
