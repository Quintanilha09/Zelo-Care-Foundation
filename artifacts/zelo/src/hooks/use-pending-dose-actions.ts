/**
 * Drena a fila offline de ações de dose e escuta ações delegadas ao vivo
 * pelo service worker — ZELO (ZELO-28).
 *
 * Duas origens da mesma ação, um só processamento:
 * 1. Mensagem ao vivo do SW (client estava alcançável quando o cuidador
 *    tocou "✓ Tomou"/"Adiar" na notificação — ver public/sw.js).
 * 2. Fila do IndexedDB (SW não achou nenhum client — a ação foi guardada
 *    pra ser sincronizada agora, ao abrir o app).
 *
 * Também drena ao voltar a conexão (window "online") — cobre o caso de o
 * app estar aberto mas o dispositivo ter ficado offline no momento do toque.
 */
import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { authFetch } from "@/lib/auth-client";
import { useToast } from "@/hooks/use-toast";
import { getQueuedActions, removeQueuedAction, enqueueAction, type QueuedDoseAction } from "@/lib/offline-queue";

type PendingAction = Omit<QueuedDoseAction, "id" | "queuedAt">;

export function usePendingDoseActions(): void {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  useEffect(() => {
    async function processAction(action: PendingAction): Promise<"ok" | "rejected" | "network-error"> {
      if (!action.patientId) return "rejected";

      try {
        if (action.kind === "register") {
          const res = await authFetch(`/api/patients/${action.patientId}/dose-records`, {
            method: "POST",
            body: JSON.stringify({
              scheduledDoseId: action.scheduledDoseId,
              takenAt: new Date().toISOString(),
              outcome: action.outcome ?? "taken",
            }),
          });
          if (!res.ok) return "rejected";
          toast({ description: "Dose registrada pela notificação." });
        } else {
          const res = await authFetch(`/api/patients/${action.patientId}/dose-records/${action.scheduledDoseId}/snooze`, {
            method: "POST",
          });
          if (!res.ok) return "rejected";
          toast({ description: "Vamos lembrar de novo em 15 minutos." });
        }
        void queryClient.invalidateQueries({ queryKey: ["today-doses"] });
        void queryClient.invalidateQueries({ queryKey: ["home"] });
        return "ok";
      } catch {
        // TypeError de fetch (sem rede) — não é rejeição da API, é falta de
        // conexão. Diferente de "rejected": aqui vale tentar de novo depois.
        return "network-error";
      }
    }

    async function drainQueue(): Promise<void> {
      const pending = await getQueuedActions().catch(() => []);
      for (const item of pending) {
        const result = await processAction(item);
        if (result !== "network-error") await removeQueuedAction(item.id);
        else break; // ainda sem rede — para e tenta de novo no próximo drain
      }
    }

    function handleMessage(event: MessageEvent): void {
      if (event.data?.type !== "zelo-dose-action") return;
      const action = event.data.action as PendingAction;
      void processAction(action).then((result) => {
        if (result === "network-error") void enqueueAction(action);
      });
    }

    void drainQueue();
    window.addEventListener("online", drainQueue);
    navigator.serviceWorker?.addEventListener("message", handleMessage);

    return () => {
      window.removeEventListener("online", drainQueue);
      navigator.serviceWorker?.removeEventListener("message", handleMessage);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
