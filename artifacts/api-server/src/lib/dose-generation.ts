/**
 * Geração de doses — ZELO (ZELO-18).
 *
 * Usa o motor de recorrência puro (@workspace/scheduling) para expandir a
 * posologia de um tratamento numa janela de tempo, e persiste o resultado
 * em scheduled_doses. A idempotência não depende deste código — depende da
 * constraint UNIQUE(treatment_id, scheduled_at) no banco (Fase 01). Rodar
 * esta função várias vezes para o mesmo tratamento nunca duplica dose.
 *
 * A inserção das doses e o envio do evento DoseScheduled (fila pg-boss)
 * acontecem NA MESMA TRANSAÇÃO Postgres (via fromDrizzle) — dose e job
 * não podem divergir: se o processo cai no meio, o commit nunca acontece
 * e nenhum dos dois existe. Isso elimina a classe de bug "dose existe mas
 * job sumiu" que a história pedia.
 *
 * A janela rolante de 14 dias é estendida por extendActiveTreatmentWindows,
 * chamada pelo job diário registrado em lib/queue.ts. Funciona porque
 * generateDosesForTreatment já calcula a janela a partir de Clock.now() —
 * chamar de novo mais tarde naturalmente cobre os dias seguintes, sem
 * lógica extra de "extensão".
 *
 * ZELO-19: cada dose guarda scheduledLocalDate/scheduledLocalTime (fuso do
 * paciente) ao lado de scheduledAt (UTC) — ver lib/scheduling/src/timezone.ts.
 * Se o fuso do paciente mudar, quem chama este módulo é a rota de paciente
 * (routes/patients.ts): limpa as pendentes futuras e gera de novo, o que
 * naturalmente reinterpreta o mesmo horário de parede (ex: "8:00") no fuso
 * novo, porque generateDosesForTreatment sempre lê o fuso atual do paciente.
 */
import { and, eq, gte, lt } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { fromDrizzle } from "pg-boss";
import { db } from "@workspace/db";
import { treatmentsTable, patientsTable, scheduledDosesTable } from "@workspace/db";
import { expandSchedule, toLocalDateTime } from "@workspace/scheduling";
import type { ScheduleConfig } from "@workspace/scheduling";
import { Clock } from "./clock.ts";
import { boss, QUEUE_DOSE_SCHEDULED, QUEUE_DOSE_REMINDER, ensureQueueStarted } from "./queue.ts";
import { ESCALATION_LEVELS_MINUTES } from "./dose-reminders.ts";

export const DOSE_WINDOW_DAYS = 14;

/**
 * Gera e persiste as doses dos próximos DOSE_WINDOW_DAYS dias para um
 * tratamento. Idempotente: pode ser chamada quantas vezes for preciso.
 * Emite um evento DoseScheduled por dose nova (não por dose já existente).
 */
