/**
 * Ciclo de vida de tratamento — ZELO (ZELO-20).
 *
 * Antibiótico de 7 dias e anti-hipertensivo indefinido são coisas diferentes
 * — o app trata cada um do jeito certo, mas NUNCA opina se o cuidador deve
 * continuar ou parar um tratamento. Toda mensagem aqui é fato neutro
 * ("termina amanhã", "foi encerrado", "vale conferir a receita"), nunca
 * recomendação clínica.
 *
 * Três rotinas, chamadas juntas pelo job diário (registrado em lib/queue.ts):
 * - closeExpiredTreatments: fecha o que passou da data final, mantendo TODO
 *   o histórico intacto (nunca apaga scheduled_doses/dose_records).
 * - sendEndingSoonNotices: avisa na véspera do último dia, uma vez só.
 * - sendContinuousReviewReminders: lembrete a cada ~6 meses para tratamento
 *   sem data de fim — só "vale conferir a receita", nunca alarme.
 */
import { eq } from "drizzle-orm";
import { db } from "@workspace/db";
import { treatmentsTable, patientsTable, medicationsTable, notificationsTable } from "@workspace/db";
import { tomorrowInTimezone } from "@workspace/scheduling";
import { Clock } from "./clock.ts";
import { audit } from "./audit.ts";
import { cancelFutureDoses } from "./dose-generation.ts";

export const REVIEW_INTERVAL_DAYS = 182; // ~6 meses — cadência de lembrete, não prazo clínico

type CandidateRow = {
  treatment: typeof treatmentsTable.$inferSelect;
  patientTimezone: string;
  familyId: number;
  medicationName: string;
};

async function loadActiveTreatmentsWithContext(): Promise<CandidateRow[]> {
  return db
    .select({
      treatment: treatmentsTable,
      patientTimezone: patientsTable.timezone,
      familyId: patientsTable.familyId,
      medicationName: medicationsTable.name,
    })
    .from(treatmentsTable)
    .innerJoin(patientsTable, eq(treatmentsTable.patientId, patientsTable.id))
    .innerJoin(medicationsTable, eq(treatmentsTable.medicationId, medicationsTable.id))
    .where(eq(treatmentsTable.status, "active"));
}

/**
 * Fecha tratamentos cuja data final já passou (no fuso de cada paciente).
 * Mantém o tratamento ativo NO dia final — só fecha a partir do dia seguinte,
 * pra não cortar a última dose do próprio dia.
 */
export async function closeExpiredTreatments(): Promise<number> {
  const candidates = (await loadActiveTreatmentsWithContext()).filter((r) => r.treatment.endDate !== null);

  let closed = 0;
  for (const row of candidates) {
    const todayLocal = Clock.todayInTimezone(row.patientTimezone);
    if (row.treatment.endDate! >= todayLocal) continue; // ainda dentro do prazo (inclui o próprio dia final)

    await db.update(treatmentsTable).set({ status: "finished", updatedAt: Clock.now() }).where(eq(treatmentsTable.id, row.treatment.id));
    await cancelFutureDoses(row.treatment.id);

    await db.insert(notificationsTable).values({
      familyId: row.familyId,
      patientId: row.treatment.patientId,
      treatmentId: row.treatment.id,
      type: "treatment_ending",
      title: "Tratamento encerrado",
      body: `O tratamento com ${row.medicationName} foi encerrado, conforme a data prevista. O histórico continua disponível.`,
      sentAt: Clock.now(),
    });

    await audit({
      familyId: row.familyId,
      entityType: "treatment",
      entityId: String(row.treatment.id),
      action: "updated",
      actorType: "system",
      diff: JSON.stringify({ before: { status: "active" }, after: { status: "finished" } }),
    });

    closed++;
  }
  return closed;
}

/**
 * Avisa, uma única vez, quando o tratamento termina amanhã (fuso do
 * paciente). Texto neutro, exatamente o da spec — nunca "pode parar" nem
 * "continue".
 */
export async function sendEndingSoonNotices(): Promise<number> {
  const candidates = (await loadActiveTreatmentsWithContext()).filter(
    (r) => r.treatment.endDate !== null && r.treatment.endingNoticeSentAt === null
  );

  let sent = 0;
  for (const row of candidates) {
    const tomorrowLocal = tomorrowInTimezone(Clock.now(), row.patientTimezone);
    if (row.treatment.endDate !== tomorrowLocal) continue;

    await db.insert(notificationsTable).values({
      familyId: row.familyId,
      patientId: row.treatment.patientId,
      treatmentId: row.treatment.id,
      type: "treatment_ending",
      title: "Tratamento terminando",
      body: `O tratamento com ${row.medicationName} termina amanhã. Confirme com o médico se deve continuar.`,
      sentAt: Clock.now(),
    });

    await db.update(treatmentsTable).set({ endingNoticeSentAt: Clock.now() }).where(eq(treatmentsTable.id, row.treatment.id));

    sent++;
  }
  return sent;
}

/**
 * Lembrete de revisão para tratamento contínuo (sem data de fim): a cada
 * ~6 meses desde o início ou a última revisão confirmada. Só um empurrão
 * de "vale conferir a receita" — nunca um alarme de "tratamento longo
 * demais" (fora do escopo por decisão explícita da história).
 */
export async function sendContinuousReviewReminders(): Promise<number> {
  const candidates = (await loadActiveTreatmentsWithContext()).filter((r) => r.treatment.endDate === null);
  const intervalMs = REVIEW_INTERVAL_DAYS * 86_400_000;
  const now = Clock.now();

  let sent = 0;
  for (const row of candidates) {
    const since = row.treatment.lastReviewedAt ?? new Date(`${row.treatment.startDate}T00:00:00Z`);
    if (now.getTime() - since.getTime() < intervalMs) continue;

    await db.insert(notificationsTable).values({
      familyId: row.familyId,
      patientId: row.treatment.patientId,
      treatmentId: row.treatment.id,
      type: "continuous_review",
      title: "Revisão periódica",
      body: `Já se passaram 6 meses desde o início (ou última revisão) do tratamento com ${row.medicationName} — vale conferir a receita com o médico.`,
      sentAt: Clock.now(),
    });

    // Marca como revisado agora — evita reenviar todo dia até o cuidador
    // realmente confirmar via ack (routes/notifications.ts também atualiza
    // isto quando o tipo é continuous_review, o que é o caminho normal;
    // isto aqui é só a rede de segurança caso a notificação nunca seja lida).
    await db.update(treatmentsTable).set({ lastReviewedAt: now }).where(eq(treatmentsTable.id, row.treatment.id));

    sent++;
  }
  return sent;
}

/** Job diário único (registrado em lib/queue.ts): roda as três rotinas em ordem. */
export async function runTreatmentLifecycleJob(): Promise<{ closed: number; endingSoonNotices: number; reviewReminders: number }> {
  const endingSoonNotices = await sendEndingSoonNotices();
  const closed = await closeExpiredTreatments();
  const reviewReminders = await sendContinuousReviewReminders();
  return { closed, endingSoonNotices, reviewReminders };
}
