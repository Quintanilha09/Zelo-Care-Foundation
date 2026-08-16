/**
 * Log de auditoria imutável — ZELO.
 *
 * Regras absolutas:
 * 1. Só INSERT — nunca UPDATE ou DELETE nesta tabela
 * 2. O diff só pode conter campos não-sensíveis (sem nome de medicamento,
 *    condição de saúde, ou identificador de paciente como nome/data de nascimento)
 * 3. Qualquer falha de audit log é logada mas NÃO propaga erro para o usuário
 *    (audit é melhor-esforço, não pode bloquear a operação principal)
 */

import { db } from "@workspace/db";
import { auditLogTable, type InsertAuditLogEntry } from "@workspace/db";
import { logger } from "./logger";

type AuditOptions = Omit<InsertAuditLogEntry, "id" | "createdAt">;

/**
 * Registra uma entrada de auditoria. Fire-and-forget seguro:
 * erros são logados mas não relançados.
 */
export async function audit(options: AuditOptions): Promise<void> {
  try {
    await db.insert(auditLogTable).values({
      ...options,
      // diff: nunca incluir campos sensíveis — valide antes de chamar
    });
  } catch (err) {
    // Audit falhou — loga mas não propaga. A operação principal já foi concluída.
    logger.error(
      { err, entityType: options.entityType, action: options.action },
      "Falha ao registrar audit log"
    );
  }
}

/** Cria um objeto diff seguro (apenas campos permitidos). */
export function safeDiff(
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
  safeFields: string[]
): string {
  const pick = (obj: Record<string, unknown> | null) => {
    if (!obj) return null;
    return Object.fromEntries(
      Object.entries(obj).filter(([k]) => safeFields.includes(k))
    );
  };
  return JSON.stringify({ before: pick(before), after: pick(after) });
}
