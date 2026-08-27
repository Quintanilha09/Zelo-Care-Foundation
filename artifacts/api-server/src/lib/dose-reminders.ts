/**
 * Cascata de lembrete e escalonamento de dose — ZELO (ZELO-27, 28, 29, 30).
 *
 * Prioridade explícita desde a história original (ZELO-27): nunca duplicar
 * é mais importante que nunca perder. Um idoso que recebe o mesmo lembrete
 * duas vezes pode tomar a dose duas vezes — dano real. Todo o desenho abaixo
 * aceita, no pior caso (processo morre entre reivindicar e enviar), perder
 * um lembrete isolado em vez de arriscar reenviar um já entregue.
 *
 * Idempotência em duas camadas independentes, por (dose, cuidador, nível):
 * 1. Enfileiramento: policy "exclusive" + singletonKey `reminder:{doseId}:{nivel}`
 *    (lib/queue.ts) — só pode existir um job pendente por dose+nível.
 * 2. Execução: UNIQUE(scheduledDoseId, caregiverId, escalationLevel) em
 *    notifications — reprocessar o mesmo job (retry do pg-boss, reinício
 *    após crash) tenta o INSERT de novo; quem já foi reivindicado nunca
 *    recebe de novo. A claim acontece ANTES do envio, sempre.
 *
 * ZELO-30 — a cascata completa (spec §2.2), 4 níveis, todos agendados
 * UPFRONT (mesma transação da dose, ver dose-generation.ts) com o
 * startAfter já calculado — nenhum nível depende do anterior ter disparado
 * pra existir, cada um se autoverifica no disparo:
 *   0 (T+0)  → cuidador(es) principal(is) ("de plantão")
 *   1 (T+15) → mesmo(s) cuidador(es), mais insistente — MESMO nível também
 *              alcançável mais cedo pela checagem de entrega de 3min
 *              (ZELO-29) ou pelo botão manual "Adiar 15min" (ZELO-28); os
 *              três convergem no mesmo slot por cuidador, então quem
 *              disparar primeiro "ganha" e os outros viram no-op — não é
 *              preciso coordenar entre eles.
 *   2 (T+30) → transmite pra TODOS os cuidadores com capacidade de
 *              registrar — a não ser que o perfil de escalonamento do
 *              tratamento ou o silêncio noturno da família digam o
 *              contrário (ver escalationProfile/estaEmSilencioNoturno).
 *   3 (T+60) → marca a dose como "late" (perdida — continua registrável
 *              retroativamente, nunca fecha a porta) e avisa de novo o(s)
 *              principal(is).
 *
 * Todo texto é deliberadamente neutro — nunca atribui a falta de registro
 * a uma pessoa. "Alguém consegue verificar?", nunca "Fulano esqueceu".
 */
import { eq, and, or, isNull } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  scheduledDosesTable, patientsTable, caregiversTable, familiesTable,
  treatmentsTable, medicationsTable,
  notificationPreferencesTable, notificationsTable,
} from "@workspace/db";
import { Clock } from "./clock.ts";
import { estaEmSilencioNoturno, type JanelaDeSilencio } from "./silencio-noturno.ts";
import { sendPushToUser, type PushPayload } from "./push.ts";
import { boss, QUEUE_DELIVERY_CHECK } from "./queue.ts";
import { hasCapability, type CaregiverRole } from "./capabilities.ts";
import { publishPatientEvent } from "./realtime.ts";
import { logger } from "./logger.ts";

