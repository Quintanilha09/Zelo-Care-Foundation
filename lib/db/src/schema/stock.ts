import {
  pgTable,
  serial,
  integer,
  timestamp,
  text,
  real,
  date,
  unique,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { patientsTable } from "./patients";
import { medicationsTable } from "./medications";

export const stockEntriesTable = pgTable(
  "stock_entries",
  {
    id: serial("id").primaryKey(),
    patientId: integer("patient_id")
      .notNull()
      .references(() => patientsTable.id, { onDelete: "cascade" }),
    medicationId: integer("medication_id")
      .notNull()
      .references(() => medicationsTable.id, { onDelete: "cascade" }),
    quantityRemaining: real("quantity_remaining").notNull(),
    unit: text("unit").notNull(), // "comprimidos", "ml", "unidades"
    // ZELO-34: quando a receita vence antes do estoque acabar, o alerta
    // precisa antecipar — consulta nova demora a marcar. Nula quando não
    // informada (a maioria dos casos, receita sem prazo definido).
    prescriptionExpiresAt: date("prescription_expires_at", { mode: "string" }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => ({
    uniquePatientMedication: unique("uq_stock_patient_medication").on(
      table.patientId,
      table.medicationId
    ),
  })
);

export const insertStockEntrySchema = createInsertSchema(
  stockEntriesTable
).omit({ id: true, updatedAt: true });

export type InsertStockEntry = z.infer<typeof insertStockEntrySchema>;
export type StockEntry = typeof stockEntriesTable.$inferSelect;
