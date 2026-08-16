import { pgTable, text, serial, integer, timestamp, boolean } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

// Tokens de verificação de e-mail — enviados ao cadastrar ou ao pedir reenvio.
// SEGURANÇA: o token cru fica apenas no link enviado ao usuário.
//            O banco guarda só o SHA-256 do token.
// LIMITE: um userId pode ter múltiplos tokens ativos (reenvios) —
//         a verificação de qualquer um deles é válida.
export const emailVerificationsTable = pgTable("email_verifications", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  used: boolean("used").notNull().default(false),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type EmailVerification = typeof emailVerificationsTable.$inferSelect;
export type InsertEmailVerification = typeof emailVerificationsTable.$inferInsert;
