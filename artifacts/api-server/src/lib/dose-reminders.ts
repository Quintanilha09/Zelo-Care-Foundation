/**
 * Lembrete de dose — ZELO (ZELO-27, ZELO-28, ZELO-29).
 *
 * Prioridade explícita da história original (ZELO-27): nunca duplicar é
 * mais importante que nunca perder. Um idoso que recebe o mesmo lembrete
 * duas vezes pode tomar a dose duas vezes — dano real. Por isso o desenho
 * aqui aceita, no pior caso (processo morre entre o INSERT e a chamada de
 * envio), perder um lembrete isolado em vez de arriscar reenviar um já
 * entregue.
 *
 * Idempotência em duas camadas independentes:
 * 1. Enfileiramento: policy "exclusive" + singletonKey `reminder:{doseId}:{nivel}`
 *    (lib/queue.ts) — só pode existir um job pendente por dose+nível.
 * 2. Execução: UNIQUE(scheduledDoseId, caregiverId, escalationLevel) em
 *    notifications (lib/db) — reprocessar o mesmo job (retry do pg-boss,
 *    reinício após crash) tenta o INSERT de novo; para quem já foi
 *    reivindicado, onConflictDoNothing devolve zero linhas e o cuidador é
 *    pulado, sem reenviar. A claim acontece ANTES do envio de propósito —
 *    "gravar em notifications antes de enviar" é o requisito original.
 *
 * O conteúdo do push nunca menciona o medicamento, a menos que a família
 * tenha ligado families.showMedicationInPush (ZELO-28, desligado por
 * padrão). `tag` é `dose-group-{patientId}-{scheduledLocalTime}` — doses de
 * tratamentos diferentes do mesmo paciente no mesmo horário compartilham o
 * tag de propósito, pra o service worker mesclar numa notificação só
 * (ZELO-28) em vez de empilhar uma por tratamento.
 *
 * ZELO-29 — enviado não é entregue: o serviço de push aceitar (sentAt) não
 * prova que o aparelho recebeu. Só o service worker, ao processar o evento
 * `push` de verdade, pode confirmar isso — via beacon pro servidor ANTES
 * de exibir a notificação (POST /push/ack com notificationId, ver
 * routes/push.ts e public/sw.js). Todo envio de nível 0 agenda um job de
 * verificação pra 3 minutos depois: se ninguém confirmou entrega até lá
 * (e a dose continua pendente), escala pro nível 1 automaticamente — o
 * mesmo mecanismo do botão manual "Adiar 15 min" (ZELO-28), só que
 * disparado pelo sistema em vez do cuidador. Só um salto (0→1): os níveis
 * 2/3 (30min/60min) ficam pra uma cascata futura, fora do escopo pedido.
 */
import { eq, and, or, isNull } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  scheduledDosesTable, patientsTable, caregiversTable, familiesTable,
  treatmentsTable, medicationsTable,
  notificationPreferencesTable, notificationsTable,
} from "@workspace/db";
import { Clock } from "./clock.ts";
import { sendPushToUser, type PushPayload } from "./push.ts";
import { boss, QUEUE_DELIVERY_CHECK } from "./queue.ts";
import { logger } from "./logger.ts";

export const ESCALATION_LEVEL_FIRST = 0;
export const ESCALATION_LEVEL_SNOOZE = 1;
const DELIVERY_CHECK_DELAY_MS = 3 * 60_000;

interface DoseContext {
  id: number;
  scheduledLocalTime: string;
  treatmentId: number;
}
interface PatientContext {
  id: number;
  name: string;
  familyId: number;
  showMedicationInPush: boolean;
}

function buildPayload(dose: DoseContext, patient: PatientContext, medicationName: string | null, notificationId: number): PushPayload {
  return {
    title: "ZELO",
    body: medicationName
      ? `Está na hora de ${medicationName} — ${patient.name}.`
      : `Está na hora do remédio de ${patient.name}.`,
    tag: `dose-group-${patient.id}-${dose.scheduledLocalTime}`,
    url: `/?patient=${patient.id}`,
    scheduledDoseId: dose.id,
    patientId: patient.id,
    notificationId,
  };
}

/**
 * Reivindica (claim) e envia UM lembrete pra UM cuidador, num nível
 * específico. Reutilizada tanto pelo envio inicial (nível 0, todos os
 * destinatários) quanto pela escalação automática por falta de confirmação
 * de entrega (nível 1, um cuidador específico) — mesma idempotência nos
 * dois casos, mesmo UNIQUE(scheduledDoseId, caregiverId, escalationLevel).
 */
