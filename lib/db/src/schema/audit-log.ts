import {
  pgTable,
  serial,
  integer,
  timestamp,
  text,
  pgEnum,
} from "drizzle-orm/pg-core";

// LOG DE AUDITORIA IMUTÁVEL
// Este log NUNCA pode ser editado nem apagado por ninguém — nem por engano.
// Garantido por:
// 1. Sem UPDATE ou DELETE nas rotas de API (somente INSERT e SELECT)
// 2. Sem softDelete, sem updatedAt — imutável por design de esquema
// 3. Rota de API retorna 405 para qualquer tentativa de mutação
//
// O diff armazena apenas campos não-sensíveis — nomes de medicamento,
// condições de saúde e identificadores de paciente NÃO aparecem no diff.
export const actorTypeEnum = pgEnum("actor_type", ["caregiver", "system"]);
export const auditActionEnum = pgEnum("audit_action", [
  "created",
  "updated",
  "deleted",
  "accessed",
]);

export const auditLogTable = pgTable("audit_log", {
  id: serial("id").primaryKey(),
  familyId: integer("family_id")
    .notNull(),
  entityType: text("entity_type").notNull(), // ex: "treatment", "dose_record"
  entityId: text("entity_id").notNull(),
  action: auditActionEnum("action").notNull(),
  actorId: text("actor_id"),
  actorType: actorTypeEnum("actor_type").notNull().default("system"),
  diff: text("diff"), // JSON de campos seguros (sem dados clínicos)
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  // SEM updatedAt — imutável por design
});

// Sem insertSchema com omit de updatedAt porque esse campo não existe.
// Para criar entradas: usar db.insert(auditLogTable).values({...}) diretamente.
export type AuditLogEntry = typeof auditLogTable.$inferSelect;
export type InsertAuditLogEntry = typeof auditLogTable.$inferInsert;