export async function generateDosesForTreatment(treatmentId: number): Promise<number> {
  const [row] = await db
    .select({
      treatment: treatmentsTable,
      patientTimezone: patientsTable.timezone,
    })
    .from(treatmentsTable)
    .innerJoin(patientsTable, eq(treatmentsTable.patientId, patientsTable.id))
    .where(eq(treatmentsTable.id, treatmentId))
    .limit(1);

  if (!row || row.treatment.status !== "active") return 0;

  const windowStart = Clock.now();
  const windowEnd = new Date(windowStart.getTime() + DOSE_WINDOW_DAYS * 86_400_000);

  const dates = expandSchedule(
    {
      schedule: row.treatment.scheduleConfig as ScheduleConfig,
      treatmentStartDate: row.treatment.startDate,
      treatmentEndDate: row.treatment.endDate,
      timezone: row.patientTimezone,
    },
    windowStart,
    windowEnd
  );

  if (dates.length === 0) return 0;

  await ensureQueueStarted();

  return db.transaction(async (tx) => {
    const inserted = await tx
      .insert(scheduledDosesTable)
      .values(
        dates.map((scheduledAt) => {
          const { localDate, localTime } = toLocalDateTime(scheduledAt, row.patientTimezone);
          return {
            treatmentId,
            patientId: row.treatment.patientId,
            scheduledAt,
            scheduledLocalDate: localDate,
            scheduledLocalTime: localTime,
            dose: row.treatment.dose,
          };
        })
      )
      // A constraint UNIQUE(treatment_id, scheduled_at) do banco é quem garante
      // idempotência de verdade — isto aqui só evita o erro 23505 subir até o
      // chamador quando a dose já existe.
      .onConflictDoNothing()
      .returning({ id: scheduledDosesTable.id, scheduledAt: scheduledDosesTable.scheduledAt });

    if (inserted.length > 0) {
      await boss.insert(
        QUEUE_DOSE_SCHEDULED,
        inserted.map((d) => ({
          data: { scheduledDoseId: d.id, treatmentId, patientId: row.treatment.patientId, scheduledAt: d.scheduledAt.toISOString() },
          singletonKey: `dose-${d.id}`,
        })),
        { db: fromDrizzle(tx, sql) }
      );

      // ZELO-27/30: a cascata inteira (T+0/15/30/60) agendada de uma vez,
      // já no momento em que a dose é criada — nenhum nível depende do
      // anterior ter disparado pra existir, cada um se autoverifica no
      // disparo (ver dose-reminders.ts). Mesma transação que a dose: se o
      // commit falhar, nem a dose nem os lembretes existem, todos juntos.
      await boss.insert(
        QUEUE_DOSE_REMINDER,
        inserted.flatMap((d) =>
          Object.entries(ESCALATION_LEVELS_MINUTES).map(([level, minutes]) => ({
            data: { scheduledDoseId: d.id, level: Number(level) },
            singletonKey: `reminder:${d.id}:${level}`,
            startAfter: new Date(d.scheduledAt.getTime() + minutes * 60_000),
          }))
        ),
        { db: fromDrizzle(tx, sql) }
      );
    }

    return inserted.length;
  });
}

/**
 * Job diário (chamado pelo worker registrado em lib/queue.ts): estende a
 * janela rolante de todo tratamento ativo. Não precisa de lógica própria de
 * "extensão" — chamar generateDosesForTreatment de novo, mais tarde, já
 * cobre os dias seguintes porque a janela é calculada a partir de
 * Clock.now() no momento da chamada.
 */
export async function extendActiveTreatmentWindows(): Promise<{ treatmentId: number; created: number }[]> {
  const activeTreatments = await db
    .select({ id: treatmentsTable.id })
    .from(treatmentsTable)
    .where(eq(treatmentsTable.status, "active"));

  const results: { treatmentId: number; created: number }[] = [];
  for (const t of activeTreatments) {
    const created = await generateDosesForTreatment(t.id);
    results.push({ treatmentId: t.id, created });
  }
  return results;
}

/**
 * Rede de segurança: para toda dose pendente futura, garante que existe um
 * job DoseScheduled correspondente na fila, reenviando o que faltar.
 * Chamada uma vez ao subir o processo (index.ts). Segura de rodar quantas
 * vezes for preciso — a policy "exclusive" da fila (lib/queue.ts) rejeita
 * silenciosamente o reenvio quando já existe job ativo ou na fila para o
 * mesmo singletonKey (`dose-${id}`), então isto nunca duplica evento.
 */
export async function reconcileDoseQueue(): Promise<number> {
  await ensureQueueStarted();

  const pendingFutureDoses = await db
    .select({
      id: scheduledDosesTable.id,
      treatmentId: scheduledDosesTable.treatmentId,
      patientId: scheduledDosesTable.patientId,
      scheduledAt: scheduledDosesTable.scheduledAt,
    })
    .from(scheduledDosesTable)
    .where(and(eq(scheduledDosesTable.status, "pending"), gte(scheduledDosesTable.scheduledAt, Clock.now())));

  let resent = 0;
  for (const d of pendingFutureDoses) {
    const id = await boss.send(
      QUEUE_DOSE_SCHEDULED,
      { scheduledDoseId: d.id, treatmentId: d.treatmentId, patientId: d.patientId, scheduledAt: d.scheduledAt.toISOString() },
      { singletonKey: `dose-${d.id}` }
    );
    if (id !== null) resent += 1;
  }
  return resent;
}

/**
 * Ao editar a posologia, remove as doses FUTURAS ainda pendentes (nunca as
 * já registradas — isso é histórico) e regenera a partir do schedule novo.
 * Chame antes de gerar de novo.
 */
