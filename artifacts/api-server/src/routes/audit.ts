import { getAuth } from "../lib/auth-types.ts";
/**
 * Audit log — ZELO. Somente leitura. familyId do token JWT.
 */
import { Router } from "express";
import { eq, and, gte, lte, desc } from "drizzle-orm";
import { db } from "@workspace/db";
import { auditLogTable } from "@workspace/db";
import { z } from "zod";
import { requireAuth } from "../middleware/require-auth";

const router = Router();

const AuditQuery = z.object({
  entityType: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

router.get("/audit-log", requireAuth, async (req, res): Promise<void> => {
  const query = AuditQuery.safeParse(req.query);
  if (!query.success) { res.status(400).json({ error: query.error.message }); return; }

  const conditions = [eq(auditLogTable.familyId, getAuth(req).familyId)];
  if (query.data.entityType) conditions.push(eq(auditLogTable.entityType, query.data.entityType));
  if (query.data.from) conditions.push(gte(auditLogTable.createdAt, new Date(query.data.from)));
  if (query.data.to) conditions.push(lte(auditLogTable.createdAt, new Date(query.data.to)));

  const entries = await db
    .select()
    .from(auditLogTable)
    .where(and(...conditions))
    .orderBy(desc(auditLogTable.createdAt))
    .limit(query.data.limit);

  res.json(entries);
});

export default router;