export const ESCALATION_LEVEL_FIRST = 0; // T+0
export const ESCALATION_LEVEL_SNOOZE = 1; // T+15 (ou +3min por não-entrega, ou "Adiar" manual)
export const ESCALATION_LEVEL_BROADCAST = 2; // T+30
export const ESCALATION_LEVEL_FINAL = 3; // T+60
export const ESCALATION_LEVELS_MINUTES: Record<number, number> = {
  [ESCALATION_LEVEL_FIRST]: 0,
  [ESCALATION_LEVEL_SNOOZE]: 15,
  [ESCALATION_LEVEL_BROADCAST]: 30,
  [ESCALATION_LEVEL_FINAL]: 60,
};
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
  timezone: string;
  showMedicationInPush: boolean;
}
// A janela de silêncio mudou de arquivo (QUI-10) porque o aviso de momento
// novo passou a precisar da mesma conta. Mesmo comportamento, um dono só —
// ver lib/silencio-noturno.ts.
type FamilyQuietHours = JanelaDeSilencio;
type EscalationProfile = "silent" | "standard" | "critical";

/** Texto sempre neutro — nunca atribui a falta de registro a uma pessoa (revisado item a item). */
function buildBody(level: number, dose: DoseContext, patient: PatientContext, medicationName: string | null): string {
  const med = medicationName ? `de ${medicationName} ` : "do remédio ";
  if (level === ESCALATION_LEVEL_BROADCAST) {
    return `A dose ${med}das ${dose.scheduledLocalTime} de ${patient.name} ainda não foi registrada. Alguém consegue verificar?`;
  }
  if (level === ESCALATION_LEVEL_FINAL) {
    return `A dose ${med}das ${dose.scheduledLocalTime} de ${patient.name} foi marcada como perdida — ainda dá pra registrar, se for o caso.`;
  }
  return medicationName ? `Está na hora de ${medicationName} — ${patient.name}.` : `Está na hora do remédio de ${patient.name}.`;
}

function buildPayload(
  level: number,
  dose: DoseContext,
  patient: PatientContext,
  medicationName: string | null,
  notificationId: number
): PushPayload {
  return {
    title: "ZELO",
    body: buildBody(level, dose, patient, medicationName),
    tag: `dose-group-${patient.id}-${dose.scheduledLocalTime}`,
    url: `/?patient=${patient.id}`,
    scheduledDoseId: dose.id,
    patientId: patient.id,
    notificationId,
  };
}

/**
 * Reivindica (claim) e envia UM lembrete/escalonamento pra UM cuidador, num
 * nível específico. Reutilizada por todo disparo de todo nível — mesma
 * idempotência sempre, mesmo UNIQUE(scheduledDoseId, caregiverId, escalationLevel).
 */
async function claimAndSendReminder(
  level: number,
  dose: DoseContext,
  patient: PatientContext,
  medicationName: string | null,
  recipient: { caregiverId: number; userId: number | null }
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
      body: buildBody(level, dose, patient, medicationName),
      escalationLevel: level,
      sentAt: Clock.now(),
    })
    .onConflictDoNothing()
    .returning({ id: notificationsTable.id });

  if (claimed.length === 0) return; // já reivindicado numa execução anterior — nunca reenvia

  const notificationId = claimed[0].id;
  const payload = buildPayload(level, dose, patient, medicationName, notificationId);
  const result = await sendPushToUser(recipient.userId, payload);
  if (result.failed > 0) {
    logger.warn({ scheduledDoseId: dose.id, caregiverId: recipient.caregiverId, level }, "Lembrete de dose: falha ao entregar para ao menos um dispositivo");
  }

  // ZELO-29: só o nível 0 agenda verificação de entrega de 3min — os
  // demais níveis já têm horário próprio fixo (T+15/30/60), não precisam
  // de um atalho pra "descobrir mais cedo que não chegou".
  const hadAnySubscription = result.sent + result.expired + result.failed > 0;
  if (level === ESCALATION_LEVEL_FIRST && hadAnySubscription) {
    await boss.send(
      QUEUE_DELIVERY_CHECK,
      { notificationId },
      { singletonKey: `delivery-check:${notificationId}`, startAfter: new Date(Clock.now().getTime() + DELIVERY_CHECK_DELAY_MS) }
    );
  }
}

interface LoadedContext {
  dose: DoseContext;
  patient: PatientContext;
  medicationName: string | null;
  family: FamilyQuietHours;
  escalationProfile: EscalationProfile;
}

