/**
 * Lembretes escalonados de consulta — ZELO (ZELO-36).
 *
 * 3 níveis FIXOS, sem cascata condicional (diferente da dose, ZELO-30): toda
 * consulta agendada recebe os 3, sempre, pra todo cuidador da família que
 * não desligou a categoria "appointment" (ZELO-26). Nenhum nível depende do
 * anterior ter disparado — mesma independência da cascata de dose.
 *
 *   0 — 1 semana antes
 *   1 — 1 dia antes
 *   2 — 2 horas antes, inclui "o que perguntar ao médico" em destaque
 *
 * Idempotência nas mesmas duas camadas do lembrete de dose:
 * 1. Enfileiramento: policy "exclusive" + singletonKey
 *    `appt-reminder:{appointmentId}:{nivel}` (lib/queue.ts).
 * 2. Execução: UNIQUE(appointmentId, caregiverId, escalationLevel) em
 *    notifications — a claim acontece ANTES do envio, sempre.
 *
 * Simplificação deliberada em relação à ZELO-27/30: o agendamento NÃO
 * acontece na mesma transação Postgres da consulta (diferente de
 * dose-generation.ts). Uma consulta perdida da fila é recuperável (o
 * cuidador vê a consulta na lista de qualquer forma) — o risco não é da
 * mesma gravidade que uma dose de remédio sem lembrete, não justifica a
 * complexidade extra de amarrar a fila à transação aqui.
 */
import { eq, and, or, isNull } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  appointmentsTable, patientsTable, caregiversTable,
  notificationPreferencesTable, notificationsTable,
} from "@workspace/db";
import { toLocalDateTime } from "@workspace/scheduling";
import { Clock } from "./clock.ts";
import { sendPushToUser, type PushPayload } from "./push.ts";
import { boss, QUEUE_APPOINTMENT_REMINDER, ensureQueueStarted } from "./queue.ts";
import { logger } from "./logger.ts";

export const APPOINTMENT_REMINDER_LEVEL_WEEK = 0;
export const APPOINTMENT_REMINDER_LEVEL_DAY = 1;
export const APPOINTMENT_REMINDER_LEVEL_HOURS = 2;
export const APPOINTMENT_REMINDER_MINUTES_BEFORE: Record<number, number> = {
  [APPOINTMENT_REMINDER_LEVEL_WEEK]: 7 * 24 * 60,
  [APPOINTMENT_REMINDER_LEVEL_DAY]: 24 * 60,
  [APPOINTMENT_REMINDER_LEVEL_HOURS]: 2 * 60,
};

function singletonKey(appointmentId: number, level: number): string {
  return `appt-reminder:${appointmentId}:${level}`;
}

/**
 * Cancela os 3 lembretes pendentes (se existirem) e reagenda a partir do
 * novo scheduledAt — só os níveis cujo horário ainda está no futuro (marcar
 * uma consulta pra amanhã não deveria disparar "1 semana antes" na hora).
 * Usada tanto na criação quanto em toda edição de data/hora ou cancelamento
 * (chamando sem agendar de novo, só cancelando).
 */
export async function rescheduleAppointmentReminders(appointmentId: number, scheduledAt: Date | null): Promise<void> {
  await ensureQueueStarted();

  for (let level = 0; level <= APPOINTMENT_REMINDER_LEVEL_HOURS; level++) {
    const key = singletonKey(appointmentId, level);
    const existing = await boss.findJobs(QUEUE_APPOINTMENT_REMINDER, { key });
    if (existing.length > 0) await boss.deleteJob(QUEUE_APPOINTMENT_REMINDER, existing.map((j) => j.id));
  }

  if (!scheduledAt) return; // só cancelamento, sem reagendar (consulta cancelada)

  for (const [levelStr, minutes] of Object.entries(APPOINTMENT_REMINDER_MINUTES_BEFORE)) {
    const level = Number(levelStr);
    const startAfter = new Date(scheduledAt.getTime() - minutes * 60_000);
    if (startAfter.getTime() <= Clock.now().getTime()) continue;
    await boss.send(QUEUE_APPOINTMENT_REMINDER, { appointmentId, level }, { singletonKey: singletonKey(appointmentId, level), startAfter });
  }
}

interface AppointmentContext {
  id: number;
  specialty: string;
  doctorName: string | null;
  scheduledLocalDateTime: string;
  questionsForDoctor: string[];
  patientId: number;
  patientName: string;
  familyId: number;
  timezone: string;
}

