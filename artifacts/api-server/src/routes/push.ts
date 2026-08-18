import { getAuth } from "../lib/auth-types.ts";
/**
 * Assinaturas de Web Push — ZELO (ZELO-26).
 *
 * Escopo desta história: só o canal (assinar, listar, desativar, testar) —
 * nenhum lembrete de dose é disparado automaticamente ainda (isso é
 * ZELO-27). O botão de teste em /ajustes é o único jeito de receber um
 * push nesta fase.
 */
import { Router } from "express";
import { eq, and } from "drizzle-orm";
import { z } from "zod";
import { db } from "@workspace/db";
import { pushSubscriptionsTable } from "@workspace/db";
import { requireAuth } from "../middleware/require-auth";
import { getVapidPublicKey, sendPushToUser, sendPushToSubscription } from "../lib/push.ts";
import { Clock } from "../lib/clock.ts";

const router = Router();

const SubscribeBody = z.object({
  endpoint: z.string().min(1),
  keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }),
  deviceLabel: z.string().optional().nullable(),
});

const UnsubscribeBody = z.object({ endpoint: z.string().min(1) });

const TestBody = z.object({ subscriptionId: z.number().int().positive().optional() });

const AckBody = z.object({ endpoint: z.string().min(1) });

router.get("/push/vapid-public-key", requireAuth, (_req, res): void => {
  const publicKey = getVapidPublicKey();
  if (!publicKey) { res.status(503).json({ error: "Web Push não configurado neste ambiente (VAPID_PUBLIC_KEY ausente)" }); return; }
  res.json({ publicKey });
});

router.post("/push/subscribe", requireAuth, async (req, res): Promise<void> => {
  const parsed = SubscribeBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Corpo inválido", details: parsed.error.issues }); return; }
  const { userId, familyId } = getAuth(req);
  const { endpoint, keys, deviceLabel } = parsed.data;

  const [subscription] = await db
    .insert(pushSubscriptionsTable)
    .values({ userId, familyId, endpoint, p256dh: keys.p256dh, auth: keys.auth, deviceLabel, active: true, failureCount: 0 })
    .onConflictDoUpdate({
      target: [pushSubscriptionsTable.userId, pushSubscriptionsTable.endpoint],
      set: { p256dh: keys.p256dh, auth: keys.auth, deviceLabel, active: true, failureCount: 0, updatedAt: Clock.now() },
    })
    .returning({ id: pushSubscriptionsTable.id, deviceLabel: pushSubscriptionsTable.deviceLabel, active: pushSubscriptionsTable.active, createdAt: pushSubscriptionsTable.createdAt });

  res.json(subscription);
});

router.delete("/push/subscribe", requireAuth, async (req, res): Promise<void> => {
  const parsed = UnsubscribeBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Corpo inválido" }); return; }
  const { userId } = getAuth(req);

  await db
    .delete(pushSubscriptionsTable)
    .where(and(eq(pushSubscriptionsTable.userId, userId), eq(pushSubscriptionsTable.endpoint, parsed.data.endpoint)));

  res.status(204).send();
});

router.get("/push/subscriptions", requireAuth, async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  const subscriptions = await db
    .select({
      id: pushSubscriptionsTable.id,
      // endpoint não é sensível (é só a URL do serviço de push, não uma
      // credencial) — o cliente precisa dele pra saber se ESTE navegador já
      // está na lista. p256dh/auth (as chaves de criptografia) nunca saem daqui.
      endpoint: pushSubscriptionsTable.endpoint,
      deviceLabel: pushSubscriptionsTable.deviceLabel,
      active: pushSubscriptionsTable.active,
      lastDeliveredAt: pushSubscriptionsTable.lastDeliveredAt,
      failureCount: pushSubscriptionsTable.failureCount,
      createdAt: pushSubscriptionsTable.createdAt,
    })
    .from(pushSubscriptionsTable)
    .where(eq(pushSubscriptionsTable.userId, userId))
    .orderBy(pushSubscriptionsTable.createdAt);
  res.json(subscriptions);
});

router.post("/push/test", requireAuth, async (req, res): Promise<void> => {
  const parsed = TestBody.safeParse(req.body ?? {});
  if (!parsed.success) { res.status(400).json({ error: "Corpo inválido" }); return; }
  const { userId } = getAuth(req);

  const payload = {
    title: "ZELO",
    body: "Notificação de teste — se você está vendo isso, seus lembretes vão funcionar.",
    tag: "test",
  };

  if (parsed.data.subscriptionId) {
    const [subscription] = await db
      .select()
      .from(pushSubscriptionsTable)
      .where(and(eq(pushSubscriptionsTable.id, parsed.data.subscriptionId), eq(pushSubscriptionsTable.userId, userId)))
      .limit(1);
    if (!subscription) { res.status(404).json({ error: "Assinatura não encontrada" }); return; }
    const result = await sendPushToSubscription(subscription, payload);
    res.json({ sent: result.ok ? 1 : 0, expired: result.ok === false && result.reason === "expired" ? 1 : 0, failed: result.ok === false && result.reason !== "expired" ? 1 : 0, results: [{ subscriptionId: subscription.id, result }] });
    return;
  }

  const summary = await sendPushToUser(userId, payload);
  res.json(summary);
});

// Chamado pelo service worker após exibir a notificação — sem auth (o
// contexto de push do SW não tem acesso ao token da página). O endpoint é
// uma URL longa e opaca só conhecida por quem legitimamente a assinou;
// pior caso de abuso é um timestamp de diagnóstico incorreto, sem
// nenhuma leitura ou escrita de dado sensível.
router.post("/push/ack", async (req, res): Promise<void> => {
  const parsed = AckBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Corpo inválido" }); return; }

  await db
    .update(pushSubscriptionsTable)
    .set({ lastDeliveredAt: Clock.now() })
    .where(eq(pushSubscriptionsTable.endpoint, parsed.data.endpoint));

  res.status(204).send();
});

export default router;
