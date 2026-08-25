import {
  pgTable,
  text,
  serial,
  integer,
  timestamp,
  pgEnum,
} from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { patientsTable } from "./patients";

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
  // QUI-6 — fotografar e filmar o paciente.
  //
  // É um tipo SEPARADO de `health_data_processing`, e a separação não é
  // burocracia: quem aceitou compartilhar que a mãe toma Losartana NÃO
  // aceitou, com isso, que ela seja fotografada na cama. São finalidades
  // diferentes, e a LGPD trata consentimento por finalidade.
  //
  // Reaproveitar o consentimento de saúde "para simplificar" é exatamente o
  // atalho que uma auditoria encontra. Ver routes/image-consent.ts.
  "image_capture",
]);

// Quem está consentindo, quando o consentimento é sobre dado de saúde de um
// paciente específico: o próprio paciente (titular) ou um representante legal
// agindo por ele (caso comum — idoso sem capacidade de decidir sozinho).
export const consentGivenByEnum = pgEnum("consent_given_by", [
  "self",                 // o próprio titular consentiu
  "legal_representative", // representante legal consentiu em nome do titular
]);

export const consentRecordsTable = pgTable("consent_records", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  // Preenchido apenas para consentType = health_data_processing vinculado a um
  // paciente específico. Consentimentos de conta (terms_of_service, etc.)
  // continuam com patientId nulo — são sobre o usuário, não sobre um titular.
  patientId: integer("patient_id").references(() => patientsTable.id, {
    onDelete: "cascade",
  }),
  givenBy: consentGivenByEnum("given_by"),
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
