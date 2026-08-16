import { pgTable, text, serial, integer, timestamp, boolean } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

// Tokens de recuperação de senha — uso único, expira em 1 hora.
// SEGURANÇA: token cru fica apenas no link; banco guarda SHA-256.
// ANTIPADRÃO EVITADO: o endpoint de solicitação retorna 200 mesmo se
//   o e-mail não existir — nunca confirme a existência de uma conta.
// Ao usar um token: marca used=true E revoga todos os refresh_tokens
//   do usuário, forçando novo login em todos os dispositivos.
export const passwordResetsTable = pgTable("password_resets", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  used: boolean("used").notNull().default(false),
  usedAt: timestamp("used_at", { withTimezone: true }),
  requestIp: text("request_ip"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type PasswordReset = typeof passwordResetsTable.$inferSelect;
export type InsertPasswordReset = typeof passwordResetsTable.$inferInsert;