async function loadContext(scheduledDoseId: number): Promise<LoadedContext | null> {
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

  // Dose apagada (tratamento editado desde o agendamento) ou já registrada
  // — a checagem é EXATAMENTE aqui, no disparo, nunca no agendamento (a
  // dose pode ficar pendente na fila por até 14 dias). "pending"/"late" são
  // os únicos status que ainda podem precisar de lembrete — "late" é
  // atribuído por uma varredura independente (dose-generation.ts) e NÃO
  // significa "resolvida", só "passou da hora"; só taken/skipped/postponed
  // (um dose_record de verdade) encerram a cascata.
  if (!dose || (dose.status !== "pending" && dose.status !== "late")) return null;

  const [row] = await db
    .select({
      patientId: patientsTable.id, patientName: patientsTable.name,
      familyId: patientsTable.familyId, timezone: patientsTable.timezone,
      showMedicationInPush: familiesTable.showMedicationInPush,
      quietHoursEnabled: familiesTable.quietHoursEnabled,
      quietHoursStart: familiesTable.quietHoursStart,
      quietHoursEnd: familiesTable.quietHoursEnd,
      medicationId: treatmentsTable.medicationId,
      escalationProfile: treatmentsTable.escalationProfile,
    })
    .from(patientsTable)
    .innerJoin(familiesTable, eq(patientsTable.familyId, familiesTable.id))
    .innerJoin(treatmentsTable, eq(treatmentsTable.id, dose.treatmentId))
    .where(eq(patientsTable.id, dose.patientId))
    .limit(1);
  if (!row) return null;

  let medicationName: string | null = null;
  if (row.showMedicationInPush) {
    const [med] = await db.select({ name: medicationsTable.name }).from(medicationsTable).where(eq(medicationsTable.id, row.medicationId)).limit(1);
    medicationName = med?.name ?? null;
  }

  return {
    dose,
    patient: { id: row.patientId, name: row.patientName, familyId: row.familyId, timezone: row.timezone, showMedicationInPush: row.showMedicationInPush },
    medicationName,
    family: { quietHoursEnabled: row.quietHoursEnabled, quietHoursStart: row.quietHoursStart, quietHoursEnd: row.quietHoursEnd },
    escalationProfile: row.escalationProfile as EscalationProfile,
  };
}

/**
 * Destinatários de um paciente, filtrados por quem NÃO desligou a
 * categoria "dose" pra ele (notification_preferences — ausência de linha
 * = ativado, ZELO-26). `scope`:
 * - "on_duty": só cuidador(es) principal(is) — T+0/T+15/T+60.
 * - "capable": todo cuidador com capacidade de registrar dose (qualquer
 *   papel exceto observador) — T+30.
 */
async function resolveRecipients(
  familyId: number,
  patientId: number,
  scope: "on_duty" | "capable"
): Promise<Array<{ caregiverId: number; userId: number | null; role: CaregiverRole }>> {
  const rows = await db
    .select({ caregiverId: caregiversTable.id, userId: caregiversTable.userId, role: caregiversTable.role })
    .from(caregiversTable)
    .leftJoin(
      notificationPreferencesTable,
      and(
        eq(notificationPreferencesTable.caregiverId, caregiversTable.id),
        eq(notificationPreferencesTable.patientId, patientId),
        eq(notificationPreferencesTable.category, "dose")
      )
    )
    .where(
      and(
        eq(caregiversTable.familyId, familyId),
        or(isNull(notificationPreferencesTable.enabled), eq(notificationPreferencesTable.enabled, true))
      )
    );

  const typed = rows.map((r) => ({ ...r, role: r.role as CaregiverRole }));
  if (scope === "on_duty") return typed.filter((r) => r.role === "primary_caregiver");
  return typed.filter((r) => hasCapability(r.role, "register_dose"));
}

