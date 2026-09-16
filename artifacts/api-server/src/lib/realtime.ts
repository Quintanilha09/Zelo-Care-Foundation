/**
 * Sincronização em tempo real — ZELO (ZELO-25).
 *
 * SSE (Server-Sent Events), não WebSocket: unidirecional resolve o caso
 * inteiro (servidor -> cuidadores conectados), o navegador reconecta
 * sozinho por padrão, atravessa proxy sem drama.
 *
 * Pub/sub em memória, por processo — não pg-boss. pg-boss é para
 * processamento em segundo plano, não para empurrar dado numa conexão HTTP
 * aberta; e este serviço roda como um único processo (sem múltiplas
 * instâncias hoje), então EventEmitter em memória é suficiente e mais
 * simples que LISTEN/NOTIFY do Postgres — sem infra nova pra manter.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * "SEM MÚLTIPLAS INSTÂNCIAS HOJE" É UMA CONDIÇÃO, NÃO UMA OBSERVAÇÃO — #197.
 *
 * A frase acima está aqui desde que este arquivo foi escrito, e estava certa.
 * O que faltava era ela valer em algum lugar que um operador fosse ler antes
 * de aumentar a escala do serviço — que é um seletor de número numa tela.
 *
 * Com dois nós, duas coisas quebram aqui, e nenhuma dá erro:
 *
 *   1. O evento não atravessa. Uma cuidadora conectada ao nó A não recebe a
 *      dose registrada pela irmã através do nó B — a tela dela continua
 *      mostrando "pendente". Num produto em que duas pessoas cuidam do mesmo
 *      idoso, esse é o caminho para dose repetida.
 *
 *   2. `closeConnectionsForUser` só enxerga o mapa DESTE processo. Revogar o
 *      acesso de um cuidador pelo nó A não fecha a conexão que ele tem aberta
 *      no nó B: ele continua recebendo nome de medicamento, quem registrou e
 *      situação da dose até a conexão cair sozinha.
 *
 * A segunda encosta no invariante 2 do produto — todo acesso a paciente é
 * validado no servidor contra o vínculo familiar. Com dois nós, a revogação
 * passaria a valer só para o nó que a atendeu.
 *
 * Sessão fixa (*sticky session*) não resolve nenhuma das duas: ela mantém a
 * conexão no mesmo nó, e não faz o evento atravessar.
 *
 * O que precisa existir antes de subir a escala está em
 * `planning/runbooks/escala-do-servico.md`.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Duas estruturas:
 * - canal por paciente (patientEmitter): quem está vendo aquele paciente
 *   recebe os eventos dele.
 * - registro por usuário (connectionsByUserId): permite derrubar toda
 *   conexão aberta de um usuário na hora que o acesso dele é revogado
 *   (ver revokeCaregiverAccess em routes/caregivers.ts).
 */
import { EventEmitter } from "node:events";
import type { Response } from "express";

export type RealtimeEvent =
  | { type: "dose_registered"; scheduledDoseId: number; medicationName: string; scheduledLocalTime: string; caregiverName: string; status: string }
  | { type: "dose_undone"; scheduledDoseId: number }
  | { type: "treatment_changed"; treatmentId: number }
  | { type: "caregiver_joined"; caregiverName: string }
  | { type: "low_stock"; medicationName: string }
  // ZELO-30: emitidos pela cascata de escalonamento — quem estiver com o
  // paciente aberto vê ao vivo que uma dose passou pro T+30 (transmitida
  // pra todos) ou T+60 (marcada como perdida), sem precisar dar refresh.
  | { type: "escalation_triggered"; scheduledDoseId: number }
  | { type: "dose_missed"; scheduledDoseId: number };

const patientEmitter = new EventEmitter();
patientEmitter.setMaxListeners(0); // várias abas/dispositivos assistindo o mesmo paciente é normal

export function publishPatientEvent(patientId: number, event: RealtimeEvent): void {
  patientEmitter.emit(`patient:${patientId}`, event);
}

export function subscribeToPatientEvents(patientId: number, handler: (event: RealtimeEvent) => void): () => void {
  const channel = `patient:${patientId}`;
  patientEmitter.on(channel, handler);
  return () => patientEmitter.off(channel, handler);
}

// ── Registro de conexões abertas por usuário — pra revogação imediata ────

const connectionsByUserId = new Map<number, Set<Response>>();

export function registerConnection(userId: number, res: Response): void {
  if (!connectionsByUserId.has(userId)) connectionsByUserId.set(userId, new Set());
  connectionsByUserId.get(userId)!.add(res);
}

export function unregisterConnection(userId: number, res: Response): void {
  const set = connectionsByUserId.get(userId);
  if (!set) return;
  set.delete(res);
  if (set.size === 0) connectionsByUserId.delete(userId);
}

/** Derruba toda conexão SSE aberta de um usuário — chamado quando o acesso dele é revogado. */
export function closeConnectionsForUser(userId: number): void {
  const set = connectionsByUserId.get(userId);
  if (!set) return;
  for (const res of set) {
    try { res.end(); } catch { /* conexão já pode ter caído sozinha */ }
  }
  connectionsByUserId.delete(userId);
}
