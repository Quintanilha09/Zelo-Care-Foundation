import {
  pgTable,
  serial,
  integer,
  timestamp,
  text,
  pgEnum,
  unique,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { familiesTable } from "./families";
import { treatmentsTable } from "./treatments";
import { scheduledDosesTable } from "./scheduled-doses";

export const notificationTypeEnum = pgEnum("notification_type", [
  "dose_reminder",
  "dose_late",
  "appointment_reminder",
  "low_stock",
  "system",
  // ZELO-20: aviso neutro de véspera/encerramento de tratamento temporário —
  // nunca opina se deve continuar ou parar, só informa a data.
  "treatment_ending",
  // ZELO-20: lembrete periódico (6 meses) para tratamento contínuo — "vale
  // conferir a receita", nunca uma recomendação clínica.
  "continuous_review",
]);

// Timestamps separados por intenção:
// sentAt: quando o sistema enviou
// deliveredAt: confirmação de entrega do push
// ackedAt: quando o usuário tocou na notificação
//
// escalationLevel: 0=primeiro envio, 1=15min, 2=30min, 3=60min
// Precisa de relógio controlável (ver clock.ts) para testar sem esperar de verdade.
export const notificationsTable = pgTable(
  "notifications",
  {
    id: serial("id").primaryKey(),
    familyId: integer("family_id")
      .notNull()
      .references(() => familiesTable.id, { onDelete: "cascade" }),
    patientId: integer("patient_id"),
    caregiverId: integer("caregiver_id"),
    // ZELO-20: correlaciona o aviso a um tratamento específico — necessário
    // pra saber, ao confirmar/tocar a notificação, qual lastReviewedAt zerar.
    treatmentId: integer("treatment_id").references(() => treatmentsTable.id, { onDelete: "cascade" }),
    // ZELO-27: correlaciona o lembrete a UMA dose agendada específica — é a
    // base da chave de idempotência (junto de caregiverId+escalationLevel,
    // ver uniqueReminderPerCaregiverLevel). Nula para os outros tipos de
    // notificação (aviso de tratamento etc.), que não são por dose.
    scheduledDoseId: integer("scheduled_dose_id").references(() => scheduledDosesTable.id, { onDelete: "cascade" }),
    type: notificationTypeEnum("type").notNull(),
    title: text("title").notNull(),
    body: text("body"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    ackedAt: timestamp("acked_at", { withTimezone: true }),
    escalationLevel: integer("escalation_level").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    // REGRA DE INTEGRIDADE: processar o mesmo job de lembrete várias vezes
    // (reprocessamento do pg-boss, retentativa, etc.) nunca pode gerar um
    // segundo push pro MESMO cuidador na MESMA dose no MESMO nível de
    // escalonamento. NULL em scheduledDoseId nunca colide (semântica padrão
    // do Postgres) — só afeta linhas de lembrete de dose de verdade.
    uniqueReminderPerCaregiverLevel: unique("uq_notif_dose_caregiver_level").on(
      table.scheduledDoseId,
      table.caregiverId,
      table.escalationLevel
    ),
  })
);

export const insertNotificationSchema = createInsertSchema(
  notificationsTable
).omit({ id: true, createdAt: true });

export type InsertNotification = z.infer<typeof insertNotificationSchema>;
export type Notification = typeof notificationsTable.$inferSelect;