/**
 * Handler do job QUEUE_DOSE_REMINDER, para qualquer um dos 4 níveis da
 * cascata. Nunca lança por causa de falha de ENVIO (lib/push.ts já não
 * lança) — só deixa propagar erro genuíno de infraestrutura, que aciona o
 * retry com backoff da própria fila (queue.ts), sem lógica de retry
 * própria aqui.
 */
export async function sendDoseReminder(scheduledDoseId: number, level: number = ESCALATION_LEVEL_FIRST): Promise<void> {
  const context = await loadContext(scheduledDoseId);
  if (!context) return;
  const { dose, patient, medicationName, family, escalationProfile } = context;

  if (level === ESCALATION_LEVEL_FIRST || level === ESCALATION_LEVEL_SNOOZE) {
    const recipients = await resolveRecipients(patient.familyId, patient.id, "on_duty");
    for (const r of recipients) await claimAndSendReminder(level, dose, patient, medicationName, r);
    return;
  }

  if (level === ESCALATION_LEVEL_BROADCAST) {
    // "silent" nunca transmite pra mais gente que o plantonista. "standard"
    // também não durante o silêncio noturno da família. "critical" sempre
    // transmite — é o perfil pra quando a dose importa a ponto de acordar
    // alguém (ex: anticoagulante).
    const shouldBroadcast =
      escalationProfile === "critical" ? true :
      escalationProfile === "silent" ? false :
      !estaEmSilencioNoturno(patient.timezone, family);
    if (!shouldBroadcast) return;

    const recipients = await resolveRecipients(patient.familyId, patient.id, "capable");
    for (const r of recipients) await claimAndSendReminder(level, dose, patient, medicationName, r);
    publishPatientEvent(patient.id, { type: "escalation_triggered", scheduledDoseId: dose.id });
    return;
  }

  if (level === ESCALATION_LEVEL_FINAL) {
    await db
      .update(scheduledDosesTable)
      .set({ status: "late", updatedAt: Clock.now() })
      .where(and(eq(scheduledDosesTable.id, dose.id), eq(scheduledDosesTable.status, "pending")));

    const recipients = await resolveRecipients(patient.familyId, patient.id, "on_duty");
    for (const r of recipients) await claimAndSendReminder(level, dose, patient, medicationName, r);
    publishPatientEvent(patient.id, { type: "dose_missed", scheduledDoseId: dose.id });
    return;
  }
}

/**
 * Handler do job QUEUE_DELIVERY_CHECK (ZELO-29). Roda 3 minutos depois de
 * um envio de nível 0. Se ninguém confirmou entrega até aqui (deliveredAt
 * ainda nulo) e a dose continua elegível, escala pro nível 1 — mesmo
 * cuidador, mesma dose. Se o T+15 "de verdade" (agendado desde a criação
 * da dose) ainda não disparou, este é quem chega primeiro; se já disparou,
 * a claim em claimAndSendReminder torna isto um no-op.
 */
export async function checkDeliveryAndEscalate(notificationId: number): Promise<void> {
  const [notification] = await db
    .select()
    .from(notificationsTable)
    .where(eq(notificationsTable.id, notificationId))
    .limit(1);

  if (!notification || notification.deliveredAt || !notification.scheduledDoseId || !notification.caregiverId) return;

  const context = await loadContext(notification.scheduledDoseId);
  if (!context) return; // dose já resolvida ou apagada — nada a escalar

  const [caregiver] = await db
    .select({ caregiverId: caregiversTable.id, userId: caregiversTable.userId })
    .from(caregiversTable)
    .where(eq(caregiversTable.id, notification.caregiverId))
    .limit(1);
  if (!caregiver) return;

  logger.warn({ notificationId, scheduledDoseId: notification.scheduledDoseId, caregiverId: caregiver.caregiverId }, "Push sem confirmação de entrega em 3min — escalando pro nível 1");

  await claimAndSendReminder(ESCALATION_LEVEL_SNOOZE, context.dose, context.patient, context.medicationName, caregiver);
}
