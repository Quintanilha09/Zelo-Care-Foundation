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
import { familiesTable } from "./families";

// ZELO-56: "professional" é o tier de quem cuida de muita gente sem ser
// instituição (cuidador autônomo, acompanhante, home care pequeno).
// "basic" e "premium" vêm da fundação; hoje os dois resolvem para o plano
// Família — ver api-server/src/lib/plan-limits.ts, que é a fonte única do
// mapeamento assinatura → limites.
//
// Cobrança institucional (ILPI, casa de repouso) NÃO entra aqui: ela é por
// leito ativo/mês e com cadastro verificado manualmente, não um tier
// self-service — ver "ZELO - Extensao B2B Institucional.md" §6 e §8.
export const subscriptionPlanEnum = pgEnum("subscription_plan", [
  "free",
  "basic",
  "premium",
  "professional",
]);

export const subscriptionStatusEnum = pgEnum("subscription_status", [
  "active",
  "trialing",
  "past_due",
  "cancelled",
]);

export const subscriptionsTable = pgTable(
  "subscriptions",
  {
    id: serial("id").primaryKey(),
    familyId: integer("family_id")
      .notNull()
      .references(() => familiesTable.id, { onDelete: "cascade" }),
    plan: subscriptionPlanEnum("plan").notNull().default("free"),
    status: subscriptionStatusEnum("status").notNull().default("trialing"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    externalRef: text("external_ref"), // referência ao provedor de pagamento
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => ({
    // Uma assinatura ativa por família
    uniqueActivePerFamily: unique("uq_subscription_family").on(table.familyId),
  })
);

export const insertSubscriptionSchema = createInsertSchema(
  subscriptionsTable
).omit({ id: true, createdAt: true, updatedAt: true });

export type InsertSubscription = z.infer<typeof insertSubscriptionSchema>;
export type Subscription = typeof subscriptionsTable.$inferSelect;
