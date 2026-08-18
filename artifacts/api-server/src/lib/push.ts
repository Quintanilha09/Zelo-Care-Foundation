/**
 * Envio de Web Push — ZELO (ZELO-26).
 *
 * VAPID identifica este servidor perante o serviço de push (FCM, Mozilla,
 * etc.) — é só um par de chaves que o próprio servidor gera e mantém
 * estável (trocar invalidaria toda assinatura já criada nos navegadores).
 * Sem relação com conta ou cobrança de terceiro, ao contrário da chave da
 * Claude Vision.
 *
 * Assinatura expirada (404/410 do serviço de push) é desativada sozinha
 * aqui dentro — nunca lançada como erro pro chamador, que normalmente
 * está enviando pra vários dispositivos de uma vez e não deve abortar por
 * causa de um só estar morto.
 */
import webpush from "web-push";
import { eq, and, sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { pushSubscriptionsTable, type PushSubscription } from "@workspace/db";
import { logger } from "./logger.ts";

let configured = false;

function ensureConfigured(): boolean {
  if (configured) return true;
  const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = process.env;
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY || !VAPID_SUBJECT) return false;
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
  configured = true;
  return true;
}

/** Chave pública — segura pra expor ao cliente, é assim que Web Push funciona. */
export function getVapidPublicKey(): string | null {
  return process.env.VAPID_PUBLIC_KEY ?? null;
}

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
  tag?: string;
}

export type PushSendResult =
  | { ok: true }
  | { ok: false; reason: "not_configured" | "no_keys" | "expired" | "error"; detail?: string };

/** Envia pra UMA assinatura. Nunca lança — resultado sempre tipado. */
export async function sendPushToSubscription(
  subscription: Pick<PushSubscription, "id" | "endpoint" | "p256dh" | "auth">,
  payload: PushPayload
): Promise<PushSendResult> {
  if (!ensureConfigured()) return { ok: false, reason: "not_configured" };
  if (!subscription.p256dh || !subscription.auth) return { ok: false, reason: "no_keys" };

  try {
    await webpush.sendNotification(
      { endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } },
      JSON.stringify(payload)
    );
    await db.update(pushSubscriptionsTable).set({ failureCount: 0 }).where(eq(pushSubscriptionsTable.id, subscription.id));
    return { ok: true };
  } catch (err) {
    const statusCode = (err as { statusCode?: number }).statusCode;

    if (statusCode === 404 || statusCode === 410) {
      await db.update(pushSubscriptionsTable)
        .set({ active: false, failureCount: sql`${pushSubscriptionsTable.failureCount} + 1` })
        .where(eq(pushSubscriptionsTable.id, subscription.id));
      return { ok: false, reason: "expired" };
    }

    await db.update(pushSubscriptionsTable)
      .set({ failureCount: sql`${pushSubscriptionsTable.failureCount} + 1` })
      .where(eq(pushSubscriptionsTable.id, subscription.id));
    logger.warn({ statusCode, subscriptionId: subscription.id }, "Falha ao enviar push");
    return { ok: false, reason: "error", detail: statusCode ? `HTTP ${statusCode}` : (err instanceof Error ? err.message : "erro desconhecido") };
  }
}

/** Envia pra todas as assinaturas ativas do usuário — um dispositivo com problema não aborta os outros. */
export async function sendPushToUser(
  userId: number,
  payload: PushPayload
): Promise<{ sent: number; expired: number; failed: number; results: Array<{ subscriptionId: number; result: PushSendResult }> }> {
  const subs = await db
    .select()
    .from(pushSubscriptionsTable)
    .where(and(eq(pushSubscriptionsTable.userId, userId), eq(pushSubscriptionsTable.active, true)));

  let sent = 0, expired = 0, failed = 0;
  const results: Array<{ subscriptionId: number; result: PushSendResult }> = [];
  for (const sub of subs) {
    const result = await sendPushToSubscription(sub, payload);
    results.push({ subscriptionId: sub.id, result });
    if (result.ok) sent++;
    else if (result.reason === "expired") expired++;
    else failed++;
  }
  return { sent, expired, failed, results };
}
