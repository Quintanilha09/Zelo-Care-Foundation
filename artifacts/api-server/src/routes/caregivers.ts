import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import { db } from "@workspace/db";
import { caregiversTable } from "@workspace/db";
import {
  ListCaregiversParams,
  CreateCaregiverParams,
  CreateCaregiverBody,
  GetCaregiverParams,
  UpdateCaregiverParams,
  UpdateCaregiverBody,
} from "@workspace/api-zod";
import { Clock } from "../lib/clock";

const router: IRouter = Router();

router.get(
  "/families/:familyId/caregivers",
  async (req, res): Promise<void> => {
    const params = ListCaregiversParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const caregivers = await db
      .select()
      .from(caregiversTable)
      .where(eq(caregiversTable.familyId, params.data.familyId))
      .orderBy(caregiversTable.name);
    res.json(caregivers);
  }
);

router.post(
  "/families/:familyId/caregivers",
  async (req, res): Promise<void> => {
    const params = CreateCaregiverParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const body = CreateCaregiverBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: body.error.message });
      return;
    }
    const [caregiver] = await db
      .insert(caregiversTable)
      .values({ ...body.data, familyId: params.data.familyId })
      .returning();
    res.status(201).json(caregiver);
  }
);

router.get(
  "/families/:familyId/caregivers/:caregiverId",
  async (req, res): Promise<void> => {
    const params = GetCaregiverParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const [caregiver] = await db
      .select()
      .from(caregiversTable)
      .where(
        and(
          eq(caregiversTable.id, params.data.caregiverId),
          eq(caregiversTable.familyId, params.data.familyId)
        )
      )
      .limit(1);
    if (!caregiver) {
      res.status(404).json({ error: "Cuidador não encontrado" });
      return;
    }
    res.json(caregiver);
  }
);

router.patch(
  "/families/:familyId/caregivers/:caregiverId",
  async (req, res): Promise<void> => {
    const params = UpdateCaregiverParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const body = UpdateCaregiverBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: body.error.message });
      return;
    }
    const [updated] = await db
      .update(caregiversTable)
      .set({ ...body.data, updatedAt: Clock.now() })
      .where(
        and(
          eq(caregiversTable.id, params.data.caregiverId),
          eq(caregiversTable.familyId, params.data.familyId)
        )
      )
      .returning();
    if (!updated) {
      res.status(404).json({ error: "Cuidador não encontrado" });
      return;
    }
    res.json(updated);
  }
);

export default router;
