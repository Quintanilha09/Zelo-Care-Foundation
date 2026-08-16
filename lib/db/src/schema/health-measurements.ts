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
import { patientsTable } from "./patients";
import { caregiversTable } from "./caregivers";

// AVISO CRÍTICO DE PRODUTO:
// Aferições de saúde são registros BRUTOS, sem interpretação médica.
// Não há faixa de referência, alerta, cor de risco, nem sugestão clínica.
// O médico interpreta — o ZELO só registra e exibe o número.
// Esta restrição vale para SEMPRE, em todas as fases futuras do produto.
export const measurementTypeEnum = pgEnum("measurement_type", [
  "blood_pressure",
  "blood_glucose",
  "weight",
  "temperature",
  "oxygen_saturation",
  "heart_rate",
  "other",
]);

export const healthMeasurementsTable = pgTable("health_measurements", {
  id: serial("id").primaryKey(),
  patientId: integer("patient_id")
    .notNull()
    .references(() => patientsTable.id, { onDelete: "cascade" }),
  type: measurementTypeEnum("type").notNull(),
  value: text("value"), // bruto como string: "120/80", "98.6", "75.2"
  unit: text("unit"),   // "mmHg", "mg/dL", "kg", "°C", "%", "bpm"
  measuredAt: timestamp("measured_at", { withTimezone: true }).notNull(),
  notes: text("notes"),
  caregiverId: integer("caregiver_id").references(() => caregiversTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertHealthMeasurementSchema = createInsertSchema(
  healthMeasurementsTable
).omit({ id: true, createdAt: true });

export type InsertHealthMeasurement = z.infer<
  typeof insertHealthMeasurementSchema
>;
export type HealthMeasurement = typeof healthMeasurementsTable.$inferSelect;
