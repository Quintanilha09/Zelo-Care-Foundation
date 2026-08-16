import {
  pgTable,
  text,
  serial,
  integer,
  timestamp,
  boolean,
} from "drizzle-orm/pg-core";
import { usersTable } from "./users";

// Tokens de renovação revogáveis individualmente.
// Permite que o usuário revogue o acesso de um dispositivo específico
// sem deslogar os outros — crucial para o caso "perdi o celular".
//
// tokenHash: hash SHA-256 do token cru (o token cru fica só no cliente)
// deviceLabel: "iPhone da Ana", "Tablet do quarto" — label do usuário
// revoked: se true, o token está inválido independente de expiresAt
// revokedAt + revokedReason: para auditoria de revogação
export const refreshTokensTable = pgTable("refresh_tokens", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  deviceLabel: text("device_label"),
  userAgent: text("user_agent"),
  ipAddress: text("ip_address"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revoked: boolean("revoked").notNull().default(false),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  revokedReason: text("revoked_reason"), // "user_logout", "admin", "lost_device"
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }).notNull().defaultNow(),
});

export type RefreshToken = typeof refreshTokensTable.$inferSelect;
export type InsertRefreshToken = typeof refreshTokensTable.$inferInsert;
