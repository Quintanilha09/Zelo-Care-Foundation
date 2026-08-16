import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import { db } from "@workspace/db";
import { medicationsTable } from "@workspace/db";
import {
  ListMedicationsParams,
  CreateMedicationParams,
  CreateMedicationBody,
  GetMedicationParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

// Medicamentos: nome e ingrediente ativo são campos SENSÍVEIS — nunca aparecem em logs.

router.get(
  "/families/:familyId/medications",
  async (req, res): Promise<void> => {
    const params = ListMedicationsParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const meds = await db
      .select()
      .from(medicationsTable)
      .where(eq(medicationsTable.familyId, params.data.familyId))
      .orderBy(medicationsTable.name);
    res.json(meds);
  }
);

router.post(
  "/families/:familyId/medications",
  async (req, res): Promise<void> => {
    const params = CreateMedicationParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const body = CreateMedicationBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: body.error.message });
      return;
    }
    // Não logamos body.data.name — é campo sensível
    const [med] = await db
      .insert(medicationsTable)
      .values({ ...body.data, familyId: params.data.familyId })
      .returning();
    res.status(201).json(med);
  }
);

router.get(
  "/families/:familyId/medications/:medicationId",
  async (req, res): Promise<void> => {
    const params = GetMedicationParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const [med] = await db
      .select()
      .from(medicationsTable)
      .where(
        and(
          eq(medicationsTable.id, params.data.medicationId),
          eq(medicationsTable.familyId, params.data.familyId)
        )
      )
      .limit(1);
    if (!med) {
      res.status(404).json({ error: "Medicamento não encontrado" });
      return;
    }
    res.json(med);
  }
);

export default router;
