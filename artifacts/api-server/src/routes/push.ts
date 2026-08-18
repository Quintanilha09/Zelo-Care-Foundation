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
import { eq, and, gte, sql, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@workspace/db";
import { pushSubscriptionsTable, notificationsTable, pushPlatformEnum } from "@workspace/db";
import { requireAuth } from "../middleware/require-auth";
import { getVapidPublicKey, sendPushToUser, sendPushToSubscription } from "../lib/push.ts";
import { Clock } from "../lib/clock.ts";

const router = Router();

const SubscribeBody = z.object({
  endpoint: z.string().min(1),
  keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }),
  deviceLabel: z.string().optional().nullable(),
  // ZELO-29: categoria ampla ("ios"/"android"/"desktop"), pra métrica de
  // entrega por plataforma. Opcional — cliente antigo que ainda não manda
  // isso cai em "unknown" (default da coluna), nunca quebra a assinatura.
  platform: z.enum(pushPlatformEnum.enumValues).optional(),
});

const UnsubscribeBody = z.object({ endpoint: z.string().min(1) });

const TestBody = z.object({ subscriptionId: z.number().int().positive().optional() });

const AckBody = z.object({
  // Opcional: o "acted" (ackedNotificationIds, ao tocar a notificação) não
  // precisa de endpoint nenhum — só o "delivered" (ao receber o push)
  // atualiza a assinatura por endpoint.
  endpoint: z.string().min(1).optional(),
  // ZELO-29: qual notification confirmar como entregue (chamado quando o
  // evento `push` chega) — sem isto, o ack só atualiza o sinal de
  // diagnóstico genérico da assinatura (ZELO-26), não a linha específica
  // em `notifications`.
  notificationId: z.number().int().positive().optional(),
  // ZELO-29: quais notifications marcar como tocadas (chamado no
  // notificationclick) — pode ser mais de uma quando a notificação exibida
  // é um agrupamento de doses (ZELO-28). Mesma rota sem auth que o resto
  // deste arquivo: o service worker nunca tem token, e a única coisa que
  // isto altera é um timestamp numa linha já existente e conhecida.
  ackedNotificationIds: z.array(z.number().int().positive()).optional(),
});

router.get("/push/vapid-public-key", requireAuth, (_req, res): void => {
  const publicKey = getVapidPublicKey();
  if (!publicKey) { res.status(503).json({ error: "Web Push não configurado neste ambiente (VAPID_PUBLIC_KEY ausente)" }); return; }
  res.json({ publicKey });
});

router.post("/push/subscribe", requireAuth, async (req, res): Promise<void> => {
  const parsed = SubscribeBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Corpo inválido", details: parsed.error.issues }); return; }
  const { userId, familyId } = getAuth(req);
  const { endpoint, keys, deviceLabel, platform } = parsed.data;

  const [subscription] = await db
    .insert(pushSubscriptionsTable)
    .values({ userId, familyId, endpoint, p256dh: keys.p256dh, auth: keys.auth, deviceLabel, platform, active: true, failureCount: 0 })
    .onConflictDoUpdate({
      target: [pushSubscriptionsTable.userId, pushSubscriptionsTable.endpoint],
      set: { p256dh: keys.p256dh, auth: keys.auth, deviceLabel, platform, active: true, failureCount: 0, updatedAt: Clock.now() },
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

  let subscription: { platform: (typeof pushPlatformEnum.enumValues)[number] } | undefined;
  if (parsed.data.endpoint) {
    [subscription] = await db
      .update(pushSubscriptionsTable)
      .set({ lastDeliveredAt: Clock.now() })
      .where(eq(pushSubscriptionsTable.endpoint, parsed.data.endpoint))
      .returning({ platform: pushSubscriptionsTable.platform });
  }

  // ZELO-29: além do sinal genérico de diagnóstico acima (por assinatura),
  // confirma a entrega da notification específica — é isto que o job de
  // verificação de 3min olha pra decidir se escala. onConflict não se
  // aplica aqui (não é insert); um notificationId que já tinha deliveredAt
  // só reescreve com o mesmo tipo de dado, sem efeito colateral.
  if (parsed.data.notificationId) {
    await db
      .update(notificationsTable)
      .set({ deliveredAt: Clock.now(), deliveredViaPlatform: subscription?.platform ?? "unknown" })
      .where(eq(notificationsTable.id, parsed.data.notificationId));
  }

  // "acted_at" da história — chamado no notificationclick, pode ser mais de
  // um id quando a notificação exibida agrupava várias doses (ZELO-28).
  if (parsed.data.ackedNotificationIds && parsed.data.ackedNotificationIds.length > 0) {
    await db
      .update(notificationsTable)
      .set({ ackedAt: Clock.now() })
      .where(inArray(notificationsTable.id, parsed.data.ackedNotificationIds));
  }

  res.status(204).send();
});

// ZELO-29: taxa de entrega por período — nunca considerar dose notificada
// só porque o envio retornou 201 (sentAt), a pergunta de verdade é quantos
// desses viraram deliveredAt de fato. Só dose_reminder entra na conta —
// os outros tipos de notificação não passam por push ainda.
router.get("/push/delivery-stats", requireAuth, async (req, res): Promise<void> => {
  const days = Math.min(365, Math.max(1, parseInt(String(req.query.days ?? "30"), 10) || 30));
  const since = new Date(Clock.now().getTime() - days * 86_400_000);
  const { familyId } = getAuth(req);

  const rows = await db
    .select({
      total: sql<number>`count(*)`.mapWith(Number),
      delivered: sql<number>`count(${notificationsTable.deliveredAt})`.mapWith(Number),
      platform: notificationsTable.deliveredViaPlatform,
    })
    .from(notificationsTable)
    .where(and(
      eq(notificationsTable.familyId, familyId),
      eq(notificationsTable.type, "dose_reminder"),
      gte(notificationsTable.sentAt, since)
    ))
    .groupBy(notificationsTable.deliveredViaPlatform);

  const totalSent = rows.reduce((sum, r) => sum + r.total, 0);
  const totalDelivered = rows.reduce((sum, r) => sum + r.delivered, 0);

  res.json({
    periodDays: days,
    totalSent,
    totalDelivered,
    deliveryRate: totalSent > 0 ? totalDelivered / totalSent : null,
    // Só cobre quem JÁ confirmou entrega — não é uma taxa por plataforma
    // com denominador exato (precisaria de 1 linha por dispositivo por
    // envio, fora do escopo pedido aqui). Ainda assim mostra, por
    // exemplo, se quase nenhuma confirmação vem de iOS.
    deliveredByPlatform: rows.filter((r) => r.platform !== null).map((r) => ({ platform: r.platform, count: r.delivered })),
  });
});

export default router;
