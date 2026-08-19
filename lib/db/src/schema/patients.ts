import {
  pgTable,
  text,
  serial,
  integer,
  timestamp,
  date,
  boolean,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { familiesTable } from "./families";

// timezone é obrigatório: "08:00 do paciente" precisa ser 08:00 no relógio
// do paciente, independente do fuso de quem cuida.
export const patientsTable = pgTable("patients", {
  id: serial("id").primaryKey(),
  familyId: integer("family_id")
    .notNull()
    .references(() => familiesTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  birthDate: date("birth_date", { mode: "string" }),
  timezone: text("timezone").notNull(), // ex: "America/Sao_Paulo"
  notes: text("notes"),
  // ZELO-37: "se o cuidador quiser marcar algo como preocupante, ele
  // escreve na observação — a ação do app é oferecer o contato de
  // emergência já cadastrado, encaminhar, nunca avaliar." Vive no
  // paciente (não na família): quem chamar em uma emergência pode
  // depender de qual paciente, mesmo dentro da mesma família.
  emergencyContactName: text("emergency_contact_name"),
  emergencyContactPhone: text("emergency_contact_phone"),
  // ZELO-40: liga o modo idoso (tela única, letra grande, só "Tomei") pra
  // este paciente. Ativado pelo cuidador principal — não é uma conta
  // própria do paciente, é o dispositivo entrando num modo travado usando
  // a sessão do cuidador que o ativou (ver ElderModePage no frontend).
  elderModeEnabled: boolean("elder_mode_enabled").notNull().default(false),
  // Arquivar suspende doses futuras sem apagar histórico. Nunca DELETE aqui —
  // exclusão de verdade é o fluxo de LGPD (export-deletion), não este campo.
  archived: boolean("archived").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const insertPatientSchema = createInsertSchema(patientsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertPatient = z.infer<typeof insertPatientSchema>;
export type Patient = typeof patientsTable.$inferSelect;
