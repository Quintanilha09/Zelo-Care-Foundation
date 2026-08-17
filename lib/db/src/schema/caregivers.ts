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
import { usersTable } from "./users";
import { patientsTable } from "./patients";

// Papéis de cuidador:
// - primary_caregiver: responsável principal, acesso total
// - caregiver: cuidador regular com acesso a registro de doses
// - hired_caregiver: cuidador contratado, acesso a registro
// - observer: parente distante que só acompanha, sem ação
export const caregiverRoleEnum = pgEnum("caregiver_role", [
  "primary_caregiver",
  "caregiver",
  "hired_caregiver",
  "observer",
]);

export const caregiversTable = pgTable("caregivers", {
  id: serial("id").primaryKey(),
  familyId: integer("family_id")
    .notNull()
    .references(() => familiesTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  email: text("email"),
  // Vínculo com conta de usuário — preenchido no cadastro ou ao aceitar convite.
  // Nullable: um cuidador pode existir sem conta (pré-convite, dados migrados).
  userId: integer("user_id").references(() => usersTable.id, { onDelete: "set null" }),
  role: caregiverRoleEnum("role").notNull().default("caregiver"),
  // ZELO-22: paciente ativo persiste entre sessões e dispositivos — por
  // cuidador, não por família (dois cuidadores podem estar olhando pacientes
  // diferentes ao mesmo tempo). set null se o paciente for excluído, nunca
  // cascade — perder a seleção não deveria apagar mais nada.
  selectedPatientId: integer("selected_patient_id").references(() => patientsTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const insertCaregiverSchema = createInsertSchema(caregiversTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertCaregiver = z.infer<typeof insertCaregiverSchema>;
export type Caregiver = typeof caregiversTable.$inferSelect;
