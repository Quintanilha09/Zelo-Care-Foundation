/**
 * Estoque — ZELO (ZELO-23, ZELO-34).
 *
 * Decrementa reagindo ao evento DoseTaken (ZELO-23) — decoupled de
 * propósito: dose-records.ts não conhece este módulo, só publica o evento
 * na fila (lib/queue.ts). Quem decrementa é o worker registrado em
 * startQueue (index.ts).
 *
 * ZELO-34: "dias restantes" vem do CONSUMO PRESCRITO pela posologia
 * (quantas doses/dia o tratamento ativo pede), não do histórico real de
 * registro — um dia em que o cuidador esqueceu de registrar não pode
 * fazer o estoque "durar mais" na conta. A taxa é estimada reaproveitando
 * o motor de recorrência já testado (expandSchedule) sobre uma janela
 * futura, em vez de reimplementar a fórmula de doses/dia por tipo de
 * posologia (5 tipos, cada um com sua conta — errar um é fácil).
 */
import { eq, and } from "drizzle-orm";
import { db } from "@workspace/db";
import { stockEntriesTable, medicationsTable, treatmentsTable, patientsTable, type StockEntry, type Treatment } from "@workspace/db";
import { Clock } from "./clock.ts";
import { publishPatientEvent } from "./realtime.ts";
import { expandSchedule, type ScheduleConfig } from "@workspace/scheduling";

const RATE_WINDOW_DAYS = 90; // janela grande o bastante pra médias corretas em ciclo_com_pausa/dias_alternados
const LOW_STOCK_ALERT_DAYS = 5; // critério de aceite da história

/**
 * Doses/dia "de regime" a partir da posologia — nunca do consumo real.
 * treatmentEndDate propositalmente null aqui: a pergunta é "a que taxa
 * este esquema consome remédio", não "quanto falta pro tratamento acabar"
 * (isso já aparece em outro lugar da tela, não precisa se misturar aqui).
 */
function computeDosesPerDay(scheduleConfig: ScheduleConfig, timezone: string): number {
  const windowStart = Clock.now();
  const windowEnd = new Date(windowStart.getTime() + RATE_WINDOW_DAYS * 86_400_000);
  const count = expandSchedule(
    {
      schedule: scheduleConfig,
      treatmentStartDate: Clock.todayInTimezone(timezone),
      treatmentEndDate: null,
      timezone,
    },
    windowStart,
    windowEnd
  ).length;
  return count / RATE_WINDOW_DAYS;
}

export interface DaysRemaining {
  daysRemainingByStock: number | null; // null = sem tratamento ativo pra estimar taxa (posologia zerada, etc.)
  daysUntilPrescriptionExpires: number | null;
  effectiveDaysRemaining: number | null; // o menor dos dois — o que manda pro alerta
  isLow: boolean;
}

type TreatmentScheduleInfo = Pick<Treatment, "scheduleConfig">;

