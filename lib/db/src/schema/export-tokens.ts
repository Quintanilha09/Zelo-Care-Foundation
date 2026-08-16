import {
  pgTable, text, serial, integer, timestamp, boolean,
} from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { familiesTable } from "./families";

// Tokens de download para exportação de dados.
// MODELO: solicitação (POST /export) gera o snapshot e cria o token →
//         link de download (/export/download/:rawToken) consome o token
//         uma única vez.
// Expiração: 1 hora após a geração.
// O link é autenticado pelo próprio token — sem cookie, sem JWT extra.
export const exportTokensTable = pgTable("export_tokens", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  familyId: integer("family_id")
    .notNull()
    .references(() => familiesTable.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  downloaded: boolean("downloaded").notNull().default(false),
  downloadedAt: timestamp("downloaded_at", { withTimezone: true }),
  // snapshot armazena o JSON de export serializado; tamanho controlado
  // por número de pacientes — famílias típicas têm 1-3 pacientes
  snapshot: text("snapshot"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ExportToken = typeof exportTokensTable.$inferSelect;
export type InsertExportToken = typeof exportTokensTable.$inferInsert;
