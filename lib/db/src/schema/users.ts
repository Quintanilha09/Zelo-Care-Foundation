import {
  pgTable,
  text,
  serial,
  timestamp,
  pgEnum,
  boolean,
} from "drizzle-orm/pg-core";

// Conta de autenticação — identidade do cuidador no sistema.
// Separada de caregivers: um usuário pode ser cuidador em múltiplas
// famílias (múltiplas entradas em caregivers com userId preenchido).
// A coluna passwordHash é reservada — a mecânica de auth (magic link,
// OAuth, senha) é decisão da fase de autenticação.
export const userStatusEnum = pgEnum("user_status", [
  "active",
  "suspended",
  "pending_verification",
]);

export const usersTable = pgTable("users", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  // passwordHash reservado — preenchido apenas se a auth usar senha
  passwordHash: text("password_hash"),
  emailVerified: boolean("email_verified").notNull().default(false),
  status: userStatusEnum("status").notNull().default("pending_verification"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type User = typeof usersTable.$inferSelect;
export type InsertUser = typeof usersTable.$inferInsert;
