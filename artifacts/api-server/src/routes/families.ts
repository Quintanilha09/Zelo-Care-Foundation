import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db } from "@workspace/db";
import { familiesTable } from "@workspace/db";
import {
  CreateFamilyBody,
  GetFamilyParams,
} from "@workspace/api-zod";
import { safeLog } from "../lib/safe-logger";
import { audit } from "../lib/audit";

const router: IRouter = Router();

// Lista todas as famílias (futuro: restrito a admin)
router.get("/families", async (_req, res): Promise<void> => {
  const families = await db
    .select()
    .from(familiesTable)
    .orderBy(familiesTable.createdAt);
  res.json(families);
});

// Cria nova família/tenant
router.post("/families", async (req, res): Promise<void> => {
  const parsed = CreateFamilyBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [family] = await db
    .insert(familiesTable)
    .values(parsed.data)
    .returning();

  safeLog.info({ action: "created", entityType: "family" }, "Família criada");

  await audit({
    familyId: family.id,
    entityType: "family",
    entityId: String(family.id),
    action: "created",
    actorType: "system",
  });

  res.status(201).json(family);
});

// Busca família por ID
router.get("/families/:familyId", async (req, res): Promise<void> => {
  const params = GetFamilyParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [family] = await db
    .select()
    .from(familiesTable)
    .where(eq(familiesTable.id, params.data.familyId))
    .limit(1);

  if (!family) {
    res.status(404).json({ error: "Família não encontrada" });
    return;
  }

  res.json(family);
});

export default router;
