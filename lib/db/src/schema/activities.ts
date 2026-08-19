import {
  pgTable,
  serial,
  integer,
  timestamp,
  text,
  boolean,
  pgEnum,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { patientsTable } from "./patients";
import { caregiversTable } from "./caregivers";

// ZELO-37: registro SIMPLES de feito/não-feito — sem meta, sem streak, sem
// cobrança. "Rotina", não "desempenho".
export const activityTypeEnum = pgEnum("activity_type", [
  "physiotherapy",
  "bath",
  "feeding",
  "walk",
  "other",
]);

export const activitiesTable = pgTable("activities", {
  id: serial("id").primaryKey(),
  patientId: integer("patient_id")
    .notNull()
    .references(() => patientsTable.id, { onDelete: "cascade" }),
  type: activityTypeEnum("type").notNull(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
  done: boolean("done").notNull().default(true),
  notes: text("notes"),
  caregiverId: integer("caregiver_id").references(() => caregiversTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertActivitySchema = createInsertSchema(activitiesTable).omit({
  id: true, createdAt: true,
});

export type InsertActivity = z.infer<typeof insertActivitySchema>;
export type Activity = typeof activitiesTable.$inferSelect;
