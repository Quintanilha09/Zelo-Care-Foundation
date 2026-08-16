import {
  pgTable,
  serial,
  integer,
  timestamp,
  text,
  pgEnum,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { familiesTable } from "./families";

export const notificationTypeEnum = pgEnum("notification_type", [
  "dose_reminder",
  "dose_late",
  "appointment_reminder",
  "low_stock",
  "system",
]);

// Timestamps separados por intenção:
// sentAt: quando o sistema enviou
// deliveredAt: confirmação de entrega do push
// ackedAt: quando o usuário tocou na notificação
//
// escalationLevel: 0=primeiro envio, 1=15min, 2=30min, 3=60min
// Precisa de relógio controlável (ver clock.ts) para testar sem esperar de verdade.
export const notificationsTable = pgTable("notifications", {
  id: serial("id").primaryKey(),
  familyId: integer("family_id")
    .notNull()
    .references(() => familiesTable.id, { onDelete: "cascade" }),
  patientId: integer("patient_id"),
  caregiverId: integer("caregiver_id"),
  type: notificationTypeEnum("type").notNull(),
  title: text("title").notNull(),
  body: text("body"),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  ackedAt: timestamp("acked_at", { withTimezone: true }),
  escalationLevel: integer("escalation_level").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertNotificationSchema = createInsertSchema(
  notificationsTable
).omit({ id: true, createdAt: true });

export type InsertNotification = z.infer<typeof insertNotificationSchema>;
export type Notification = typeof notificationsTable.$inferSelect;
