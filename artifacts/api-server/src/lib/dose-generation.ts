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

  /**
   * O mapa horário → dose, quando existe — Issue #171.
   *
   * Lido do `scheduleConfig` e não de coluna nova: ele é a posologia, e a
   * dose de cada horário É parte da posologia. Tratamento antigo não tem o
   * campo, e aí o mapa é vazio — todo horário cai na dose do tratamento,
   * exatamente como antes.
   */
  const posologia = row.treatment.scheduleConfig as {
    dosePorHorario?: Record<string, string>;
    degraus?: DegrauDeDesmame[];
  };
  const dosePorHorario = posologia.dosePorHorario ?? {};
  const degraus = posologia.degraus ?? [];

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
            /**
             * A dose DESTE horário — Issue #171.
             *
             * "1 comprimido de manhã e 2 à noite" não cabia num campo só.
             * O mapa é exceção declarada: horário fora dele usa a dose do
             * tratamento, como sempre foi.
             *
             * Continua sendo INSTANTÂNEO (a coluna é cópia do momento do
             * agendamento, ver #170): mudar a dose depois não reescreve o
             * que já foi agendado nem o que já foi tomado.
             */
            /**
             * A ordem de precedência da dose — cada nível responde a uma
             * pergunta diferente:
             *
             *   1. o HORÁRIO (#171) — "2 comprimidos à noite"
             *   2. o DEGRAU  (#172) — "20mg nesta semana do desmame"
             *   3. o TRATAMENTO     — a dose de sempre
             *
             * O horário ganha do degrau porque é mais específico: quem diz
             * "meio comprimido às 22:00" está falando daquele horário, e não
             * da fase do desmame. Na prática os dois raramente convivem.
             */
            dose:
              dosePorHorario[localTime] ??
              doseDoDegrau(degraus, row.treatment.startDate, localDate) ??
              row.treatment.dose,
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

// ── Desmame: a dose que muda ao longo do tratamento — Issue #172 ───────────

/**
 * Um degrau de um desmame: uma dose que vale por um número de dias.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * "40mg POR 5 DIAS, 20mg POR 5, 10mg POR 5, DEPOIS PARA."
 *
 * Receita comum de corticoide, e também de ansiolítico e antidepressivo sendo
 * retirados. Até a #172 era preciso criar quatro tratamentos e encerrar cada
 * um à mão — e **cada transição era uma chance de esquecer**. Esquecer um
 * degrau de desmame de corticoide não é um detalhe administrativo.
 * ═══════════════════════════════════════════════════════════════════════════
 */
export interface DegrauDeDesmame {
  dose: string;
  dias: number;
}

/**
 * A dose que vale num dia do tratamento.
 *
 * Os degraus são contados a partir do **início do tratamento**, em dias
 * civis: o primeiro cobre `[0, dias0)`, o segundo `[dias0, dias0+dias1)`, e
 * assim por diante.
 *
 * ── Depois do último degrau, `null` ──────────────────────────────────────
 *
 * E `null` não é "sem dose": é "os degraus não falam deste dia". Quem chama
 * cai na dose do tratamento, que é o comportamento de sempre. Um desmame bem
 * cadastrado termina junto com a data de fim, e aí este caso não acontece —
 * mas quem cadastrou degraus que somam menos que o tratamento não pode ficar
 * com dose vazia no fim.
 */
export function doseDoDegrau(
  degraus: DegrauDeDesmame[],
  startDate: string,
  localDate: string,
): string | null {
  if (degraus.length === 0) return null;

  // Datas civis em UTC de propósito: as duas são "YYYY-MM-DD" sem hora, e
  // interpretá-las no fuso do processo faria a conta pular um dia na virada.
  const inicio = Date.parse(`${startDate}T00:00:00Z`);
  const dia = Date.parse(`${localDate}T00:00:00Z`);
  if (Number.isNaN(inicio) || Number.isNaN(dia)) return null;

  const diasDesdeOInicio = Math.floor((dia - inicio) / 86_400_000);
  if (diasDesdeOInicio < 0) return null;

  let acumulado = 0;
  for (const degrau of degraus) {
    acumulado += degrau.dias;
    if (diasDesdeOInicio < acumulado) return degrau.dose;
  }
  return null;
}

/**
 * Os dias (a partir do início) em que a dose MUDA.
 *
 * O primeiro degrau não conta: ele começa junto com o tratamento, e avisar
 * "amanhã a dose muda" na véspera do primeiro dia seria avisar que o
 * tratamento vai começar — que é outra coisa, e já tem aviso próprio.
 */
export function diasDeViradaDeDegrau(degraus: DegrauDeDesmame[]): number[] {
  const viradas: number[] = [];
  let acumulado = 0;
  for (const degrau of degraus.slice(0, -1)) {
    acumulado += degrau.dias;
    viradas.push(acumulado);
  }
  return viradas;
}
