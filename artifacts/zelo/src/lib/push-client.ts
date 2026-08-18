/**
 * Cliente de Web Push — ZELO (ZELO-26).
 *
 * Escopo desta história: assinar, listar, testar. Nenhum lembrete
 * automático ainda (ZELO-27) — o único push que existe hoje é o de teste,
 * disparado manualmente pela tela de diagnóstico em /ajustes.
 */
import { authFetch } from "./auth-client";

export function isPushSupported(): boolean {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

/** iPhone/iPad, incluindo iPadOS 13+ que se anuncia como Mac mas tem touch. */
export function isIOS(): boolean {
  const ua = navigator.userAgent;
  if (/iPad|iPhone|iPod/.test(ua)) return true;
  return navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
}

/** PWA aberto a partir da Tela de Início (não numa aba do Safari/Chrome). */
export function isStandalone(): boolean {
  if (window.matchMedia("(display-mode: standalone)").matches) return true;
  return (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

/** Web Push no iOS exige PWA instalado — sem isso, pedir permissão não adianta nada. */
export function needsIOSInstallGuide(): boolean {
  return isIOS() && !isStandalone();
}

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator)) return null;
  return navigator.serviceWorker.register("/sw.js");
}

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const base64Safe = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64Safe);
  const output = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
  return output;
}

function guessDeviceLabel(): string {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return "iPhone";
  if (/iPad/.test(ua)) return "iPad";
  if (/Android/.test(ua)) return /Mobile/.test(ua) ? "Celular Android" : "Tablet Android";
  if (/Macintosh/.test(ua)) return "Mac";
  if (/Windows/.test(ua)) return "Windows";
  return "Este dispositivo";
}

/** ZELO-29: categoria ampla, calculada uma vez ao assinar — pra métrica "iOS entrega pior que Android?". */
function detectPlatform(): "ios" | "android" | "desktop" | "unknown" {
  if (isIOS()) return "ios";
  if (/Android/.test(navigator.userAgent)) return "android";
  if (/Macintosh|Windows|Linux/.test(navigator.userAgent)) return "desktop";
  return "unknown";
}

export type SubscribeResult =
  | { ok: true }
  | { ok: false; reason: "unsupported" | "permission_denied" | "not_configured" | "error"; detail?: string };

/** Pede permissão (se preciso) e assina este dispositivo. */
export async function subscribeToPush(): Promise<SubscribeResult> {
  if (!isPushSupported()) return { ok: false, reason: "unsupported" };

  let permission = Notification.permission;
  if (permission === "default") permission = await Notification.requestPermission();
  if (permission !== "granted") return { ok: false, reason: "permission_denied" };

  const keyRes = await authFetch("/api/push/vapid-public-key");
  if (keyRes.status === 503) return { ok: false, reason: "not_configured" };
  if (!keyRes.ok) return { ok: false, reason: "error", detail: `HTTP ${keyRes.status}` };
  const { publicKey } = (await keyRes.json()) as { publicKey: string };

  try {
    const registration = await registerServiceWorker();
    if (!registration) return { ok: false, reason: "unsupported" };
    await navigator.serviceWorker.ready;

    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
    }

    const json = subscription.toJSON();
    const res = await authFetch("/api/push/subscribe", {
      method: "POST",
      body: JSON.stringify({
        endpoint: json.endpoint,
        keys: { p256dh: json.keys?.p256dh, auth: json.keys?.auth },
        deviceLabel: guessDeviceLabel(),
        platform: detectPlatform(),
      }),
    });
    if (!res.ok) return { ok: false, reason: "error", detail: `HTTP ${res.status}` };
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: "error", detail: err instanceof Error ? err.message : "erro desconhecido" };
  }
}

/** Desassina este dispositivo — tanto do navegador quanto do servidor. */
export async function unsubscribeFromPush(): Promise<void> {
  if (!("serviceWorker" in navigator)) return;
  const registration = await navigator.serviceWorker.getRegistration();
  const subscription = await registration?.pushManager.getSubscription();
  if (!subscription) return;

  const endpoint = subscription.endpoint;
  await subscription.unsubscribe();
  await authFetch("/api/push/subscribe", { method: "DELETE", body: JSON.stringify({ endpoint }) });
}

/** Endpoint da assinatura ATIVA deste navegador, se houver — pra comparar com a lista do servidor. */
export async function getCurrentEndpoint(): Promise<string | null> {
  if (!("serviceWorker" in navigator)) return null;
  const registration = await navigator.serviceWorker.getRegistration();
  const subscription = await registration?.pushManager.getSubscription();
  return subscription?.endpoint ?? null;
}

export interface PushSubscriptionSummary {
  id: number;
  endpoint: string;
  deviceLabel: string | null;
  active: boolean;
  lastDeliveredAt: string | null;
  failureCount: number;
  createdAt: string;
}

export async function listSubscriptions(): Promise<PushSubscriptionSummary[]> {
  const res = await authFetch("/api/push/subscriptions");
  if (!res.ok) return [];
  return res.json();
}

export async function sendTestPush(subscriptionId?: number): Promise<{ sent: number; expired: number; failed: number }> {
  const res = await authFetch("/api/push/test", {
    method: "POST",
    body: JSON.stringify(subscriptionId ? { subscriptionId } : {}),
  });
  if (!res.ok) return { sent: 0, expired: 0, failed: 1 };
  return res.json();
}
