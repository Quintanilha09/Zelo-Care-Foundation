import {
  pgTable,
  serial,
  integer,
  timestamp,
  text,
  pgEnum,
  jsonb,
} from "drizzle-orm/pg-core";
import { familiesTable } from "./families";
import { scheduledDosesTable } from "./scheduled-doses";

// Tabela própria de escalonamento de alerta — SEPARADA de notifications.
//
// Por que separado de notifications?
// O painel de monitoramento de entrega precisa responder a perguntas como:
// - "Quais alertas de nível 2 foram disparados hoje sem resposta?"
// - "Qual foi o tempo médio entre nível 1 e nível 2 esta semana?"
// - "Quantos alertas chegaram ao nível 3 (máximo) este mês?"
// Essas consultas exigem filtrar por nível E por trigger sem varrer toda
// a tabela de notificações, que cresce muito mais rápido.
//
// Cada linha = um disparo de escalada:
//   nível 0 = primeiro alerta (15 min após dose não registrada)
//   nível 1 = segundo alerta (30 min)
//   nível 2 = terceiro alerta (60 min)
//   nível 3 = alerta máximo (manual/supervisor)
//
// notifiedCaregiverIds: JSON array de IDs de cuidadores que receberam este nível
// deliveryStatus: "sent" | "delivered" | "failed"
// acknowledgedAt: quando algum cuidador registrou a dose (encerrou a escalada)
export const escalationLevelEnum = pgEnum("escalation_level_type", [
  "level_0", // 15 min
  "level_1", // 30 min
  "level_2", // 60 min
  "level_3", // máximo
]);

export const escalationDeliveryEnum = pgEnum("escalation_delivery_status", [
  "sent",
  "delivered",
  "failed",
  "acknowledged",
]);

export const alertEscalationsTable = pgTable("alert_escalations", {
  id: serial("id").primaryKey(),
  familyId: integer("family_id")
    .notNull()
    .references(() => familiesTable.id, { onDelete: "cascade" }),
  scheduledDoseId: integer("scheduled_dose_id")
    .notNull()
    .references(() => scheduledDosesTable.id, { onDelete: "cascade" }),
  level: escalationLevelEnum("level").notNull(),
  triggeredAt: timestamp("triggered_at", { withTimezone: true }).notNull(),
  // JSON array de IDs dos cuidadores notificados neste nível
  notifiedCaregiverIds: jsonb("notified_caregiver_ids").notNull().default([]),
  deliveryStatus: escalationDeliveryEnum("delivery_status").notNull().default("sent"),
  acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
  acknowledgedByCaregiverId: integer("acknowledged_by_caregiver_id"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type AlertEscalation = typeof alertEscalationsTable.$inferSelect;
export type InsertAlertEscalation = typeof alertEscalationsTable.$inferInsert;
