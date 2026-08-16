import {
  pgTable,
  text,
  serial,
  integer,
  timestamp,
  pgEnum,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { familiesTable } from "./families";

export const medicationFormEnum = pgEnum("medication_form", [
  "tablet",
  "capsule",
  "liquid",
  "injection",
  "patch",
  "drops",
  "inhaler",
  "other",
]);

// Medicamento catalogado por família — privacidade por tenant.
// O nome do medicamento NUNCA aparece em logs de aplicação.
export const medicationsTable = pgTable("medications", {
  id: serial("id").primaryKey(),
  familyId: integer("family_id")
    .notNull()
    .references(() => familiesTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(), // CAMPO SENSÍVEL — nunca logar
  activeIngredient: text("active_ingredient"), // CAMPO SENSÍVEL — nunca logar
  form: medicationFormEnum("form").notNull().default("tablet"),
  strength: text("strength"), // ex: "50mg", "5mg/ml"
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertMedicationSchema = createInsertSchema(medicationsTable).omit({
  id: true,
  createdAt: true,
});

export type InsertMedication = z.infer<typeof insertMedicationSchema>;
export type Medication = typeof medicationsTable.$inferSelect;
