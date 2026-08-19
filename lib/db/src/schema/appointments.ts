import {
  pgTable,
  serial,
  integer,
  timestamp,
  text,
  pgEnum,
  jsonb,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { patientsTable } from "./patients";

export const appointmentStatusEnum = pgEnum("appointment_status", [
  "scheduled",
  "completed",
  "cancelled",
  "rescheduled",
]);

// ZELO-36: tipo da consulta — puramente descritivo, não muda o
// comportamento de lembrete (todos os tipos usam a mesma cascata 1
// semana/1 dia/2h).
export const appointmentTypeEnum = pgEnum("appointment_type", [
  "consultation",
  "exam",
  "procedure",
]);

export const appointmentsTable = pgTable("appointments", {
  id: serial("id").primaryKey(),
  patientId: integer("patient_id")
    .notNull()
    .references(() => patientsTable.id, { onDelete: "cascade" }),
  type: appointmentTypeEnum("type").notNull().default("consultation"),
  specialty: text("specialty").notNull(),
  doctorName: text("doctor_name"),
  location: text("location"),
  scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull(),
  notes: text("notes"),
  // ZELO-36: texto do que o MÉDICO disse sobre preparo (jejum, suspender
  // medicamento) — nunca orientação do app. Livre de propósito, sem
  // estrutura, pra não parecer instrução própria do produto.
  preparationNotes: text("preparation_notes"),
  // Lista que o cuidador vai preenchendo ao longo das semanas — aparece em
  // destaque no lembrete de 2h antes. Array simples de strings: não há
  // necessidade de marcar "respondida" nem nada além do texto em si.
  questionsForDoctor: jsonb("questions_for_doctor").notNull().default([]),
  // Preenchido DEPOIS da consulta — fecha o ciclo consulta→receita→tratamento.
  postAppointmentNotes: text("post_appointment_notes"),
  // Anexo (foto de pedido de exame/receita) — mesmo padrão de
  // photo-extractions.ts (base64 em texto, sem storage externo). Protegido
  // por autenticação + escopo de família, igual toda outra foto de saúde
  // no produto; não é link público compartilhável (diferente do relatório
  // em PDF da ZELO-35, que é feito pra ser levado ao médico).
  attachmentData: text("attachment_data"),
  attachmentMimeType: text("attachment_mime_type"),
  attachmentFileName: text("attachment_file_name"),
  status: appointmentStatusEnum("status").notNull().default("scheduled"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const insertAppointmentSchema = createInsertSchema(
  appointmentsTable
).omit({ id: true, createdAt: true, updatedAt: true });

export type InsertAppointment = z.infer<typeof insertAppointmentSchema>;
export type Appointment = typeof appointmentsTable.$inferSelect;
