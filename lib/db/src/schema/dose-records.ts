import {
  pgTable,
  serial,
  integer,
  timestamp,
  text,
  pgEnum,
  unique,
  boolean,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { scheduledDosesTable } from "./scheduled-doses";
import { patientsTable } from "./patients";
import { caregiversTable } from "./caregivers";

export const doseOutcomeEnum = pgEnum("dose_outcome", ["taken", "skipped", "postponed"]);

// REGRA DE INTEGRIDADE CRÍTICA #2:
// É estruturalmente impossível existir mais de um registro de resultado
// para a mesma dose agendada. O índice único abaixo garante isso
// NO NÍVEL DO BANCO DE DADOS.
// Isso previne que dois cuidadores registrem a mesma dose ao mesmo tempo
// e causem duplicidade. O segundo INSERT recebe um erro de constraint —
// a aplicação trata como "já registrado" e responde 409.
export const doseRecordsTable = pgTable(
  "dose_records",
  {
    id: serial("id").primaryKey(),
    scheduledDoseId: integer("scheduled_dose_id")
      .notNull()
      .references(() => scheduledDosesTable.id, { onDelete: "cascade" }),
    patientId: integer("patient_id")
      .notNull()
      .references(() => patientsTable.id, { onDelete: "cascade" }),
    caregiverId: integer("caregiver_id")
      .notNull()
      .references(() => caregiversTable.id),
    takenAt: timestamp("taken_at", { withTimezone: true }).notNull(),
    outcome: doseOutcomeEnum("outcome").notNull().default("taken"),
    // Só preenchido quando outcome="postponed" — o novo horário que o
    // cuidador pediu. Puramente informativo nesta história (sem
    // reagendamento automático nem notificação — fora de escopo aqui).
    postponedTo: timestamp("postponed_to", { withTimezone: true }),
    // ZELO-24: só preenchido quando o registro está fora da janela
    // retroativa sem justificativa da família — texto livre, neutro, sem
    // lista de motivos pré-definidos (a spec proíbe explicitamente julgar).
    justification: text("justification"),
    notes: text("notes"),
    // ZELO-40: caregiverId continua sendo o cuidador de verdade (quem
    // ativou o modo idoso naquele dispositivo) — auditoria não perde nada.
    // Esta flag só muda o RÓTULO mostrado aos outros cuidadores: "✓ 08:00
    // — Dona Maria" em vez do nome de quem estava logado no aparelho.
    registeredViaElderMode: boolean("registered_via_elder_mode").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),

    /**
     * ── Correção de um registro — Issue #136 ────────────────────────────
     *
     * ═══════════════════════════════════════════════════════════════════
     * CORRIGIR NÃO É APAGAR, E A DIFERENÇA É O PRODUTO INTEIRO.
     *
     * Até 60 s depois de registrar existe o **desfazer** (#135): ele apaga
     * a linha, porque o toque errado ainda é o "agora" da pessoa.
     *
     * Passado esse prazo, um registro de dose é **registro clínico**.
     * Apagá-lo destrói informação — some quem registrou, some quando, some
     * que houve um engano. O que se faz com registro clínico errado é
     * **emendar deixando rastro**, e é para isso que estas duas colunas
     * existem.
     * ═══════════════════════════════════════════════════════════════════
     *
     * ── Por que duas colunas, se o audit_log já guarda tudo ─────────────
     *
     * O `audit_log` guarda o antes e o depois, e continua sendo a fonte
     * completa. Mas ele é *append-only* e cresce sem parar: descobrir "esta
     * linha foi corrigida?" por lá seria uma consulta por dose, em toda
     * abertura da tela do dia.
     *
     * Estas duas respondem a pergunta barata. **Registro corrigido sem
     * marca visível é pior que registro errado** — quem lê passa a confiar
     * no que não deve —, e é a tela que precisa da resposta rápida.
     */
    correctedAt: timestamp("corrected_at", { withTimezone: true }),
    /**
     * Quem emendou. `set null` e não `cascade`: se a pessoa sair da
     * família, o registro **não** pode sumir junto — ele é do paciente, não
     * de quem digitou. Perde-se o nome, nunca a dose.
     */
    correctedByCaregiverId: integer("corrected_by_caregiver_id").references(
      () => caregiversTable.id,
      { onDelete: "set null" },
    ),
  },
  (table) => ({
    // UNIQUE garante: apenas 1 registro por dose agendada — sem duplicidade
    uniquePerScheduledDose: unique("uq_dose_record_per_scheduled_dose").on(
      table.scheduledDoseId
    ),
  })
);

export const insertDoseRecordSchema = createInsertSchema(
  doseRecordsTable
).omit({ id: true, createdAt: true });

export type InsertDoseRecord = z.infer<typeof insertDoseRecordSchema>;
export type DoseRecord = typeof doseRecordsTable.$inferSelect;
