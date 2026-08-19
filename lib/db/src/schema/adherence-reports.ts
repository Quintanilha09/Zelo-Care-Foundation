import {
  pgTable, serial, integer, text, date, timestamp,
} from "drizzle-orm/pg-core";
import { patientsTable } from "./patients";
import { familiesTable } from "./families";
import { caregiversTable } from "./caregivers";

/**
 * Relatório de adesão em PDF — ZELO (ZELO-35).
 *
 * Mesmo padrão de export-tokens.ts (link assinado pelo próprio token, sem
 * cookie/JWT extra) — mas expira em 7 dias, não 1 hora, e NÃO é de uso
 * único: o médico pode abrir o link mais de uma vez dentro da janela.
 * O PDF em si fica gravado (base64, mesmo padrão de photo-extractions.ts)
 * pra servir sempre o MESMO documento que foi gerado — sem risco de o
 * conteúdo mudar entre um acesso e outro se o histórico for editado depois.
 */
export const adherenceReportsTable = pgTable("adherence_reports", {
  id: serial("id").primaryKey(),
  patientId: integer("patient_id")
    .notNull()
    .references(() => patientsTable.id, { onDelete: "cascade" }),
  familyId: integer("family_id")
    .notNull()
    .references(() => familiesTable.id, { onDelete: "cascade" }),
  generatedByCaregiverId: integer("generated_by_caregiver_id")
    .references(() => caregiversTable.id, { onDelete: "set null" }),
  periodStart: date("period_start", { mode: "string" }).notNull(),
  periodEnd: date("period_end", { mode: "string" }).notNull(),
  pdfData: text("pdf_data").notNull(), // base64
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  accessedAt: timestamp("accessed_at", { withTimezone: true }), // 1º acesso pelo link público, só pra métrica — nunca invalida o link
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type AdherenceReport = typeof adherenceReportsTable.$inferSelect;
export type InsertAdherenceReport = typeof adherenceReportsTable.$inferInsert;
