import {
  pgTable,
  text,
  serial,
  integer,
  timestamp,
  boolean,
} from "drizzle-orm/pg-core";
import { usersTable } from "./users";

// Sessões web — criadas no login, destruídas no logout.
// sessionToken é guardado no cookie httpOnly; o valor armazenado
// é um hash SHA-256 do token para que um dump do banco não baste
// para sequestrar sessões.
export const sessionsTable = pgTable("sessions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  // hash SHA-256 do token — o token cru fica apenas no cookie do cliente
  sessionTokenHash: text("session_token_hash").notNull().unique(),
  userAgent: text("user_agent"),
  ipAddress: text("ip_address"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  // invalidated = true após logout explícito; as queries ignoram sessões inválidas
  invalidated: boolean("invalidated").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Session = typeof sessionsTable.$inferSelect;
export type InsertSession = typeof sessionsTable.$inferInsert;
