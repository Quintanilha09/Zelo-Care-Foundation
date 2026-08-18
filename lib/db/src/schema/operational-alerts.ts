import { pgTable, serial, timestamp, text, real, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Saúde operacional do SISTEMA inteiro — ZELO-32.
 *
 * Diferente de toda outra tabela deste schema, não tem familyId: a pergunta
 * aqui nunca é "esta família está bem", é "o serviço como um todo está
 * entregando o que promete" (>99% de entrega, spec §3.3). `notifications`
 * responde "esta dose, este cuidador"; esta tabela responde "a última hora,
 * agregada".
 *
 * Uma linha = um disparo de alerta. `resolvedAt` nulo = alerta ainda ativo.
 * No máximo 1 linha ativa por `type` de cada vez — o monitor (ver
 * lib/operational-monitor.ts) checa antes de inserir, não deixa acumular
 * uma linha nova a cada execução enquanto a condição persistir.
 */
export const operationalAlertTypeEnum = pgEnum("operational_alert_type", [
  "delivery_rate", // taxa de entrega (delivered/sent) da última hora abaixo do limite
  "queue_stuck", // job(s) na fila além do horário esperado + folga
  "no_send_window", // nenhum envio numa janela em que deveria ter havido dose agendada
]);

export const operationalAlertsTable = pgTable("operational_alerts", {
  id: serial("id").primaryKey(),
  type: operationalAlertTypeEnum("type").notNull(),
  // Sempre agregado — nunca nome de paciente, cuidador ou medicamento
  // (o painel que lê isto não pode vazar dado pessoal, critério de aceite).
  message: text("message").notNull(),
  metricValue: real("metric_value"), // ex.: 0.83 (83% de entrega observada)
  thresholdValue: real("threshold_value"), // ex.: 0.95 (limite configurado)
  triggeredAt: timestamp("triggered_at", { withTimezone: true }).notNull(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertOperationalAlertSchema = createInsertSchema(operationalAlertsTable).omit({
  id: true,
  createdAt: true,
});

export type InsertOperationalAlert = z.infer<typeof insertOperationalAlertSchema>;
export type OperationalAlert = typeof operationalAlertsTable.$inferSelect;
