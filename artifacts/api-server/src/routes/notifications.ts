import { Router, type IRouter } from "express";
import { eq, and, isNull } from "drizzle-orm";
import { db } from "@workspace/db";
import { notificationsTable } from "@workspace/db";
import {
  ListNotificationsParams,
  ListNotificationsQueryParams,
} from "@workspace/api-zod";
import { Clock } from "../lib/clock";

const router: IRouter = Router();

router.get(
  "/families/:familyId/notifications",
  async (req, res): Promise<void> => {
    const params = ListNotificationsParams.safeParse(req.params);
    const query = ListNotificationsQueryParams.safeParse(req.query);
    if (!params.success || !query.success) {
      res.status(400).json({ error: "Parâmetros inválidos" });
      return;
    }

    const conditions = [
      eq(notificationsTable.familyId, params.data.familyId),
    ];
    if (query.data.unreadOnly) {
      conditions.push(isNull(notificationsTable.ackedAt));
    }

    const notifications = await db
      .select()
      .from(notificationsTable)
      .where(and(...conditions))
      .orderBy(notificationsTable.createdAt);

    res.json(notifications);
  }
);

// Marca notificação como tocada pelo usuário (ack)
router.post(
  "/families/:familyId/notifications/:notificationId/ack",
  async (req, res): Promise<void> => {
    const familyIdRaw = Array.isArray(req.params.familyId)
      ? req.params.familyId[0]
      : req.params.familyId;
    const notifIdRaw = Array.isArray(req.params.notificationId)
      ? req.params.notificationId[0]
      : req.params.notificationId;

    const familyId = parseInt(familyIdRaw, 10);
    const notificationId = parseInt(notifIdRaw, 10);

    if (isNaN(familyId) || isNaN(notificationId)) {
      res.status(400).json({ error: "IDs inválidos" });
      return;
    }

    const [updated] = await db
      .update(notificationsTable)
      .set({ ackedAt: Clock.now() })
      .where(
        and(
          eq(notificationsTable.id, notificationId),
          eq(notificationsTable.familyId, familyId)
        )
      )
      .returning();

    if (!updated) {
      res.status(404).json({ error: "Notificação não encontrada" });
      return;
    }

    res.json(updated);
  }
);

export default router;
