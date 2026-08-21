import {
  pgTable,
  text,
  serial,
  integer,
  timestamp,
  pgEnum,
} from "drizzle-orm/pg-core";
import { patientsTable } from "./patients";
import { familiesTable } from "./families";
import { caregiversTable } from "./caregivers";

/**
 * Acesso do PACIENTE ao próprio aparelho — ZELO-58.
 *
 * O paciente nunca vira uma conta: a spec é explícita que "a pessoa
 * cuidada não precisa do app", e cadastro/senha/recuperação para um idoso
 * são justamente a barreira que o produto evita. O que existe aqui é um
 * token de dispositivo com escopo mínimo — duas rotas, nada além.
 *
 * NÃO é um papel na matriz de cuidadores (caregiver_role): aquele valor
 * entra no JWT e governa requireCapability, e enfiar o paciente ali daria
 * a ele, por construção, a superfície inteira de um cuidador.
 *
 * DOIS MOMENTOS, UM REGISTRO — mesma ideia de caregiver_invites:
 *   1. `pending`: o cuidador gera um LINK de ativação, curto (24h) e de uso
 *      único, e manda pro paciente. `tokenHash` guarda o hash do token do link.
 *   2. `active`: o paciente abre o link no aparelho DELE; o servidor emite um
 *      token de DISPOSITIVO novo, de vida longa, e `tokenHash` passa a
 *      guardar o hash desse. O token do link deixa de existir — não dá pra
 *      reaproveitar um link já usado.
 *
 * SEGURANÇA: como em caregiver_invites e export_tokens, o banco guarda
 * apenas SHA-256 do token. Um dump não permite entrar no lugar de ninguém.
 */
export const patientAccessStatusEnum = pgEnum("patient_access_status", [
  "pending", // link enviado, ainda não aberto pelo paciente
  "active",  // aparelho ativado e em uso
  "revoked", // cuidador revogou — derruba o aparelho na requisição seguinte
]);

export const patientAccessTokensTable = pgTable("patient_access_tokens", {
  id: serial("id").primaryKey(),
  patientId: integer("patient_id")
    .notNull()
    .references(() => patientsTable.id, { onDelete: "cascade" }),
  // Redundante com o paciente, mas carregado no token de propósito: o
  // isolamento por família é invariante do produto (REQ-002) e não pode
  // depender de um join a mais pra ser aplicado.
  familyId: integer("family_id")
    .notNull()
    .references(() => familiesTable.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  status: patientAccessStatusEnum("status").notNull().default("pending"),
  // Só vale enquanto `pending` — o token de dispositivo, depois de ativado,
  // não expira sozinho; ele acaba quando o cuidador revoga ou o paciente sai.
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  activatedAt: timestamp("activated_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  // Pro cuidador reconhecer o aparelho na lista ("usado pela última vez
  // ontem"). Nunca identifica pessoa — é só o user-agent resumido.
  deviceLabel: text("device_label"),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  // Quem gerou o acesso continua sendo o responsável pelos registros feitos
  // por ali (dose_records.caregiverId) — a auditoria não muda com esta
  // história, só o rótulo exibido, que já era do paciente desde a ZELO-40.
  createdByCaregiverId: integer("created_by_caregiver_id")
    .notNull()
    .references(() => caregiversTable.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type PatientAccessToken = typeof patientAccessTokensTable.$inferSelect;
export type InsertPatientAccessToken = typeof patientAccessTokensTable.$inferInsert;
