import {
  pgTable, serial, integer, timestamp, text, pgEnum, boolean,
} from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { familiesTable } from "./families";

// Solicitações de exclusão de dados com janela de 7 dias de arrependimento.
//
// FLUXO:
//   1. primary_caregiver chama POST /account/deletion/request
//   2. Todos os cuidadores da família são notificados
//   3. Qualquer primary_caregiver pode cancelar com POST /account/deletion/cancel
//      dentro dos 7 dias
//   4. Após 7 dias, a exclusão definitiva executa todos os dados da família
//   5. O único rastro que sobrevive: uma linha em audit_log com
//      "data_deleted: familyId=X" (sem conteúdo dos dados)
//
// DEPOIS DA EXCLUSÃO: a linha aqui permanece (é o comprovante da exclusão)
//   mas todos os dados de paciente, tratamento e dose são apagados fisicamente.
export const deletionStatusEnum = pgEnum("deletion_status", [
  "pending",    // aguardando janela de 7 dias
  "cancelled",  // cancelado dentro da janela
  "completed",  // exclusão executada
]);

export const deletionRequestsTable = pgTable("deletion_requests", {
  id: serial("id").primaryKey(),
  familyId: integer("family_id")
    .references(() => familiesTable.id, { onDelete: "set null" }),
  requestedByUserId: integer("requested_by_user_id")
    .references(() => usersTable.id, { onDelete: "set null" }),
  status: deletionStatusEnum("status").notNull().default("pending"),
  requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
  // Exclusão definitiva só pode ocorrer após esta data
  scheduledDeletionAt: timestamp("scheduled_deletion_at", { withTimezone: true }).notNull(),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  cancelledByUserId: integer("cancelled_by_user_id"),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  // Confirmação manual obrigatória após a janela (não é automático no servidor)
  confirmed: boolean("confirmed").notNull().default(false),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type DeletionRequest = typeof deletionRequestsTable.$inferSelect;
export type InsertDeletionRequest = typeof deletionRequestsTable.$inferInsert;
