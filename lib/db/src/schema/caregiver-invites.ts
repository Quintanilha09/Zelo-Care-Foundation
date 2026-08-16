import {
  pgTable,
  text,
  serial,
  integer,
  timestamp,
  boolean,
  pgEnum,
} from "drizzle-orm/pg-core";
import { familiesTable } from "./families";
import { caregiverRoleEnum } from "./caregivers";

// Convites de cuidador por link — uso único.
//
// SEGURANÇA:
// - tokenHash: hash SHA-256 do token cru — o token cru fica apenas no link
//   enviado ao convidado. Um dump do banco não permite aceitar o convite.
// - expiresAt: convites vencem (padrão: 7 dias)
// - used: true após aceito — impede reuso mesmo dentro do prazo
// - usedAt + usedByUserId: rastreabilidade de quem aceitou
//
// O link compartilhado tem o token cru: /convite?token=<raw>
// O servidor calcula SHA-256(raw) e busca nesta tabela.
export const inviteStatusEnum = pgEnum("invite_status", [
  "pending",   // aguardando aceitação
  "accepted",  // aceito e cuidador criado
  "expired",   // passou de expiresAt sem ser usado
  "revoked",   // revogado manualmente pelo primary_caregiver
]);

export const caregiverInvitesTable = pgTable("caregiver_invites", {
  id: serial("id").primaryKey(),
  familyId: integer("family_id")
    .notNull()
    .references(() => familiesTable.id, { onDelete: "cascade" }),
  // hash SHA-256 do token cru — o token cru fica só no link enviado
  tokenHash: text("token_hash").notNull().unique(),
  invitedEmail: text("invited_email"), // opcional — convite pode ser genérico
  role: caregiverRoleEnum("role").notNull().default("caregiver"),
  used: boolean("used").notNull().default(false),
  usedAt: timestamp("used_at", { withTimezone: true }),
  usedByUserId: integer("used_by_user_id"), // FK implícita para users, adicionada pós-auth
  status: inviteStatusEnum("status").notNull().default("pending"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdByUserId: integer("created_by_user_id"), // FK implícita para users
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type CaregiverInvite = typeof caregiverInvitesTable.$inferSelect;
export type InsertCaregiverInvite = typeof caregiverInvitesTable.$inferInsert;
