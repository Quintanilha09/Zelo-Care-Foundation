/**
 * Cliente de sincronização em tempo real (SSE) — ZELO (ZELO-25).
 *
 * Usa fetch() + leitura manual do stream em vez do EventSource nativo do
 * navegador — EventSource não permite header de autenticação customizado,
 * e este app nunca põe token na URL (vazaria em log de acesso/proxy).
 *
 * Reconecta sozinho com um atraso fixo simples (não é preciso backoff
 * exponencial pra um app deste tamanho). Degrada graciosamente: quem chama
 * isto deve manter o polling de 60s already existente independente do
 * estado da conexão — SSE é só uma otimização de latência, nunca o único
 * caminho pro dado chegar.
 */
import { authFetch } from "./auth-client";

export type RealtimeEvent =
  | { type: "dose_registered"; scheduledDoseId: number; medicationName: string; scheduledLocalTime: string; caregiverName: string; status: string }
  | { type: "dose_undone"; scheduledDoseId: number }
  | { type: "treatment_changed"; treatmentId: number }
  | { type: "caregiver_joined"; caregiverName: string }
  | { type: "low_stock"; medicationName: string };

const RECONNECT_DELAY_MS = 3000;

/**
 * Assina os eventos de um paciente. `onReconnect` dispara sempre que uma
 * conexão nova é estabelecida (inclusive a primeira) — é o gatilho pra
 * "reconciliar": buscar o estado atual em vez de confiar em eventos que
 * podem ter se perdido durante a queda.
 *
 * Retorna uma função de limpeza — chame ao desmontar o componente.
 */
export function subscribeToPatientEvents(
  patientId: number,
  onEvent: (event: RealtimeEvent) => void,
  onReconnect: () => void
): () => void {
  let stopped = false;
  let abortController: AbortController | null = null;

  async function connectOnce(): Promise<void> {
    abortController = new AbortController();
    const res = await authFetch(`/api/patients/${patientId}/events`, { signal: abortController.signal });
    if (!res.ok || !res.body) throw new Error("Falha ao conectar ao stream");

    onReconnect();

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (!stopped) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let idx: number;
      while ((idx = buffer.indexOf("\n\n")) !== -1) {
        const raw = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        let eventType = "";
        let data = "";
        for (const line of raw.split("\n")) {
          if (line.startsWith("event:")) eventType = line.slice(6).trim();
          else if (line.startsWith("data:")) data += line.slice(5).trim();
        }
        if (eventType && data) {
          try { onEvent(JSON.parse(data) as RealtimeEvent); } catch { /* linha malformada — ignora */ }
        }
      }
    }
  }

  async function loop(): Promise<void> {
    while (!stopped) {
      try {
        await connectOnce();
      } catch {
        // rede caiu, servidor reiniciou, token expirou — todos caem aqui e reconectam.
      }
      if (stopped) break;
      await new Promise((resolve) => setTimeout(resolve, RECONNECT_DELAY_MS));
    }
  }

  void loop();

  return () => {
    stopped = true;
    abortController?.abort();
  };
}
