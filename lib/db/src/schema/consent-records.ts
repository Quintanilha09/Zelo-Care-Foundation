import {
  pgTable,
  text,
  serial,
  integer,
  timestamp,
  pgEnum,
} from "drizzle-orm/pg-core";
import { usersTable } from "./users";

// Registros de consentimento LGPD — imutáveis por design.
// Cada consentimento é um INSERT; nunca há UPDATE.
// Para revogar: INSERT novo com consentGiven=false.
// Isso preserva o histórico completo de consentimentos e revogações,
// necessário para demonstrar conformidade à ANPD.
//
// consentType: qual dado/finalidade foi consentido
// version: versão do texto do termo aceito (ex: "v2.1")
// ipAddress: obrigatório pela LGPD para prova de consentimento informado
export const consentTypeEnum = pgEnum("consent_type", [
  "terms_of_service",       // Termos de Uso
  "privacy_policy",         // Política de Privacidade
  "health_data_processing", // Tratamento de dados de saúde (Art. 11 LGPD)
  "marketing",              // Comunicações de marketing
  "data_sharing",           // Compartilhamento com terceiros
]);

export const consentRecordsTable = pgTable("consent_records", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  consentType: consentTypeEnum("consent_type").notNull(),
  consentGiven: text("consent_given").notNull(), // "true" | "false" — string para auditoria
  version: text("version").notNull(),            // ex: "v2.1" — versão do texto do termo
  ipAddress: text("ip_address").notNull(),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  // SEM updatedAt — imutável por design, como audit_log
});

export type ConsentRecord = typeof consentRecordsTable.$inferSelect;
export type InsertConsentRecord = typeof consentRecordsTable.$inferInsert;
