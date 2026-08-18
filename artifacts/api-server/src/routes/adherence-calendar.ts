import { getAuth } from "../lib/auth-types.ts";
/**
 * Calendário de adesão — ZELO (ZELO-33).
 *
 * "A decisão de tom mais importante do produto" (spec): mostrar o que
 * aconteceu sem virar boletim de notas. Duas cores só, nunca vermelho:
 * - verde: toda dose daquele dia foi RESOLVIDA (tomada, pulada ou adiada —
 *   qualquer decisão registrada, não só "tomou")
 * - âmbar: sobrou pelo menos 1 dose sem NENHUM registro (pending/late)
 * - cinza: não havia dose agendada naquele dia (sem tratamento ativo)
 *
 * "Resolvido" (cor do calendário) e "adesão" (percentual) são conceitos
 * DIFERENTES de propósito — pular uma dose é uma decisão registrada (conta
 * pra cor verde), mas não é ADESÃO (não conta no percentual, que é
 * especificamente taken/total, mesma definição já usada em
 * GET /adherence-stats desde antes desta história).
 *
 * "Paginado" aqui é a própria janela from/to — o cliente sempre pede um
 * intervalo (um mês, uma semana), nunca "o histórico inteiro"; não existe
 * cursor porque a navegação por mês já cumpre esse papel.
 */
import { Router } from "express";
import { sql, eq, and, gte, lte } from "drizzle-orm";
import { z } from "zod";
import { db } from "@workspace/db";
import {
  patientsTable, treatmentsTable, medicationsTable, scheduledDosesTable,
  doseRecordsTable, caregiversTable,
} from "@workspace/db";
import { requireAuth } from "../middleware/require-auth";
import { Clock } from "../lib/clock.ts";
import { hasPaidAccess } from "../lib/subscription.ts";
import { localDayBoundsUtc } from "@workspace/scheduling";

const router = Router();

const DateISO = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "data deve ser YYYY-MM-DD");
const MAX_RANGE_DAYS = 366;
const FREE_PLAN_WINDOW_DAYS = 7;

async function loadPatient(patientId: number, familyId: number) {
  const [patient] = await db
    .select({ id: patientsTable.id, timezone: patientsTable.timezone, familyId: patientsTable.familyId })
    .from(patientsTable)
    .where(and(eq(patientsTable.id, patientId), eq(patientsTable.familyId, familyId)))
    .limit(1);
  return patient ?? null;
}

