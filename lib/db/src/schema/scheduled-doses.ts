import {
  pgTable,
  serial,
  integer,
  timestamp,
  pgEnum,
  unique,
  text,
  date,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { treatmentsTable } from "./treatments";
import { patientsTable } from "./patients";

export const scheduledDoseStatusEnum = pgEnum("scheduled_dose_status", [
  "pending",
  "taken",
  "skipped",
  "late",
  // ZELO-23: adiada é uma decisão do cuidador (via dose_records.outcome),
  // "late"/perdida continua exclusivamente atribuída pelo sistema.
  "postponed",
]);

// REGRA DE INTEGRIDADE CRÍTICA #1:
// É estruturalmente impossível agendar a mesma dose duas vezes para o
// mesmo tratamento no mesmo horário. O índice único abaixo garante isso
// NO NÍVEL DO BANCO DE DADOS — não apenas no código da aplicação.
// Isso previne lembretes duplicados.
export const scheduledDosesTable = pgTable(
  "scheduled_doses",
  {
    id: serial("id").primaryKey(),
    treatmentId: integer("treatment_id")
      .notNull()
      .references(() => treatmentsTable.id, { onDelete: "cascade" }),
    patientId: integer("patient_id")
      .notNull()
      .references(() => patientsTable.id, { onDelete: "cascade" }),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull(),
    // Guardado ao lado de scheduledAt (UTC, usado pela fila): a intenção do
    // usuário ("8:00 no relógio de parede do paciente"), imune a uma futura
    // mudança de regra de fuso — ver lib/scheduling/src/timezone.ts (ZELO-19).
    scheduledLocalDate: date("scheduled_local_date", { mode: "string" }).notNull(),
    scheduledLocalTime: text("scheduled_local_time").notNull(),
    status: scheduledDoseStatusEnum("status").notNull().default("pending"),
    dose: text("dose"), // cópia do treatment.dose no momento do agendamento
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => ({
    // UNIQUE garante: mesmo tratamento, mesmo horário → apenas 1 dose agendada
    uniqueTreatmentTime: unique("uq_treatment_scheduled_at").on(
      table.treatmentId,
      table.scheduledAt
    ),
  })
);

export const insertScheduledDoseSchema = createInsertSchema(
  scheduledDosesTable
).omit({ id: true, createdAt: true, updatedAt: true });

export type InsertScheduledDose = z.infer<typeof insertScheduledDoseSchema>;
export type ScheduledDose = typeof scheduledDosesTable.$inferSelect;
