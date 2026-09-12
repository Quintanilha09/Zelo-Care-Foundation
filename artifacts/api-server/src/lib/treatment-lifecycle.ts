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
import { eq, and, gte } from "drizzle-orm";
import { db } from "@workspace/db";
import { treatmentsTable, patientsTable, medicationsTable, notificationsTable } from "@workspace/db";
import { tomorrowInTimezone } from "@workspace/scheduling";
import { Clock } from "./clock.ts";
import { audit } from "./audit.ts";
import { cancelFutureDoses, doseDoDegrau, type DegrauDeDesmame } from "./dose-generation.ts";

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
export async function runTreatmentLifecycleJob(): Promise<{ closed: number; endingSoonNotices: number; reviewReminders: number; taperNotices: number }> {
  const endingSoonNotices = await sendEndingSoonNotices();
  // Issue #172: a virada de degrau e onde o desmame se perde — quem toma
  // 40mg ha cinco dias toma 40mg no sexto por habito.
  const taperNotices = await sendTaperStepNotices();
  const closed = await closeExpiredTreatments();
  const reviewReminders = await sendContinuousReviewReminders();
  return { closed, endingSoonNotices, reviewReminders, taperNotices };
}

/**
 * O aviso na véspera de cada degrau do desmame — Issue #172.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * A VIRADA DE DEGRAU É ONDE O DESMAME SE PERDE.
 *
 * Quem toma 40mg há cinco dias toma 40mg no sexto por hábito. O app sabe o
 * dia da virada — ele é quem gerou as doses — e o aviso custa uma linha de
 * notificação. Não avisar seria guardar a informação e não usá-la.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── Mesmo mecanismo do aviso de fim (ZELO-20) ────────────────────────────
 *
 * Roda no mesmo job diário, e a véspera é sempre no fuso do PACIENTE — um
 * filho em Portugal não pode receber o aviso um dia fora.
 *
 * ── A deduplicação sai da própria notificação, e não de coluna nova ──────
 *
 * O aviso de fim usa `endingNoticeSentAt` porque acontece **uma vez** por
 * tratamento. Um desmame tem várias viradas, e uma coluna só guardaria a
 * última — daí a pergunta ser feita à tabela de notificações: "já saiu um
 * aviso deste tipo para este tratamento nas últimas 20 horas?".
 *
 * Vinte horas, e não vinte e quatro: o job é diário, e uma janela de 24 h
 * exata engoliria o aviso do dia seguinte se uma execução atrasasse alguns
 * minutos.
 */
export async function sendTaperStepNotices(): Promise<number> {
  const candidatos = (await loadActiveTreatmentsWithContext()).filter((r) => {
    const degraus = (r.treatment.scheduleConfig as { degraus?: DegrauDeDesmame[] }).degraus;
    return Array.isArray(degraus) && degraus.length > 1;
  });

  let enviados = 0;
  for (const row of candidatos) {
    const degraus = (row.treatment.scheduleConfig as { degraus: DegrauDeDesmame[] }).degraus;
    const amanha = tomorrowInTimezone(Clock.now(), row.patientTimezone);

    // A dose de amanhã é diferente da de hoje? É isso, e só isso, que faz a
    // véspera. Comparar as doses em vez de contar dias deixa a conta com um
    // dono só — `doseDoDegrau`, a mesma que gerou as doses.
    const hoje = Clock.todayInTimezone(row.patientTimezone);
    const doseDeHoje = doseDoDegrau(degraus, row.treatment.startDate, hoje);
    const doseDeAmanha = doseDoDegrau(degraus, row.treatment.startDate, amanha);
    if (!doseDeHoje || !doseDeAmanha || doseDeHoje === doseDeAmanha) continue;

    const jaAvisou = await db
      .select({ id: notificationsTable.id })
      .from(notificationsTable)
      .where(and(
        eq(notificationsTable.treatmentId, row.treatment.id),
        eq(notificationsTable.type, "treatment_ending"),
        gte(notificationsTable.sentAt, new Date(Clock.now().getTime() - 20 * 3_600_000)),
      ))
      .limit(1);
    if (jaAvisou.length > 0) continue;

    await db.insert(notificationsTable).values({
      familyId: row.familyId,
      patientId: row.treatment.patientId,
      treatmentId: row.treatment.id,
      // Reusa o tipo do aviso de fim: os dois dizem "a partir de amanhã é
      // diferente", e criar um tipo novo obrigaria toda preferência de
      // notificação já configurada a ganhar uma linha a mais.
      type: "treatment_ending",
      title: "A dose muda amanhã",
      body: `A partir de amanhã, ${row.medicationName} passa a ser ${doseDeAmanha}.`,
      sentAt: Clock.now(),
    });

    enviados++;
  }
  return enviados;
}
