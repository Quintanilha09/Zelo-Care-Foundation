import {
  pgTable,
  serial,
  integer,
  boolean,
  timestamp,
  pgEnum,
  unique,
} from "drizzle-orm/pg-core";
import { caregiversTable } from "./caregivers";
import { patientsTable } from "./patients";

// Agrupa os tipos de notification_type (notifications.ts) em categorias que
// fazem sentido pra um painel de ajustes — o cuidador não pensa em termos
// de "dose_reminder vs dose_late", pensa em "lembretes de dose".
export const notificationCategoryEnum = pgEnum("notification_category", [
  "dose", // dose_reminder, dose_late
  "appointment", // appointment_reminder
  "stock", // low_stock
  "treatment", // treatment_ending, continuous_review
  // QUI-10: aviso de momento novo no mural. É a única categoria que não é
  // sobre segurança do paciente — dose, consulta, estoque e tratamento
  // existem para nada passar batido. Esta existe para a família não perder
  // uma foto, e é justamente por isso que ela PRECISA poder ser desligada:
  // quem não quer o aviso não está abrindo mão de nada clínico.
  "moment", // moment_new
]);

// Padrão é sempre ativado — só existe linha aqui quando o cuidador
// explicitamente desliga uma categoria para um paciente. Ausência de linha
// para (caregiverId, patientId, category) significa "ativado".
export const notificationPreferencesTable = pgTable(
  "notification_preferences",
  {
    id: serial("id").primaryKey(),
    caregiverId: integer("caregiver_id")
      .notNull()
      .references(() => caregiversTable.id, { onDelete: "cascade" }),
    patientId: integer("patient_id")
      .notNull()
      .references(() => patientsTable.id, { onDelete: "cascade" }),
    category: notificationCategoryEnum("category").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => ({
    uniquePerCaregiverPatientCategory: unique("uq_notif_pref_caregiver_patient_category").on(
      table.caregiverId,
      table.patientId,
      table.category
    ),
  })
);

export type NotificationPreference = typeof notificationPreferencesTable.$inferSelect;
export type InsertNotificationPreference = typeof notificationPreferencesTable.$inferInsert;
