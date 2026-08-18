/**
 * Lembrete de dose — ZELO (ZELO-27).
 *
 * Prioridade explícita da história: nunca duplicar é mais importante que
 * nunca perder. Um idoso que recebe o mesmo lembrete duas vezes pode tomar
 * a dose duas vezes — dano real. Por isso o desenho aqui aceita, no pior
 * caso (processo morre entre o INSERT e a chamada de envio), perder um
 * lembrete isolado em vez de arriscar reenviar um já entregue.
 *
 * Idempotência em duas camadas independentes:
 * 1. Enfileiramento: policy "exclusive" + singletonKey `reminder:{doseId}:0`
 *    (lib/queue.ts) — só pode existir um job pendente por dose+nível.
 * 2. Execução: UNIQUE(scheduledDoseId, caregiverId, escalationLevel) em
 *    notifications (lib/db) — reprocessar o mesmo job (retry do pg-boss,
 *    reinício após crash) tenta o INSERT de novo; para quem já foi
 *    reivindicado, onConflictDoNothing devolve zero linhas e o cuidador é
 *    pulado, sem reenviar. A claim acontece ANTES do envio de propósito —
 *    "gravar em notifications antes de enviar" é o requisito da história.
 *
 * O conteúdo do push nunca menciona o medicamento, a menos que a família
 * tenha ligado families.showMedicationInPush (ZELO-28, desligado por
 * padrão). `tag` é `dose-group-{patientId}-{scheduledLocalTime}` — doses de
 * tratamentos diferentes do mesmo paciente no mesmo horário compartilham o
 * tag de propósito, pra o service worker mesclar numa notificação só
 * (ZELO-28) em vez de empilhar uma por tratamento.
 */
import { eq, and, or, isNull } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  scheduledDosesTable, patientsTable, caregiversTable, familiesTable,
  treatmentsTable, medicationsTable,
  notificationPreferencesTable, notificationsTable,
} from "@workspace/db";
import { Clock } from "./clock.ts";
import { sendPushToUser } from "./push.ts";
import { logger } from "./logger.ts";

export const ESCALATION_LEVEL_FIRST = 0;
// ZELO-28: "Adiar 15 min" reagenda no nível 1 — reaproveita a mesma
// idempotência (UNIQUE inclui escalationLevel) sem precisar de tabela ou
// fila nova. Níveis 2/3 (30min/60min) ficam reservados pra um cascade
// automático futuro (ZELO-29) — esta história é só o botão manual do
// cuidador, nunca um reenvio automático (ver "NÃO faça" na história).
export const ESCALATION_LEVEL_SNOOZE = 1;

/**
 * Handler do job QUEUE_DOSE_REMINDER. Nunca lança por causa de falha de
 * ENVIO (lib/push.ts já não lança) — só deixa propagar um erro genuíno de
 * infraestrutura (ex: banco fora do ar), que aciona o retry com backoff da
 * própria fila (configurado em queue.ts), sem lógica de retry própria aqui.
 */
export async function sendDoseReminder(scheduledDoseId: number, level: number = ESCALATION_LEVEL_FIRST): Promise<void> {
  const [dose] = await db
    .select({
      id: scheduledDosesTable.id,
      status: scheduledDosesTable.status,
      patientId: scheduledDosesTable.patientId,
      scheduledLocalTime: scheduledDosesTable.scheduledLocalTime,
      treatmentId: scheduledDosesTable.treatmentId,
    })
    .from(scheduledDosesTable)
    .where(eq(scheduledDosesTable.id, scheduledDoseId))
    .limit(1);

  // Dose apagada (tratamento editado/pausado desde o agendamento) ou já
  // registrada — a checagem é EXATAMENTE aqui, no disparo, nunca no
  // agendamento (a dose podia estar pendente há 14 dias quando o job foi
  // criado). "pending" é o único status que ainda precisa de lembrete.
  if (!dose || dose.status !== "pending") return;

  const [patient] = await db
    .select({
      id: patientsTable.id, name: patientsTable.name, familyId: patientsTable.familyId,
      showMedicationInPush: familiesTable.showMedicationInPush,
    })
    .from(patientsTable)
    .innerJoin(familiesTable, eq(patientsTable.familyId, familiesTable.id))
    .where(eq(patientsTable.id, dose.patientId))
    .limit(1);
  if (!patient) return;

  let medicationName: string | null = null;
  if (patient.showMedicationInPush) {
    const [med] = await db
      .select({ name: medicationsTable.name })
      .from(treatmentsTable)
      .innerJoin(medicationsTable, eq(treatmentsTable.medicationId, medicationsTable.id))
      .where(eq(treatmentsTable.id, dose.treatmentId))
      .limit(1);
    medicationName = med?.name ?? null;
  }

  // Destinatários: todo cuidador com conta vinculada na família, exceto
  // quem desligou explicitamente a categoria "dose" para ESTE paciente
  // (notification_preferences — ausência de linha = ativado, ver ZELO-26).
  const recipients = await db
    .select({ caregiverId: caregiversTable.id, userId: caregiversTable.userId })
    .from(caregiversTable)
    .leftJoin(
      notificationPreferencesTable,
      and(
        eq(notificationPreferencesTable.caregiverId, caregiversTable.id),
        eq(notificationPreferencesTable.patientId, patient.id),
        eq(notificationPreferencesTable.category, "dose")
      )
    )
    .where(
      and(
        eq(caregiversTable.familyId, patient.familyId),
        or(isNull(notificationPreferencesTable.enabled), eq(notificationPreferencesTable.enabled, true))
      )
    );

  const payload = {
    title: "ZELO",
    body: medicationName
      ? `Está na hora de ${medicationName} — ${patient.name}.`
      : `Está na hora do remédio de ${patient.name}.`,
    tag: `dose-group-${patient.id}-${dose.scheduledLocalTime}`,
    url: `/?patient=${patient.id}`,
    scheduledDoseId: dose.id,
    patientId: patient.id,
  };

  for (const recipient of recipients) {
    if (!recipient.userId) continue; // cuidador sem conta vinculada (pré-convite) — nada a notificar

    // A claim: se já existe linha (execução anterior deste job já
    // reivindicou este cuidador), pula — nunca reenvia. Ver o docblock do
    // módulo para o raciocínio completo por trás desta ordem.
    const claimed = await db
      .insert(notificationsTable)
      .values({
        familyId: patient.familyId,
        patientId: patient.id,
        caregiverId: recipient.caregiverId,
        scheduledDoseId: dose.id,
        type: "dose_reminder",
        title: payload.title,
        body: payload.body,
        escalationLevel: level,
        sentAt: Clock.now(),
      })
      .onConflictDoNothing()
      .returning({ id: notificationsTable.id });

    if (claimed.length === 0) continue;

    const result = await sendPushToUser(recipient.userId, payload);
    if (result.failed > 0) {
      logger.warn({ scheduledDoseId: dose.id, caregiverId: recipient.caregiverId }, "Lembrete de dose: falha ao entregar para ao menos um dispositivo");
    }
  }
}
