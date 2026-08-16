import { Router, type IRouter } from "express";
import { eq, and, gte, lte } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  doseRecordsTable,
  scheduledDosesTable,
  caregiversTable,
} from "@workspace/db";
import {
  ListDoseRecordsParams,
  ListDoseRecordsQueryParams,
  CreateDoseRecordParams,
  CreateDoseRecordBody,
} from "@workspace/api-zod";
import { safeLog } from "../lib/safe-logger";
import { verifyPatientBelongsToFamily } from "../lib/family-access";
import { audit } from "../lib/audit";
import { Clock } from "../lib/clock";

const router: IRouter = Router();

router.get(
  "/families/:familyId/patients/:patientId/dose-records",
  async (req, res): Promise<void> => {
    const params = ListDoseRecordsParams.safeParse(req.params);
    const query = ListDoseRecordsQueryParams.safeParse(req.query);
    if (!params.success || !query.success) {
      res.status(400).json({ error: "Parâmetros inválidos" });
      return;
    }

    const belongs = await verifyPatientBelongsToFamily(
      params.data.patientId,
      params.data.familyId
    );
    if (!belongs) {
      res.status(404).json({ error: "Paciente não encontrado" });
      return;
    }

    const conditions = [eq(doseRecordsTable.patientId, params.data.patientId)];
    if (query.data.from) {
      conditions.push(gte(doseRecordsTable.takenAt, new Date(query.data.from)));
    }
    if (query.data.to) {
      conditions.push(lte(doseRecordsTable.takenAt, new Date(query.data.to)));
    }

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
      .leftJoin(
        caregiversTable,
        eq(doseRecordsTable.caregiverId, caregiversTable.id)
      )
      .where(and(...conditions))
      .orderBy(doseRecordsTable.takenAt);

    res.json(records);
  }
);

// REGRA DE INTEGRIDADE CRÍTICA #2:
// O banco garante que só existe 1 registro por dose agendada (UNIQUE constraint).
// Se dois cuidadores tentarem registrar ao mesmo tempo, o segundo recebe 409.
router.post(
  "/families/:familyId/patients/:patientId/dose-records",
  async (req, res): Promise<void> => {
    const params = CreateDoseRecordParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const body = CreateDoseRecordBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: body.error.message });
      return;
    }

    const belongs = await verifyPatientBelongsToFamily(
      params.data.patientId,
      params.data.familyId
    );
    if (!belongs) {
      res.status(404).json({ error: "Paciente não encontrado" });
      return;
    }

    // Verifica que a dose agendada pertence ao paciente
    const [scheduled] = await db
      .select({ id: scheduledDosesTable.id, patientId: scheduledDosesTable.patientId })
      .from(scheduledDosesTable)
      .where(eq(scheduledDosesTable.id, body.data.scheduledDoseId))
      .limit(1);

    if (!scheduled || scheduled.patientId !== params.data.patientId) {
      res.status(404).json({ error: "Dose agendada não encontrada" });
      return;
    }

    try {
      const [record] = await db
        .insert(doseRecordsTable)
        .values({
          scheduledDoseId: body.data.scheduledDoseId,
          patientId: params.data.patientId,
          caregiverId: body.data.caregiverId,
          takenAt: new Date(body.data.takenAt),
          outcome: body.data.outcome as "taken" | "skipped",
          notes: body.data.notes ?? null,
        })
        .returning();

      // Atualiza status da dose agendada
      await db
        .update(scheduledDosesTable)
        .set({
          status: body.data.outcome === "taken" ? "taken" : "skipped",
          updatedAt: Clock.now(),
        })
        .where(eq(scheduledDosesTable.id, body.data.scheduledDoseId));

      safeLog.info(
        {
          action: "created",
          entityType: "dose_record",
          familyId: params.data.familyId,
          scheduledDoseId: record.scheduledDoseId,
          outcome: record.outcome,
        },
        "Dose registrada"
      );

      await audit({
        familyId: params.data.familyId,
        entityType: "dose_record",
        entityId: String(record.id),
        action: "created",
        actorId: String(body.data.caregiverId),
        actorType: "caregiver",
      });

      res.status(201).json(record);
    } catch (err: unknown) {
      // Constraint unique violada — dose já foi registrada
      const pgErr = err as { code?: string };
      if (pgErr?.code === "23505") {
        res.status(409).json({ error: "Dose já registrada para esse horário agendado" });
        return;
      }
      throw err;
    }
  }
);

export default router;