async function claimAndSendReminder(
  dose: DoseContext,
  patient: PatientContext,
  medicationName: string | null,
  recipient: { caregiverId: number; userId: number | null },
  level: number
): Promise<void> {
  if (!recipient.userId) return; // cuidador sem conta vinculada (pré-convite) — nada a notificar

  const claimed = await db
    .insert(notificationsTable)
    .values({
      familyId: patient.familyId,
      patientId: patient.id,
      caregiverId: recipient.caregiverId,
      scheduledDoseId: dose.id,
      type: "dose_reminder",
      title: "ZELO",
      body: medicationName ? `Está na hora de ${medicationName} — ${patient.name}.` : `Está na hora do remédio de ${patient.name}.`,
      escalationLevel: level,
      sentAt: Clock.now(),
    })
    .onConflictDoNothing()
    .returning({ id: notificationsTable.id });

  if (claimed.length === 0) return; // já reivindicado numa execução anterior — nunca reenvia

  const notificationId = claimed[0].id;
  const payload = buildPayload(dose, patient, medicationName, notificationId);
  const result = await sendPushToUser(recipient.userId, payload);
  if (result.failed > 0) {
    logger.warn({ scheduledDoseId: dose.id, caregiverId: recipient.caregiverId, level }, "Lembrete de dose: falha ao entregar para ao menos um dispositivo");
  }

  // ZELO-29: só o nível 0 agenda verificação de entrega — a escalação em
  // si (nível 1) não agenda uma SEGUNDA verificação, pra não encadear além
  // do único salto que este sistema sabe dar hoje. Só vale a pena verificar
  // se pelo menos uma assinatura existia pra tentar (sem isso, sabemos de
  // antemão que não teve como entregar, não precisa esperar 3min pra saber).
  const hadAnySubscription = result.sent + result.expired + result.failed > 0;
  if (level === ESCALATION_LEVEL_FIRST && hadAnySubscription) {
    await boss.send(
      QUEUE_DELIVERY_CHECK,
      { notificationId },
      { singletonKey: `delivery-check:${notificationId}`, startAfter: new Date(Clock.now().getTime() + DELIVERY_CHECK_DELAY_MS) }
    );
  }
}

async function loadDoseAndPatient(scheduledDoseId: number): Promise<{ dose: DoseContext; patient: PatientContext; medicationName: string | null } | null> {
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
  if (!dose || dose.status !== "pending") return null;

  const [patient] = await db
    .select({
      id: patientsTable.id, name: patientsTable.name, familyId: patientsTable.familyId,
      showMedicationInPush: familiesTable.showMedicationInPush,
    })
    .from(patientsTable)
    .innerJoin(familiesTable, eq(patientsTable.familyId, familiesTable.id))
    .where(eq(patientsTable.id, dose.patientId))
    .limit(1);
  if (!patient) return null;

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

  return { dose, patient, medicationName };
}

/**
 * Handler do job QUEUE_DOSE_REMINDER. Nunca lança por causa de falha de
 * ENVIO (lib/push.ts já não lança) — só deixa propagar um erro genuíno de
 * infraestrutura (ex: banco fora do ar), que aciona o retry com backoff da
 * própria fila (configurado em queue.ts), sem lógica de retry própria aqui.
 */
export async function sendDoseReminder(scheduledDoseId: number, level: number = ESCALATION_LEVEL_FIRST): Promise<void> {
  const context = await loadDoseAndPatient(scheduledDoseId);
  if (!context) return;
  const { dose, patient, medicationName } = context;

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

  for (const recipient of recipients) {
    await claimAndSendReminder(dose, patient, medicationName, recipient, level);
  }
}

/**
 * Handler do job QUEUE_DELIVERY_CHECK (ZELO-29). Roda 3 minutos depois de
 * um envio de nível 0. Se ninguém confirmou entrega até aqui (deliveredAt
 * ainda nulo) e a dose continua pendente, escala pro nível 1 — mesmo
 * cuidador, mesma dose, "aciona a cascata" da história.
 */
export async function checkDeliveryAndEscalate(notificationId: number): Promise<void> {
  const [notification] = await db
    .select()
    .from(notificationsTable)
    .where(eq(notificationsTable.id, notificationId))
    .limit(1);

  if (!notification || notification.deliveredAt || !notification.scheduledDoseId || !notification.caregiverId) return;

  const context = await loadDoseAndPatient(notification.scheduledDoseId);
  if (!context) return; // dose já resolvida ou apagada — nada a escalar

  const [caregiver] = await db
    .select({ caregiverId: caregiversTable.id, userId: caregiversTable.userId })
    .from(caregiversTable)
    .where(eq(caregiversTable.id, notification.caregiverId))
    .limit(1);
  if (!caregiver) return;

  logger.warn({ notificationId, scheduledDoseId: notification.scheduledDoseId, caregiverId: caregiver.caregiverId }, "Push sem confirmação de entrega em 3min — escalando pro nível 1");

  await claimAndSendReminder(context.dose, context.patient, context.medicationName, caregiver, ESCALATION_LEVEL_SNOOZE);
}
