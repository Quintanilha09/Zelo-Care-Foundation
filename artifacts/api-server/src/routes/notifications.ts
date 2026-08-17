import { getAuth } from "../lib/auth-types.ts";
/**
 * Notificações — ZELO. familyId do token JWT.
 */
import { Router } from "express";
import { eq, and, isNull } from "drizzle-orm";
import { db } from "@workspace/db";
import { notificationsTable, treatmentsTable } from "@workspace/db";
import { requireAuth } from "../middleware/require-auth";
import { Clock } from "../lib/clock";

const router = Router();

router.get("/notifications", requireAuth, async (req, res): Promise<void> => {
  const unreadOnly = req.query.unreadOnly === "true";
  const conditions = [eq(notificationsTable.familyId, getAuth(req).familyId)];
  if (unreadOnly) conditions.push(isNull(notificationsTable.ackedAt));

  const notifications = await db
    .select()
    .from(notificationsTable)
    .where(and(...conditions))
    .orderBy(notificationsTable.createdAt);

  res.json(notifications);
});

router.post("/notifications/:notificationId/ack", requireAuth, async (req, res): Promise<void> => {
  const notificationId = Number(req.params.notificationId);
  if (isNaN(notificationId)) { res.status(400).json({ error: "ID inválido" }); return; }

  const [updated] = await db
    .update(notificationsTable)
    .set({ ackedAt: Clock.now() })
    .where(and(eq(notificationsTable.id, notificationId), eq(notificationsTable.familyId, getAuth(req).familyId)))
    .returning();

  if (!updated) { res.status(404).json({ error: "Notificação não encontrada" }); return; }

  // ZELO-20: confirmar o lembrete de revisão de tratamento contínuo É a
  // revisão — reinicia a contagem de ~6 meses a partir de agora.
  if (updated.type === "continuous_review" && updated.treatmentId) {
    await db.update(treatmentsTable).set({ lastReviewedAt: Clock.now() }).where(eq(treatmentsTable.id, updated.treatmentId));
  }

  res.json(updated);
});

export default router;
