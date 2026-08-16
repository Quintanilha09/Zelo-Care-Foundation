import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import { db } from "@workspace/db";
import { patientsTable } from "@workspace/db";
import {
  ListPatientsParams,
  CreatePatientParams,
  CreatePatientBody,
  GetPatientParams,
  UpdatePatientParams,
  UpdatePatientBody,
} from "@workspace/api-zod";
import { safeLog } from "../lib/safe-logger";
import { audit } from "../lib/audit";
import { Clock } from "../lib/clock";

const router: IRouter = Router();

// Todo acesso é isolado por familyId — dado de uma família nunca vaza para outra.

router.get(
  "/families/:familyId/patients",
  async (req, res): Promise<void> => {
    const params = ListPatientsParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const patients = await db
      .select()
      .from(patientsTable)
      .where(eq(patientsTable.familyId, params.data.familyId))
      .orderBy(patientsTable.name);
    res.json(patients);
  }
);

router.post(
  "/families/:familyId/patients",
  async (req, res): Promise<void> => {
    const params = CreatePatientParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const body = CreatePatientBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: body.error.message });
      return;
    }
    const insertData = {
      ...body.data,
      familyId: params.data.familyId,
      // birthDate vem do Zod como Date | null — converter para string para o driver pg
      birthDate: body.data.birthDate instanceof Date
        ? body.data.birthDate.toISOString().slice(0, 10)
        : (body.data.birthDate as string | null | undefined),
    };
    const [patient] = await db
      .insert(patientsTable)
      .values(insertData)
      .returning();

    safeLog.info(
      { action: "created", entityType: "patient", familyId: patient.familyId },
      "Paciente criado"
    );
    await audit({
      familyId: patient.familyId,
      entityType: "patient",
      entityId: String(patient.id),
      action: "created",
      actorType: "system",
    });

    res.status(201).json(patient);
  }
);

router.get(
  "/families/:familyId/patients/:patientId",
  async (req, res): Promise<void> => {
    const params = GetPatientParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const [patient] = await db
      .select()
      .from(patientsTable)
      .where(
        and(
          eq(patientsTable.id, params.data.patientId),
          eq(patientsTable.familyId, params.data.familyId)
        )
      )
      .limit(1);

    if (!patient) {
      // Retorna 404 (não 403) para não confirmar existência de recurso de outra família
      res.status(404).json({ error: "Paciente não encontrado" });
      return;
    }
    res.json(patient);
  }
);

router.patch(
  "/families/:familyId/patients/:patientId",
  async (req, res): Promise<void> => {
    const params = UpdatePatientParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const body = UpdatePatientBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: body.error.message });
      return;
    }

    const updateData = {
      ...body.data,
      updatedAt: Clock.now(),
      birthDate: body.data.birthDate instanceof Date
        ? body.data.birthDate.toISOString().slice(0, 10)
        : (body.data.birthDate as string | null | undefined),
    };
    const [updated] = await db
      .update(patientsTable)
      .set(updateData)
      .where(
        and(
          eq(patientsTable.id, params.data.patientId),
          eq(patientsTable.familyId, params.data.familyId)
        )
      )
      .returning();

    if (!updated) {
      res.status(404).json({ error: "Paciente não encontrado" });
      return;
    }

    safeLog.info(
      { action: "updated", entityType: "patient", familyId: updated.familyId },
      "Paciente atualizado"
    );

    res.json(updated);
  }
);

export default router;
