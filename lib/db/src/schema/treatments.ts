import {
  pgTable,
  text,
  serial,
  integer,
  timestamp,
  date,
  pgEnum,
  jsonb,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { patientsTable } from "./patients";
import { medicationsTable } from "./medications";

// Tipos de posologia suportados:
// - times_per_day: X vezes ao dia em horários fixos
// - every_n_hours: a cada N horas
// - specific_weekdays: dias específicos da semana
// - alternate_days: dias alternados
// - cycle_with_pause: ciclo com pausa (ex: 21 dias tomando + 7 de pausa)
export const scheduleTypeEnum = pgEnum("schedule_type", [
  "times_per_day",
  "every_n_hours",
  "specific_weekdays",
  "alternate_days",
  "cycle_with_pause",
]);

export const treatmentStatusEnum = pgEnum("treatment_status", [
  "active",
  "paused",
  "finished",
  "cancelled",
]);

// ZELO-30: nem toda dose merece acordar a família inteira — vitamina não,
// anticoagulante sim. "Ajuste fino por tratamento" É a escolha do perfil em
// si, não um controle mais granular por cima dele.
// - silent: só o(s) cuidador(es) principal(is) (T+0/T+15/T+60), nunca
//   escalona pra mais gente (T+30 nunca transmite).
// - standard: cascata completa, mas T+30 não transmite durante o silêncio
//   noturno da família (families.quietHours*).
// - critical: cascata completa sempre, ignora o silêncio noturno.
export const escalationProfileEnum = pgEnum("escalation_profile", [
  "silent",
  "standard",
  "critical",
]);

export const treatmentsTable = pgTable("treatments", {
  id: serial("id").primaryKey(),
  patientId: integer("patient_id")
    .notNull()
    .references(() => patientsTable.id, { onDelete: "cascade" }),
  medicationId: integer("medication_id")
    .notNull()
    .references(() => medicationsTable.id),
  dose: text("dose"), // ex: "1 comprimido", "5ml"
  scheduleType: scheduleTypeEnum("schedule_type").notNull(),
  // JSON livre conforme scheduleType:
  // times_per_day:    { timesPerDay: 2, times: ["08:00", "20:00"] }
  // every_n_hours:    { intervalHours: 8, startTime: "08:00" }
  // specific_weekdays:{ weekdays: [1,3,5], times: ["08:00"] }  (0=dom)
  // alternate_days:   { times: ["08:00"], startDate: "2025-01-01" }
  // cycle_with_pause: { onDays: 21, offDays: 7, times: ["08:00"] }
  scheduleConfig: jsonb("schedule_config").notNull(),
  startDate: date("start_date", { mode: "string" }).notNull(),
  endDate: date("end_date", { mode: "string" }),
  status: treatmentStatusEnum("status").notNull().default("active"),
  instructions: text("instructions"),
  escalationProfile: escalationProfileEnum("escalation_profile").notNull().default("standard"),
  // ZELO-20: guarda quando o aviso "termina amanhã" foi enviado, pra não
  // reenviar todo dia até a data final chegar. Zerado sempre que a data de
  // fim muda ou o tratamento é reativado — um novo prazo merece novo aviso.
  endingNoticeSentAt: timestamp("ending_notice_sent_at", { withTimezone: true }),
  // ZELO-20: só para tratamento contínuo (endDate null). Marca a última vez
  // que o cuidador confirmou o lembrete de revisão de 6 meses. Nulo até a
  // primeira revisão — nesse caso o job conta a partir de startDate.
  lastReviewedAt: timestamp("last_reviewed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const insertTreatmentSchema = createInsertSchema(treatmentsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertTreatment = z.infer<typeof insertTreatmentSchema>;
export type Treatment = typeof treatmentsTable.$inferSelect;
