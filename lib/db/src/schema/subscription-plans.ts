import {
  pgTable,
  text,
  serial,
  integer,
  boolean,
  timestamp,
  jsonb,
} from "drizzle-orm/pg-core";

// Catálogo de planos de assinatura.
// Separado da tabela `subscriptions` (instância) que referencia este catálogo.
// Permite alterar limites e preços sem tocar nas assinaturas ativas.
//
// limits: JSON livre com os limites do plano, ex:
//   { "maxPatients": 1, "maxCaregivers": 3, "historyDays": 30 }
// priceMonthly: em centavos (BRL) — inteiro evita float
export const subscriptionPlansTable = pgTable("subscription_plans", {
  id: serial("id").primaryKey(),
  slug: text("slug").notNull().unique(), // "free", "basic", "premium"
  name: text("name").notNull(),
  description: text("description"),
  priceMonthly: integer("price_monthly").notNull().default(0), // centavos BRL
  priceYearly: integer("price_yearly"),                        // centavos BRL
  limits: jsonb("limits").notNull().default({}),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type SubscriptionPlan = typeof subscriptionPlansTable.$inferSelect;
export type InsertSubscriptionPlan = typeof subscriptionPlansTable.$inferInsert;
