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
import { scheduledDosesTable } from "./scheduled-doses";
import { patientsTable } from "./patients";
import { caregiversTable } from "./caregivers";

export const doseOutcomeEnum = pgEnum("dose_outcome", ["taken", "skipped", "postponed"]);

// REGRA DE INTEGRIDADE CRÍTICA #2:
// É estruturalmente impossível existir mais de um registro de resultado
// para a mesma dose agendada. O índice único abaixo garante isso
// NO NÍVEL DO BANCO DE DADOS.
// Isso previne que dois cuidadores registrem a mesma dose ao mesmo tempo
// e causem duplicidade. O segundo INSERT recebe um erro de constraint —
// a aplicação trata como "já registrado" e responde 409.
export const doseRecordsTable = pgTable(
  "dose_records",
  {
    id: serial("id").primaryKey(),
    scheduledDoseId: integer("scheduled_dose_id")
      .notNull()
      .references(() => scheduledDosesTable.id, { onDelete: "cascade" }),
    patientId: integer("patient_id")
      .notNull()
      .references(() => patientsTable.id, { onDelete: "cascade" }),
    caregiverId: integer("caregiver_id")
      .notNull()
      .references(() => caregiversTable.id),
    takenAt: timestamp("taken_at", { withTimezone: true }).notNull(),
    outcome: doseOutcomeEnum("outcome").notNull().default("taken"),
    // Só preenchido quando outcome="postponed" — o novo horário que o
    // cuidador pediu. Puramente informativo nesta história (sem
    // reagendamento automático nem notificação — fora de escopo aqui).
    postponedTo: timestamp("postponed_to", { withTimezone: true }),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    // UNIQUE garante: apenas 1 registro por dose agendada — sem duplicidade
    uniquePerScheduledDose: unique("uq_dose_record_per_scheduled_dose").on(
      table.scheduledDoseId
    ),
  })
);

export const insertDoseRecordSchema = createInsertSchema(
  doseRecordsTable
).omit({ id: true, createdAt: true });

export type InsertDoseRecord = z.infer<typeof insertDoseRecordSchema>;
export type DoseRecord = typeof doseRecordsTable.$inferSelect;
