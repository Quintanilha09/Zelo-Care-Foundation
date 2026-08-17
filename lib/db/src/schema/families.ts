import { pgTable, text, serial, integer, timestamp } from "drizzle-orm/pg-core";
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