async function loadContext(appointmentId: number): Promise<AppointmentContext | null> {
  const [row] = await db
    .select({
      id: appointmentsTable.id, specialty: appointmentsTable.specialty, doctorName: appointmentsTable.doctorName,
      scheduledAt: appointmentsTable.scheduledAt, status: appointmentsTable.status,
      questionsForDoctor: appointmentsTable.questionsForDoctor,
      patientId: patientsTable.id, patientName: patientsTable.name, familyId: patientsTable.familyId, timezone: patientsTable.timezone,
    })
    .from(appointmentsTable)
    .innerJoin(patientsTable, eq(appointmentsTable.patientId, patientsTable.id))
    .where(eq(appointmentsTable.id, appointmentId))
    .limit(1);

  // Consulta cancelada/remarcada/já concluída desde o agendamento do
  // lembrete — a checagem é EXATAMENTE aqui, no disparo (mesmo padrão da
  // dose), nunca no agendamento (pode ficar pendente na fila por até 1 semana).
  if (!row || row.status !== "scheduled") return null;

  const { localDate, localTime } = toLocalDateTime(row.scheduledAt, row.timezone);

  return {
    id: row.id, specialty: row.specialty, doctorName: row.doctorName,
    scheduledLocalDateTime: `${localDate} às ${localTime}`,
    questionsForDoctor: Array.isArray(row.questionsForDoctor) ? (row.questionsForDoctor as string[]) : [],
    patientId: row.patientId, patientName: row.patientName, familyId: row.familyId, timezone: row.timezone,
  };
}

function buildBody(level: number, ctx: AppointmentContext): string {
  const what = `${ctx.specialty}${ctx.doctorName ? ` com ${ctx.doctorName}` : ""}`;
  const when = level === APPOINTMENT_REMINDER_LEVEL_WEEK ? "em 1 semana"
    : level === APPOINTMENT_REMINDER_LEVEL_DAY ? "amanhã"
    : "em 2 horas";
  let body = `${ctx.patientName} tem ${what} ${when} (${ctx.scheduledLocalDateTime}).`;
  if (level === APPOINTMENT_REMINDER_LEVEL_HOURS && ctx.questionsForDoctor.length > 0) {
    body += ` O que perguntar: ${ctx.questionsForDoctor.join("; ")}`;
  }
  return body;
}

async function resolveRecipients(familyId: number, patientId: number): Promise<Array<{ caregiverId: number; userId: number | null }>> {
  const rows = await db
    .select({ caregiverId: caregiversTable.id, userId: caregiversTable.userId })
    .from(caregiversTable)
    .leftJoin(
      notificationPreferencesTable,
      and(
        eq(notificationPreferencesTable.caregiverId, caregiversTable.id),
        eq(notificationPreferencesTable.patientId, patientId),
        eq(notificationPreferencesTable.category, "appointment")
      )
    )
    .where(and(
      eq(caregiversTable.familyId, familyId),
      or(isNull(notificationPreferencesTable.enabled), eq(notificationPreferencesTable.enabled, true))
    ));
  return rows;
}

async function claimAndSend(level: number, ctx: AppointmentContext, recipient: { caregiverId: number; userId: number | null }): Promise<void> {
  if (!recipient.userId) return; // cuidador sem conta vinculada (pré-convite) — nada a notificar

  const claimed = await db
    .insert(notificationsTable)
    .values({
      familyId: ctx.familyId, patientId: ctx.patientId, caregiverId: recipient.caregiverId,
      appointmentId: ctx.id, type: "appointment_reminder",
      title: "ZELO", body: buildBody(level, ctx),
      escalationLevel: level, sentAt: Clock.now(),
    })
    .onConflictDoNothing()
    .returning({ id: notificationsTable.id });

  if (claimed.length === 0) return; // já reivindicado numa execução anterior — nunca reenvia

  const payload: PushPayload = {
    title: "ZELO", body: buildBody(level, ctx),
    tag: `appointment-${ctx.id}`, url: `/pacientes/${ctx.patientId}/consultas`,
    patientId: ctx.patientId, notificationId: claimed[0].id,
  };
  const result = await sendPushToUser(recipient.userId, payload);
  if (result.failed > 0) {
    logger.warn({ appointmentId: ctx.id, caregiverId: recipient.caregiverId, level }, "Lembrete de consulta: falha ao entregar para ao menos um dispositivo");
  }
}

/** Handler do job QUEUE_APPOINTMENT_REMINDER, para qualquer um dos 3 níveis. */
export async function sendAppointmentReminder(appointmentId: number, level: number): Promise<void> {
  const ctx = await loadContext(appointmentId);
  if (!ctx) return;

  const recipients = await resolveRecipients(ctx.familyId, ctx.patientId);
  for (const r of recipients) await claimAndSend(level, ctx, r);
}
