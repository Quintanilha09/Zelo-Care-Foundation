import {
  pgTable,
  text,
  serial,
  integer,
  timestamp,
  boolean,
  unique,
} from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { familiesTable } from "./families";

// Assinaturas de notificação push por dispositivo.
// Um usuário pode ter múltiplos dispositivos — cada um tem sua própria
// assinatura. A revogação de um dispositivo não afeta os outros.
//
// endpoint: URL do serviço push (FCM, APNS, Web Push)
// p256dh + auth: chaves de criptografia WebPush — nunca logar esses campos
// deviceLabel: "iPhone da Ana" — label do usuário para gerenciar dispositivos
// active: false após falha de entrega permanente (HTTP 410 do push service)
export const pushSubscriptionsTable = pgTable(
  "push_subscriptions",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    familyId: integer("family_id")
      .notNull()
      .references(() => familiesTable.id, { onDelete: "cascade" }),
    endpoint: text("endpoint").notNull(),
    // chaves criptográficas WebPush — CAMPO SENSÍVEL, nunca logar
    p256dh: text("p256dh"),
    auth: text("auth"),
    deviceLabel: text("device_label"),
    active: boolean("active").notNull().default(true),
    lastDeliveredAt: timestamp("last_delivered_at", { withTimezone: true }),
    failureCount: integer("failure_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => ({
    // Um endpoint é único por usuário — evita cadastro duplicado do mesmo dispositivo
    uniqueEndpointPerUser: unique("uq_push_endpoint_user").on(
      table.userId,
      table.endpoint
    ),
  })
);

export type PushSubscription = typeof pushSubscriptionsTable.$inferSelect;
export type InsertPushSubscription = typeof pushSubscriptionsTable.$inferInsert;
