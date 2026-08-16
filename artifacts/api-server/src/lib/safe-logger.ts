/**
 * Logger com lista de permissão de campos seguros — ZELO.
 *
 * Por que isso existe:
 * O ZELO é um app de saúde. Logs da aplicação NUNCA podem conter:
 * - Nome de medicamento (campo sensível de saúde)
 * - Condição de saúde, diagnóstico
 * - Identificador de paciente (name, birthDate)
 * - Valores de aferição (pressão, glicemia, peso)
 *
 * Esta implementação usa uma lista de permissão (allowlist) de campos
 * considerados seguros para logging. Qualquer campo fora da lista é
 * substituído por "[REDACTED]" automaticamente — não precisa confiar
 * em quem escreve o log para saber o que omitir.
 *
 * Uso:
 *   safeLog.info({ familyId: 1, action: "dose_recorded" }, "Dose registrada");
 *   // ✓ familyId e action estão na allowlist → logado normalmente
 *
 *   safeLog.info({ medicationName: "Cardiolex", familyId: 1 }, "Dose");
 *   // ✓ familyId logado, medicationName → "[REDACTED]"
 */

import { logger } from "./logger";

/**
 * Campos que podem aparecer em logs sem risco à privacidade.
 *
 * Para adicionar um campo: verifique se ele identifica ou implica
 * informação clínica. Em caso de dúvida, não adicione.
 */
const SAFE_LOG_FIELDS = new Set([
  // Identificadores de sistema (não de pessoa)
  "familyId",
  "caregiverId",
  "treatmentId",
  "scheduledDoseId",
  "doseRecordId",
  "appointmentId",
  "medicationId",  // ID numérico, não o nome
  "notificationId",
  "stockEntryId",
  "subscriptionId",

  // Metadados de ação
  "action",
  "entityType",
  "actorType",
  "escalationLevel",
  "status",
  "outcome",
  "scheduleType",
  "notificationType",

  // Metadados técnicos
  "requestId",
  "method",
  "url",
  "statusCode",
  "durationMs",
  "port",
  "err",
  "error",
  "message",

  // Timestamps e datas (sem fuso exposto, sem valor clínico)
  "scheduledAt",
  "takenAt",
  "createdAt",
  "updatedAt",
  "sentAt",
  "deliveredAt",
  "ackedAt",
  "date",
  "from",
  "to",

  // Contadores e métricas
  "count",
  "total",
  "adherenceRate",
  "pendingDoses",
  "takenDoses",
  "lateDoses",
]);

/**
 * Sanitiza um objeto de contexto: mantém campos na allowlist,
 * substitui o resto por "[REDACTED]".
 */
export function sanitizeLogContext(
  ctx: Record<string, unknown>
): Record<string, unknown> {
  const safe: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(ctx)) {
    if (SAFE_LOG_FIELDS.has(key)) {
      safe[key] = value;
    } else {
      safe[key] = "[REDACTED]";
    }
  }
  return safe;
}

/** Logger seguro — wraps pino com sanitização automática de campos. */
export const safeLog = {
  info(ctx: Record<string, unknown>, msg: string): void {
    logger.info(sanitizeLogContext(ctx), msg);
  },
  warn(ctx: Record<string, unknown>, msg: string): void {
    logger.warn(sanitizeLogContext(ctx), msg);
  },
  error(ctx: Record<string, unknown>, msg: string): void {
    logger.error(sanitizeLogContext(ctx), msg);
  },
  debug(ctx: Record<string, unknown>, msg: string): void {
    logger.debug(sanitizeLogContext(ctx), msg);
  },
};

/** Lista de campos seguros (exportada para testes). */
export { SAFE_LOG_FIELDS };