function daysBetween(fromISO: string, toISO: string): number {
  return Math.round((new Date(`${toISO}T00:00:00Z`).getTime() - new Date(`${fromISO}T00:00:00Z`).getTime()) / 86_400_000);
}
function subtractDays(dateISO: string, days: number): string {
  const d = new Date(`${dateISO}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}
function nextDay(dateISO: string): string {
  return subtractDays(dateISO, -1);
}

router.get("/patients/:patientId/adherence-calendar", requireAuth, async (req, res): Promise<void> => {
  const patientId = Number(req.params.patientId);
  if (isNaN(patientId)) { res.status(400).json({ error: "ID inválido" }); return; }

  const patient = await loadPatient(patientId, getAuth(req).familyId);
  if (!patient) { res.status(404).json({ error: "Paciente não encontrado" }); return; }

  const query = z.object({
    from: DateISO,
    to: DateISO,
    medicationId: z.coerce.number().int().positive().optional(),
  }).safeParse(req.query);
  if (!query.success) { res.status(400).json({ error: query.error.message }); return; }
  let { from } = query.data;
  const { to, medicationId } = query.data;

  if (from > to) { res.status(400).json({ error: "'from' precisa ser antes de 'to'" }); return; }
  if (daysBetween(from, to) > MAX_RANGE_DAYS) { res.status(400).json({ error: `intervalo máximo de ${MAX_RANGE_DAYS} dias` }); return; }

  let planLimited = false;
  if (!(await hasPaidAccess(getAuth(req).familyId))) {
    const earliestAllowed = subtractDays(Clock.todayInTimezone(patient.timezone), FREE_PLAN_WINDOW_DAYS - 1);
    if (from < earliestAllowed) {
      from = earliestAllowed;
      planLimited = true;
    }
  }

  const medicationFilter = medicationId ? eq(treatmentsTable.medicationId, medicationId) : undefined;
  const rangeFilter = and(
    eq(scheduledDosesTable.patientId, patientId),
    gte(scheduledDosesTable.scheduledLocalDate, from),
    lte(scheduledDosesTable.scheduledLocalDate, to),
    medicationFilter
  );

  const dayRows = await db
    .select({
      date: scheduledDosesTable.scheduledLocalDate,
      total: sql<number>`count(*)`.mapWith(Number),
      unresolved: sql<number>`count(*) filter (where ${scheduledDosesTable.status} in ('pending', 'late'))`.mapWith(Number),
    })
    .from(scheduledDosesTable)
    .innerJoin(treatmentsTable, eq(scheduledDosesTable.treatmentId, treatmentsTable.id))
    .where(rangeFilter)
    .groupBy(scheduledDosesTable.scheduledLocalDate);

  const byDate = new Map(dayRows.map((r) => [r.date, r]));
  const days: Array<{ date: string; status: "green" | "amber" | "gray" }> = [];
  for (let d = from; d <= to; d = nextDay(d)) {
    const row = byDate.get(d);
    days.push({ date: d, status: !row || row.total === 0 ? "gray" : row.unresolved > 0 ? "amber" : "green" });
  }

  const [totals] = await db
    .select({
      total: sql<number>`count(*)`.mapWith(Number),
      taken: sql<number>`count(*) filter (where ${scheduledDosesTable.status} = 'taken')`.mapWith(Number),
      unregistered: sql<number>`count(*) filter (where ${scheduledDosesTable.status} in ('pending', 'late'))`.mapWith(Number),
    })
    .from(scheduledDosesTable)
    .innerJoin(treatmentsTable, eq(scheduledDosesTable.treatmentId, treatmentsTable.id))
    .where(rangeFilter);

  const byMedicationRows = await db
    .select({
      medicationId: treatmentsTable.medicationId,
      medicationName: medicationsTable.name,
      total: sql<number>`count(*)`.mapWith(Number),
      taken: sql<number>`count(*) filter (where ${scheduledDosesTable.status} = 'taken')`.mapWith(Number),
    })
    .from(scheduledDosesTable)
    .innerJoin(treatmentsTable, eq(scheduledDosesTable.treatmentId, treatmentsTable.id))
    .innerJoin(medicationsTable, eq(treatmentsTable.medicationId, medicationsTable.id))
    .where(rangeFilter)
    .groupBy(treatmentsTable.medicationId, medicationsTable.name);

  // "Reconhece contribuição" — nunca ranquear: a ordem de resposta segue o
  // id do cuidador (estável), não a contagem. É o front que decide como
  // exibir, mas a API não entrega isso já ordenado por "quem mais registrou".
  const byCaregiverRows = await db
    .select({
      caregiverId: doseRecordsTable.caregiverId,
      caregiverName: caregiversTable.name,
      registeredCount: sql<number>`count(*)`.mapWith(Number),
    })
    .from(doseRecordsTable)
    .innerJoin(scheduledDosesTable, eq(doseRecordsTable.scheduledDoseId, scheduledDosesTable.id))
    .innerJoin(treatmentsTable, eq(scheduledDosesTable.treatmentId, treatmentsTable.id))
    .innerJoin(caregiversTable, eq(doseRecordsTable.caregiverId, caregiversTable.id))
    .where(rangeFilter)
    .groupBy(doseRecordsTable.caregiverId, caregiversTable.name)
    .orderBy(doseRecordsTable.caregiverId);

  const total = totals?.total ?? 0;
  const taken = totals?.taken ?? 0;

  res.json({
    from, to, planLimited,
    days,
    summary: {
      totalScheduled: total,
      totalUnregistered: totals?.unregistered ?? 0,
      // "3 doses ficaram sem registro" — nunca "você perdeu 3 doses". A
      // frase em si não vem do servidor (é copy de tela), mas o número que
      // ela usa é este, de propósito neutro no nome do campo.
      adherenceRate: total > 0 ? taken / total : null,
      byMedication: byMedicationRows.map((r) => ({
        medicationId: r.medicationId, medicationName: r.medicationName,
        totalScheduled: r.total, adherenceRate: r.total > 0 ? r.taken / r.total : null,
      })),
      byCaregiver: byCaregiverRows.map((r) => ({ caregiverId: r.caregiverId, caregiverName: r.caregiverName, registeredCount: r.registeredCount })),
    },
  });
});

router.get("/patients/:patientId/adherence-calendar/day", requireAuth, async (req, res): Promise<void> => {
  const patientId = Number(req.params.patientId);
  if (isNaN(patientId)) { res.status(400).json({ error: "ID inválido" }); return; }

  const patient = await loadPatient(patientId, getAuth(req).familyId);
  if (!patient) { res.status(404).json({ error: "Paciente não encontrado" }); return; }

  const query = z.object({ date: DateISO, caregiverId: z.coerce.number().int().positive().optional() }).safeParse(req.query);
  if (!query.success) { res.status(400).json({ error: query.error.message }); return; }
  const { date, caregiverId } = query.data;

  const { start, end } = localDayBoundsUtc(date, patient.timezone);

  const doses = await db
    .select({
      id: scheduledDosesTable.id,
      scheduledLocalTime: scheduledDosesTable.scheduledLocalTime,
      status: scheduledDosesTable.status,
      medicationName: medicationsTable.name,
      dose: scheduledDosesTable.dose,
      outcome: doseRecordsTable.outcome,
      registeredAt: doseRecordsTable.takenAt,
      registeredByCaregiverId: doseRecordsTable.caregiverId,
      registeredByCaregiverName: caregiversTable.name,
    })
    .from(scheduledDosesTable)
    .innerJoin(treatmentsTable, eq(scheduledDosesTable.treatmentId, treatmentsTable.id))
    .innerJoin(medicationsTable, eq(treatmentsTable.medicationId, medicationsTable.id))
    .leftJoin(doseRecordsTable, eq(doseRecordsTable.scheduledDoseId, scheduledDosesTable.id))
    .leftJoin(caregiversTable, eq(doseRecordsTable.caregiverId, caregiversTable.id))
    .where(and(
      eq(scheduledDosesTable.patientId, patientId),
      gte(scheduledDosesTable.scheduledAt, start),
      lte(scheduledDosesTable.scheduledAt, end),
      caregiverId ? eq(doseRecordsTable.caregiverId, caregiverId) : undefined
    ))
    .orderBy(scheduledDosesTable.scheduledLocalTime);

  res.json({ date, doses });
});

export default router;
