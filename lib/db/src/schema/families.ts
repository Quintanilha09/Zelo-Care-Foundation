import { pgTable, text, serial, integer, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Tenant raiz — toda família é um tenant isolado.
export const familiesTable = pgTable("families", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  // ZELO-24: janela de registro retroativo sem justificativa, em horas.
  // Fora dela, ainda dá pra registrar — só pede uma justificativa curta.
  retroactiveWindowHours: integer("retroactive_window_hours").notNull().default(24),
  // ZELO-28: desligado por padrão — o texto do push nunca nomeia o
  // medicamento na tela de bloqueio (qualquer pessoa perto do celular veria
  // um dado de saúde). Ligar é escolha explícita da família, não do sistema.
  showMedicationInPush: boolean("show_medication_in_push").notNull().default(false),
  // ZELO-30: janela de silêncio noturno — dose de madrugada não precisa
  // acordar a família inteira no T+30 (tratamento "standard"; "critical"
  // ignora isto de propósito). "HH:mm" (mesmo formato de
  // scheduled_local_time) em vez de um tipo TIME do Postgres — evita
  // complexidade de fuso na coluna em si, a comparação já é feita no fuso
  // do PACIENTE em código, não no do banco.
  quietHoursEnabled: boolean("quiet_hours_enabled").notNull().default(true),
  quietHoursStart: text("quiet_hours_start").notNull().default("22:00"),
  quietHoursEnd: text("quiet_hours_end").notNull().default("07:00"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const insertFamilySchema = createInsertSchema(familiesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertFamily = z.infer<typeof insertFamilySchema>;
export type Family = typeof familiesTable.$inferSelect;