/** Sem tratamento ativo pra aquele medicamento, não dá pra estimar taxa nenhuma — nem alerta, nem "durou X dias". */
export function computeDaysRemaining(
  stock: Pick<StockEntry, "quantityRemaining" | "prescriptionExpiresAt">,
  activeTreatment: TreatmentScheduleInfo | null,
  patientTimezone: string
): DaysRemaining {
  const dosesPerDay = activeTreatment ? computeDosesPerDay(activeTreatment.scheduleConfig as ScheduleConfig, patientTimezone) : 0;
  const daysRemainingByStock = dosesPerDay > 0 ? stock.quantityRemaining / dosesPerDay : null;

  let daysUntilPrescriptionExpires: number | null = null;
  if (stock.prescriptionExpiresAt) {
    const todayISO = Clock.todayInTimezone(patientTimezone);
    const diffDays = (new Date(`${stock.prescriptionExpiresAt}T00:00:00Z`).getTime() - new Date(`${todayISO}T00:00:00Z`).getTime()) / 86_400_000;
    daysUntilPrescriptionExpires = Math.max(0, diffDays);
  }

  const candidates = [daysRemainingByStock, daysUntilPrescriptionExpires].filter((d): d is number => d !== null);
  const effectiveDaysRemaining = candidates.length > 0 ? Math.min(...candidates) : null;

  return {
    daysRemainingByStock,
    daysUntilPrescriptionExpires,
    effectiveDaysRemaining,
    // Sem tratamento ativo NÃO há alerta — Issue #65.
    //
    // O comentário no topo desta função já dizia isso desde a ZELO-34; a
    // implementação é que não seguia. `daysRemainingByStock` fica nulo sem
    // tratamento, mas `daysUntilPrescriptionExpires` continuava valendo, e
    // uma receita vencida virava `effectiveDaysRemaining: 0` — ou seja,
    // ÂMBAR num estoque que sobrou de um tratamento cancelado.
    //
    // Não há nada de errado em ter comprimido sobrando de um tratamento que
    // acabou. Âmbar neste produto quer dizer dose pendente ou atrasada
    // (invariante 5); usá-lo para isto é ruído que ensina a ignorar âmbar.
    //
    // Corrigido aqui, e não na tela, porque `isLow` também alimenta o painel
    // do dia e o alerta de reposição — os três estavam errados juntos.
    isLow:
      activeTreatment !== null &&
      effectiveDaysRemaining !== null &&
      effectiveDaysRemaining <= LOW_STOCK_ALERT_DAYS,
  };
}

/** Carrega o tratamento ATIVO daquele medicamento pro paciente — só ele define a taxa de consumo corrente. */
export async function loadActiveTreatmentSchedule(patientId: number, medicationId: number): Promise<TreatmentScheduleInfo | null> {
  const [treatment] = await db
    .select({ scheduleConfig: treatmentsTable.scheduleConfig })
    .from(treatmentsTable)
    .where(and(eq(treatmentsTable.patientId, patientId), eq(treatmentsTable.medicationId, medicationId), eq(treatmentsTable.status, "active")))
    .limit(1);
  return treatment ?? null;
}

/**
 * Decrementa 1 unidade do estoque do medicamento do paciente, se houver
 * estoque cadastrado. Sem estoque cadastrado, não faz nada — rastrear
 * estoque é opcional, não todo tratamento tem.
 */
export async function decrementStockForDoseTaken(patientId: number, medicationId: number): Promise<void> {
  const [stock] = await db
    .select()
    .from(stockEntriesTable)
    .where(and(eq(stockEntriesTable.patientId, patientId), eq(stockEntriesTable.medicationId, medicationId)))
    .limit(1);
  if (!stock) return;

  const [patient] = await db.select({ timezone: patientsTable.timezone }).from(patientsTable).where(eq(patientsTable.id, patientId)).limit(1);
  if (!patient) return;

  const activeTreatment = await loadActiveTreatmentSchedule(patientId, medicationId);
  const before = computeDaysRemaining(stock, activeTreatment, patient.timezone);

  const newQuantity = Math.max(0, stock.quantityRemaining - 1);
  await db
    .update(stockEntriesTable)
    .set({ quantityRemaining: newQuantity, updatedAt: Clock.now() })
    .where(eq(stockEntriesTable.id, stock.id));

  // Só avisa em tempo real quando CRUZA pra baixo do limite agora —
  // decrementar quando já estava baixo não deveria reemitir o aviso.
  const after = computeDaysRemaining({ ...stock, quantityRemaining: newQuantity }, activeTreatment, patient.timezone);
  if (after.isLow && !before.isLow) {
    const [medication] = await db.select({ name: medicationsTable.name }).from(medicationsTable).where(eq(medicationsTable.id, medicationId)).limit(1);
    publishPatientEvent(patientId, { type: "low_stock", medicationName: medication?.name ?? "Medicamento" });
  }
}