export async function clearFuturePendingDoses(treatmentId: number): Promise<void> {
  await db
    .delete(scheduledDosesTable)
    .where(
      and(
        eq(scheduledDosesTable.treatmentId, treatmentId),
        eq(scheduledDosesTable.status, "pending"),
        gte(scheduledDosesTable.scheduledAt, Clock.now())
      )
    );
}

/**
 * UPDATE compartilhado por trás das duas rotinas que atribuem "late":
 * a pontual (fecha 1 tratamento) e a varredura global periódica, abaixo.
 * Um único ponto de escrita evita que as duas divirjam silenciosamente se
 * o critério mudar no futuro (ex: gravar quem/o que resolveu a dose).
 */
async function markPendingDosesLate(cutoff: Date, treatmentId?: number): Promise<number> {
  const conditions = [eq(scheduledDosesTable.status, "pending"), lt(scheduledDosesTable.scheduledAt, cutoff)];
  if (treatmentId !== undefined) conditions.push(eq(scheduledDosesTable.treatmentId, treatmentId));

  const updated = await db
    .update(scheduledDosesTable)
    .set({ status: "late", updatedAt: Clock.now() })
    .where(and(...conditions))
    .returning({ id: scheduledDosesTable.id });

  return updated.length;
}

/**
 * Doses que ficaram "pending" com o horário já passado (nunca registradas)
 * viram "late" quando o tratamento que as gerou para de estar ativo —
 * "pending" significa "ainda vai acontecer", o que deixa de ser verdade
 * depois de encerrar/pausar/cancelar. "late" continua registrável
 * retroativamente (ZELO-24) — isto não fecha a porta, só corrige o status.
 * Sem folga (corta em Clock.now()): o tratamento já fechou, não há razão
 * pra deixar uma dose seguir "pending" mais alguns minutos.
 */
async function resolveOverdueDosesAsLate(treatmentId: number): Promise<void> {
  await markPendingDosesLate(Clock.now(), treatmentId);
}

// Folga antes de marcar uma dose como "late" na varredura global (abaixo).
// Existe pra não fazer uma dose "piscar" pra Perdidas no minuto exato em
// que passa da hora — o cuidador ainda tem uma janela curta pra registrar
// sem que o app pareça precipitado ("perdida não é sentença", ZELO-24).
export const LATE_GRACE_MINUTES = 30;

/**
 * Varredura periódica (cron, ver lib/queue.ts): marca como "late" toda
 * scheduled_dose "pending" cujo horário já passou há mais de
 * LATE_GRACE_MINUTES — de QUALQUER tratamento, ativo ou não.
 *
 * Por que isto precisa existir além de resolveOverdueDosesAsLate: aquela
 * função só roda no momento em que o PRÓPRIO tratamento encerra/pausa
 * (cancelFutureDoses). Para um tratamento que continua ativo — o caso
 * comum — uma dose que passa da hora sem ser registrada ficava "pending"
 * indefinidamente, e a seção "Perdidas" da tela inicial (HomePage.tsx,
 * filtra por status==="late") nunca recebia nada. Achado ao investigar a
 * instabilidade do teste de closeExpiredTreatments — nada além daquele
 * fechamento pontual jamais atribuía "late" a uma dose.
 *
 * Roda a cada 15min (não 1x/dia como os outros crons de manutenção): uma
 * dose perdida de manhã não pode esperar até a madrugada do dia seguinte
 * pra aparecer como perdida — o atraso total pro cuidador ver "Perdidas"
 * fica limitado a ~folga + intervalo do cron, não a até 24h.
 */
export async function markOverdueDosesAsLate(): Promise<number> {
  const cutoff = new Date(Clock.now().getTime() - LATE_GRACE_MINUTES * 60_000);
  return markPendingDosesLate(cutoff);
}

/**
 * Cancela doses futuras pendentes quando um tratamento é encerrado/pausado,
 * e resolve as que já passaram da hora sem registro para "late" (ver
 * resolveOverdueDosesAsLate) — as duas juntas cobrem toda dose "pending"
 * do tratamento, futura ou não.
 */
export async function cancelFutureDoses(treatmentId: number): Promise<void> {
  await clearFuturePendingDoses(treatmentId);
  await resolveOverdueDosesAsLate(treatmentId);
}
