import {
  pgTable,
  serial,
  integer,
  timestamp,
  text,
  pgEnum,
  unique,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { familiesTable } from "./families";
import { treatmentsTable } from "./treatments";
import { scheduledDosesTable } from "./scheduled-doses";
import { appointmentsTable } from "./appointments";
import { pushPlatformEnum } from "./push-subscriptions";

// ZELO-32: mesmos valores de PushSendResult.reason (lib/push.ts) — não
// existia coluna nenhuma pra isto antes porque, até aqui, cada chamador só
// precisava do AGREGADO (sent/expired/failed) pra decidir o que fazer em
// seguida. O painel operacional precisa do motivo PRECISO por notificação
// pra responder "quanto disso é assinatura expirada vs erro de verdade".
export const pushFailureReasonEnum = pgEnum("push_failure_reason", [
  "not_configured",
  "no_keys",
  "expired",
  "rate_limited",
  "error",
]);

export const notificationTypeEnum = pgEnum("notification_type", [
  "dose_reminder",
  "dose_late",
  "appointment_reminder",
  "low_stock",
  "system",
  // ZELO-20: aviso neutro de véspera/encerramento de tratamento temporário —
  // nunca opina se deve continuar ou parar, só informa a data.
  "treatment_ending",
  // ZELO-20: lembrete periódico (6 meses) para tratamento contínuo — "vale
  // conferir a receita", nunca uma recomendação clínica.
  "continuous_review",
]);

// Timestamps separados por intenção:
// sentAt: quando o sistema enviou
// deliveredAt: confirmação de entrega do push
// ackedAt: quando o usuário tocou na notificação
//
// escalationLevel: 0=primeiro envio, 1=15min, 2=30min, 3=60min
// Precisa de relógio controlável (ver clock.ts) para testar sem esperar de verdade.
export const notificationsTable = pgTable(
  "notifications",
  {
    id: serial("id").primaryKey(),
    familyId: integer("family_id")
      .notNull()
      .references(() => familiesTable.id, { onDelete: "cascade" }),
    patientId: integer("patient_id"),
    caregiverId: integer("caregiver_id"),
    // ZELO-20: correlaciona o aviso a um tratamento específico — necessário
    // pra saber, ao confirmar/tocar a notificação, qual lastReviewedAt zerar.
    treatmentId: integer("treatment_id").references(() => treatmentsTable.id, { onDelete: "cascade" }),
    // ZELO-27: correlaciona o lembrete a UMA dose agendada específica — é a
    // base da chave de idempotência (junto de caregiverId+escalationLevel,
    // ver uniqueReminderPerCaregiverLevel). Nula para os outros tipos de
    // notificação (aviso de tratamento etc.), que não são por dose.
    scheduledDoseId: integer("scheduled_dose_id").references(() => scheduledDosesTable.id, { onDelete: "cascade" }),
    // ZELO-36: mesma função que scheduledDoseId, mas pra lembrete de
    // consulta — correlaciona a notificação a UMA consulta específica, base
    // da chave de idempotência (junto de caregiverId+escalationLevel, ver
    // uniqueAppointmentReminderPerCaregiverLevel). Nula pra todo outro tipo.
    appointmentId: integer("appointment_id").references(() => appointmentsTable.id, { onDelete: "cascade" }),
    type: notificationTypeEnum("type").notNull(),
    title: text("title").notNull(),
    body: text("body"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    // ZELO-29: qual plataforma confirmou — o mesmo cuidador pode ter mais de
    // um dispositivo; grava a primeira a confirmar, pra métrica "iOS entrega
    // pior que Android?" sem precisar de uma tabela de tentativa por
    // dispositivo (fora do escopo pedido — a história testa taxa por
    // período, não taxa por dispositivo com denominador exato).
    deliveredViaPlatform: pushPlatformEnum("delivered_via_platform"),
    // ZELO-32: motivo da última falha de envio a algum dispositivo do
    // cuidador (ver claimAndSendReminder em dose-reminders.ts) — nulo
    // quando todo dispositivo recebeu com sucesso, ou quando o cuidador
    // não tinha nenhuma assinatura de push ativa (nada foi sequer tentado).
    lastFailureReason: pushFailureReasonEnum("last_failure_reason"),
    ackedAt: timestamp("acked_at", { withTimezone: true }),
    escalationLevel: integer("escalation_level").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    // REGRA DE INTEGRIDADE: processar o mesmo job de lembrete várias vezes
    // (reprocessamento do pg-boss, retentativa, etc.) nunca pode gerar um
    // segundo push pro MESMO cuidador na MESMA dose no MESMO nível de
    // escalonamento. NULL em scheduledDoseId nunca colide (semântica padrão
    // do Postgres) — só afeta linhas de lembrete de dose de verdade.
    uniqueReminderPerCaregiverLevel: unique("uq_notif_dose_caregiver_level").on(
      table.scheduledDoseId,
      table.caregiverId,
      table.escalationLevel
    ),
    // ZELO-36: mesma garantia estrutural, pro lembrete de consulta — nunca
    // reenvia o MESMO nível (1 semana/1 dia/2h) pro MESMO cuidador na MESMA
    // consulta, mesmo com reprocessamento do job.
    uniqueAppointmentReminderPerCaregiverLevel: unique("uq_notif_appointment_caregiver_level").on(
      table.appointmentId,
      table.caregiverId,
      table.escalationLevel
    ),
    // ZELO-29: a consulta de taxa de entrega por período filtra por
    // família + tipo + intervalo de sentAt — sem este índice, isso vira
    // varredura completa da tabela conforme ela cresce. O critério de
    // aceite pede resposta em menos de 1 segundo.
    deliveryStatsIndex: index("idx_notifications_delivery_stats").on(
      table.familyId,
      table.type,
      table.sentAt
    ),
    // ZELO-32: o painel operacional agrega SEM recorte de família (é uma
    // pergunta sobre o serviço inteiro, não sobre uma família) — o índice
    // acima começa em familyId e não ajuda aqui. Mesmo raciocínio da ZELO-29:
    // sem isto, a consulta de 30 dias vira varredura completa conforme a
    // tabela cresce (critério de aceite: painel responde em <2s).
    adminMetricsIndex: index("idx_notifications_admin_metrics").on(table.type, table.sentAt),
  })
);

export const insertNotificationSchema = createInsertSchema(
  notificationsTable
).omit({ id: true, createdAt: true });

export type InsertNotification = z.infer<typeof insertNotificationSchema>;
export type Notification = typeof notificationsTable.$inferSelect;
