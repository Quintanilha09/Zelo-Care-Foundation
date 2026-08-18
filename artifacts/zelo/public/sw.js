// Service worker — ZELO (ZELO-26, ZELO-28).
//
// Escopo mínimo, de propósito: push + notificationclick + a fila offline
// de ações de dose. Nenhum cache de asset, nenhuma estratégia
// offline-first — isso não foi pedido e adicionaria uma superfície de bugs
// (asset velho servido do cache) sem necessidade.
//
// skipWaiting/clients.claim fazem a versão nova assumir na hora, sem
// esperar todas as abas fecharem — isso NÃO derruba PushSubscription
// nenhuma, que vive presa ao registro (mesmo scope/URL), não ao conteúdo
// do arquivo. A assinatura só morreria se alguém chamasse
// registration.unregister(), o que este arquivo nunca faz.
//
// AUTENTICAÇÃO — DECISÃO DE DESIGN: este service worker NUNCA guarda nem
// lê token nenhum. O evento `push` pode disparar sem nenhuma aba aberta,
// e o access token só existe em memória na página (nunca em storage,
// proteção contra XSS — ver auth-client.ts). Em vez de duplicar essa
// capacidade de autenticar aqui (o que expandiria a superfície de risco
// pra um contexto sem interface, sem confirmação do usuário), a ação de
// "✓ Tomou"/"Adiar 15 min":
//   1. Se existe uma aba (client) alcançável, mesmo em segundo plano,
//      repassa a ação pra ela via postMessage — a PÁGINA autentica e
//      chama a API normalmente, como qualquer outra ação do app.
//   2. Se não existe nenhum client, grava a ação no IndexedDB
//      (zelo-offline-queue) e para por aí — zelo-offline-queue.ts (bundle
//      da página) lê essa mesma fila ao abrir e sincroniza. É assim que
//      "a ação do cuidador nunca se perde" (história) sem o service worker
//      precisar de nenhum poder de autenticação próprio.

const QUEUE_DB_NAME = "zelo-offline-queue";
const QUEUE_STORE = "pending-actions";

function openQueueDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(QUEUE_DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(QUEUE_STORE)) {
        req.result.createObjectStore(QUEUE_STORE, { keyPath: "id", autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function queueAction(action) {
  const db = await openQueueDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(QUEUE_STORE, "readwrite");
    tx.objectStore(QUEUE_STORE).add({ ...action, queuedAt: Date.now() });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function dispatchOrQueue(action) {
  const clientList = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  if (clientList.length > 0) {
    clientList[0].postMessage({ type: "zelo-dose-action", action });
    return;
  }
  await queueAction(action);
}

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  event.waitUntil(handlePush(event));
});

async function handlePush(event) {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }

  const tag = data.tag;
  let doseIds = data.scheduledDoseId ? [data.scheduledDoseId] : [];
  let notificationIds = data.notificationId ? [data.notificationId] : [];

  // ZELO-28: doses de tratamentos diferentes do mesmo paciente no mesmo
  // horário chegam como pushes SEPARADOS mas com o MESMO tag (ver
  // dose-reminders.ts) — mescla numa notificação só em vez de empilhar.
  // notificationIds acompanha doseIds pelo mesmo motivo: cada dose do
  // grupo tem sua PRÓPRIA linha em `notifications` (ZELO-27), então
  // "marcar como tocada" ao clicar precisa confirmar todas elas, não só a
  // última que chegou.
  if (tag) {
    const existing = await self.registration.getNotifications({ tag });
    if (existing.length > 0 && existing[0].data) {
      if (Array.isArray(existing[0].data.doseIds)) {
        doseIds = Array.from(new Set([...existing[0].data.doseIds, ...doseIds]));
      }
      if (Array.isArray(existing[0].data.notificationIds)) {
        notificationIds = Array.from(new Set([...existing[0].data.notificationIds, ...notificationIds]));
      }
    }
  }

  const grouped = doseIds.length > 1;
  const title = data.title || "ZELO";
  const body = grouped ? `${doseIds.length} doses agendadas agora.` : data.body || "";

  await self.registration.showNotification(title, {
    body,
    icon: "/favicon.svg",
    badge: "/favicon.svg",
    tag,
    data: { url: data.url || "/", doseIds, notificationIds, patientId: data.patientId },
    // Botões só fazem sentido apontando pra UMA dose — ver o docblock do
    // módulo em dose-reminders.ts. Notificação agrupada abre o app ao
    // tocar no corpo, sem ação de um toque só.
    actions: grouped ? [] : [
      { action: "taken", title: "✓ Tomou" },
      { action: "snooze", title: "Adiar 15 min" },
    ],
  });

  // ZELO-29: a ÚNICA prova real de entrega que a web oferece — este beacon
  // roda toda vez que o SW processa um evento `push` de verdade no
  // aparelho (diferente de sentAt, que só prova que o SERVIÇO de push
  // aceitou o envio). Confirma tanto o sinal genérico de diagnóstico da
  // assinatura (ZELO-26, lastDeliveredAt) quanto, se o payload trouxer
  // notificationId, a linha específica em `notifications` — é essa segunda
  // parte que o job de verificação de 3min olha antes de escalar.
  try {
    const subscription = await self.registration.pushManager.getSubscription();
    if (subscription) {
      await fetch("/api/push/ack", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint: subscription.endpoint, notificationId: data.notificationId }),
      });
    }
  } catch {
    // sem rede, servidor fora do ar — o push já foi mostrado, o ack é só diagnóstico
  }
}

async function ackAction(notificationIds) {
  if (!notificationIds || notificationIds.length === 0) return;
  try {
    await fetch("/api/push/ack", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ackedNotificationIds: notificationIds }),
    });
  } catch {
    // melhor esforço — "tocou" é analítico, nunca deveria travar a ação real
  }
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  if (self.navigator && self.navigator.vibrate) self.navigator.vibrate(100);

  const notifData = event.notification.data || {};
  const doseIds = notifData.doseIds || [];
  const notificationIds = notifData.notificationIds || [];
  const url = notifData.url || "/";

  event.waitUntil(ackAction(notificationIds));

  if (event.action === "taken" && doseIds.length === 1) {
    event.waitUntil(dispatchOrQueue({ kind: "register", scheduledDoseId: doseIds[0], patientId: notifData.patientId, outcome: "taken" }));
    return;
  }
  if (event.action === "snooze" && doseIds.length === 1) {
    event.waitUntil(dispatchOrQueue({ kind: "snooze", scheduledDoseId: doseIds[0], patientId: notifData.patientId }));
    return;
  }

  // Clique no corpo (não numa action): abre o app na dose/paciente em questão.
  event.waitUntil(
    (async () => {
      const clientList = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of clientList) {
        if (client.url.includes(url) && "focus" in client) {
          await client.focus();
          return;
        }
      }
      if (clientList.length > 0 && "navigate" in clientList[0]) {
        const navigated = await clientList[0].navigate(url);
        if (navigated && "focus" in navigated) await navigated.focus();
        return;
      }
      if (self.clients.openWindow) await self.clients.openWindow(url);
    })()
  );
});
