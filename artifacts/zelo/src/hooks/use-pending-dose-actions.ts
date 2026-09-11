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

export function usePendingDoseActions(enabled: boolean): void {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  useEffect(() => {
    if (!enabled) return;

    async function processAction(action: PendingAction): Promise<"ok" | "rejected" | "network-error"> {
      if (!action.patientId) return "rejected";

      try {
        if (action.kind === "register") {
          const enviar = (justification?: string) =>
            authFetch(`/api/patients/${action.patientId}/dose-records`, {
              method: "POST",
              body: JSON.stringify({
                scheduledDoseId: action.scheduledDoseId,
                outcome: action.outcome ?? "taken",
                /**
                 * Issue #167 — o horário do TOQUE, quando ele existe.
                 *
                 * A ação vinda da notificação continua sem ele: ela sobe
                 * em segundos, e o relógio do servidor é mais confiável
                 * que o do aparelho. O registro feito pela tela sem
                 * internet manda — porque entre o toque e a subida podem
                 * passar horas, e o horário é o dado que vai ao médico.
                 */
                takenAt: action.takenAt,
                justification: justification ?? action.justification,
                // A dose pode ter ficado longe da hora enquanto esperava
                // na fila. Quem registrou já confirmou no toque; pedir de
                // novo agora seria perguntar a uma tela que ninguém está
                // olhando.
                ...(action.takenAt ? { confirmarAntecipacao: true } : {}),
              }),
            });

          let res = await enviar();

          if (!res.ok) {
            const corpo = (await res.json().catch(() => ({}))) as { code?: string };

            /**
             * O registro esperou tempo demais na fila e caiu fora da
             * janela retroativa da família.
             *
             * A justificativa existe para uma pessoa explicar um registro
             * antigo. Aqui o app SABE o que houve, e o que ele escreve é
             * um fato, não uma desculpa inventada: a dose foi registrada
             * sem internet, e só agora chegou. Perder a dose por falta de
             * uma frase seria o pior desfecho possível.
             */
            if (corpo.code === "JUSTIFICATION_REQUIRED" && action.takenAt) {
              const quando = new Date(action.takenAt);
              const hora = Number.isNaN(quando.getTime())
                ? ""
                : ` às ${quando.getHours().toString().padStart(2, "0")}:${quando.getMinutes().toString().padStart(2, "0")}`;
              res = await enviar(`Registrado sem internet${hora}; sincronizado depois.`);
            }
          }

          if (!res.ok) {
            // 409 é o caso bom disfarçado de erro: outra pessoa registrou
            // primeiro, e a dose ESTÁ registrada — que era o objetivo.
            if (res.status === 409) {
              toast({ description: "Essa dose já tinha sido registrada por outra pessoa." });
              return "ok";
            }
            return "rejected";
          }
          toast({
            description: action.takenAt
              ? "A dose que você registrou sem internet acabou de subir."
              : "Dose registrada pela notificação.",
          });
        } else {
          const res = await authFetch(`/api/patients/${action.patientId}/dose-records/${action.scheduledDoseId}/snooze`, {
            method: "POST",
          });
          if (!res.ok) return "rejected";
          toast({ description: "Vamos lembrar de novo em 15 minutos." });
        }
        // Issue #178 renomeou a chave da tela inicial, e esta linha ficou
        // para trás: a fila subia a dose e a tela não se atualizava. A
        // antiga ("home") sumiu do app; a da ficha continua.
        void queryClient.invalidateQueries({ queryKey: ["today-doses"] });
        void queryClient.invalidateQueries({ queryKey: ["o-dia"] });
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
  }, [enabled]);
}
