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
  | { type: "low_stock"; medicationName: string };

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
