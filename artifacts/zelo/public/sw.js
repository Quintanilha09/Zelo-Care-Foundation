// Service worker — ZELO (ZELO-26).
//
// Escopo mínimo, de propósito: só push + notificationclick. Nenhum cache de
// asset, nenhuma estratégia offline-first — isso não foi pedido nesta
// história e adicionaria uma superfície de bugs (asset velho servido do
// cache) sem necessidade.
//
// skipWaiting/clients.claim fazem a versão nova assumir na hora, sem
// esperar todas as abas fecharem — isso NÃO derruba PushSubscription
// nenhuma, que vive presa ao registro (mesmo scope/URL), não ao conteúdo
// do arquivo. A assinatura só morreria se alguém chamasse
// registration.unregister(), o que este arquivo nunca faz.

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }

  const title = data.title || "ZELO";
  const options = {
    body: data.body || "",
    icon: "/favicon.svg",
    badge: "/favicon.svg",
    tag: data.tag || undefined,
    data: { url: data.url || "/" },
  };

  event.waitUntil(
    (async () => {
      await self.registration.showNotification(title, options);

      // Diagnóstico "seus lembretes estão funcionando?" (/ajustes) — melhor
      // esforço, nunca bloqueia a notificação em si se falhar.
      try {
        const subscription = await self.registration.pushManager.getSubscription();
        if (subscription) {
          await fetch("/api/push/ack", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ endpoint: subscription.endpoint }),
          });
        }
      } catch {
        // sem rede, servidor fora do ar — o push já foi mostrado, o ack é só diagnóstico
      }
    })()
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";

  event.waitUntil(
    (async () => {
      const clientList = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of clientList) {
        if (client.url.includes(url) && "focus" in client) {
          await client.focus();
          return;
        }
      }
      if (self.clients.openWindow) {
        await self.clients.openWindow(url);
      }
    })()
  );
});
