import { getAuth } from "../lib/auth-types.ts";
/**
 * Tratamentos — ZELO.
 * familyId vem do token JWT, sempre resolvido via patientId -> patients.family_id.
 * Nenhuma tela sugere, calcula ou valida quantidade de dose — o app registra
 * o que o médico prescreveu, nunca opina.
 */
import { Router } from "express";
import { eq, and } from "drizzle-orm";
import { db } from "@workspace/db";
import { treatmentsTable, patientsTable, medicationsTable } from "@workspace/db";
import { z } from "zod";
import { expandSchedule } from "@workspace/scheduling";
import type { ScheduleConfig } from "@workspace/scheduling";
import { requireAuth } from "../middleware/require-auth";
import { audit } from "../lib/audit";
import { Clock } from "../lib/clock";

const router = Router();

const TimeOfDay = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "horário deve ser HH:mm");

const ScheduleConfigBody = z.discriminatedUnion("scheduleType", [
  z.object({ scheduleType: z.literal("times_per_day"), times: z.array(TimeOfDay).min(1) }),
  z.object({ scheduleType: z.literal("every_n_hours"), intervalHours: z.number().int().positive(), startTime: TimeOfDay }),
  z.object({ scheduleType: z.literal("specific_weekdays"), weekdays: z.array(z.number().int().min(0).max(6)).min(1), times: z.array(TimeOfDay).min(1) }),
  z.object({ scheduleType: z.literal("alternate_days"), times: z.array(TimeOfDay).min(1), startDate: z.string() }),
  z.object({ scheduleType: z.literal("cycle_with_pause"), onDays: z.number().int().positive(), offDays: z.number().int().min(0), times: z.array(TimeOfDay).min(1) }),
]);

const CreateTreatmentBody = z.object({
  medicationId: z.number().int().positive(),
  dose: z.string().optional().nullable(), // texto livre — "1 comprimido", "5ml" — nunca validado ou sugerido
  scheduleConfig: ScheduleConfigBody,
  startDate: z.string(),
  endDate: z.string().optional().nullable(),
  instructions: z.string().optional().nullable(),
});

const UpdateTreatmentBody = CreateTreatmentBody.partial().extend({
  status: z.enum(["active", "paused", "finished", "cancelled"]).optional(),
});

const PreviewBody = z.object({
  scheduleConfig: ScheduleConfigBody,
  startDate: z.string(),
  endDate: z.string().optional().nullable(),
});

async function loadPatientInFamily(patientId: number, familyId: number) {
  const [patient] = await db
    .select({ id: patientsTable.id, timezone: patientsTable.timezone, name: patientsTable.name })
    .from(patientsTable)
    .where(and(eq(patientsTable.id, patientId), eq(patientsTable.familyId, familyId)))
    .limit(1);
  return patient ?? null;
}

const WEEKDAY_PT: Record<string, string> = {
  Sunday: "domingo", Monday: "segunda", Tuesday: "terça", Wednesday: "quarta",
  Thursday: "quinta", Friday: "sexta", Saturday: "sábado",
};

/** Linguagem natural, no fuso do paciente: "amanhã às 8h", "quinta às 20h"... */
function describeInPortuguese(dates: Date[], timezone: string): string[] {
  const now = Clock.now();
  const dateFmt = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }); // en-CA = YYYY-MM-DD
  const timeFmt = new Intl.DateTimeFormat("pt-BR", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hour12: false });
  const weekdayFmt = new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "long" });

  const todayISO = dateFmt.format(now);
  const tomorrowISO = dateFmt.format(new Date(now.getTime() + 86_400_000));

  return dates.map((d) => {
    const dateISO = dateFmt.format(d);
    const timeStr = timeFmt.format(d).replace(":", "h");

    let dayLabel: string;
    if (dateISO === todayISO) dayLabel = "hoje";
    else if (dateISO === tomorrowISO) dayLabel = "amanhã";
    else dayLabel = WEEKDAY_PT[weekdayFmt.format(d)];

    return `${dayLabel} às ${timeStr}`;
  });
}

// ── Listar tratamentos de um paciente ─────────────────────────────────────

router.get("/patients/:patientId/treatments", requireAuth, async (req, res): Promise<void> => {
  const patientId = Number(req.params.patientId);
  if (isNaN(patientId)) { res.status(400).json({ error: "ID inválido" }); return; }

  const patient = await loadPatientInFamily(patientId, getAuth(req).familyId);
  if (!patient) { res.status(404).json({ error: "Paciente não encontrado" }); return; }

  const treatments = await db
    .select()
    .from(treatmentsTable)
    .where(eq(treatmentsTable.patientId, patientId))
    .orderBy(treatmentsTable.createdAt);

  res.json(treatments);
});

// ── Pré-visualizar próximas doses, sem salvar nada ────────────────────────

router.post("/patients/:patientId/treatments/preview", requireAuth, async (req, res): Promise<void> => {
  const patientId = Number(req.params.patientId);
  if (isNaN(patientId)) { res.status(400).json({ error: "ID inválido" }); return; }

  const patient = await loadPatientInFamily(patientId, getAuth(req).familyId);
  if (!patient) { res.status(404).json({ error: "Paciente não encontrado" }); return; }

  const body = PreviewBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }

  const windowStart = Clock.now();
  const windowEnd = new Date(windowStart.getTime() + 90 * 86_400_000); // busca até 90 dias à frente para achar 5 doses mesmo em posologias esparsas

  const dates = expandSchedule(
    {
      schedule: body.data.scheduleConfig as ScheduleConfig,
      treatmentStartDate: body.data.startDate,
      treatmentEndDate: body.data.endDate ?? null,
      timezone: patient.timezone,
    },
    windowStart,
    windowEnd
  ).slice(0, 5);

  res.json({
    nextDoses: dates.map((d) => d.toISOString()),
    inPortuguese: describeInPortuguese(dates, patient.timezone),
  });
});

// ── Criar tratamento ───────────────────────────────────────────────────────

router.post("/patients/:patientId/treatments", requireAuth, async (req, res): Promise<void> => {
  const patientId = Number(req.params.patientId);
  if (isNaN(patientId)) { res.status(400).json({ error: "ID inválido" }); return; }

  const patient = await loadPatientInFamily(patientId, getAuth(req).familyId);
  if (!patient) { res.status(404).json({ error: "Paciente não encontrado" }); return; }

  const body = CreateTreatmentBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }

  // Medicamento precisa pertencer à mesma família (mesma checagem de isolamento)
  const [medication] = await db
    .select({ id: medicationsTable.id })
    .from(medicationsTable)
    .where(and(eq(medicationsTable.id, body.data.medicationId), eq(medicationsTable.familyId, getAuth(req).familyId)))
    .limit(1);
  if (!medication) { res.status(404).json({ error: "Medicamento não encontrado" }); return; }

  const [treatment] = await db
    .insert(treatmentsTable)
    .values({
      patientId,
      medicationId: body.data.medicationId,
      dose: body.data.dose ?? null,
      scheduleType: body.data.scheduleConfig.scheduleType,
      scheduleConfig: body.data.scheduleConfig,
      startDate: body.data.startDate,
      endDate: body.data.endDate ?? null,
      instructions: body.data.instructions ?? null,
    })
    .returning();

  await audit({
    familyId: getAuth(req).familyId,
    entityType: "treatment",
    entityId: String(treatment.id),
    action: "created",
    actorId: String(getAuth(req).caregiverId),
    actorType: "caregiver",
    ipAddress: req.ip,
  });

  res.status(201).json(treatment);
});

// ── Ler um tratamento ──────────────────────────────────────────────────────

router.get("/treatments/:treatmentId", requireAuth, async (req, res): Promise<void> => {
  const treatmentId = Number(req.params.treatmentId);
  if (isNaN(treatmentId)) { res.status(400).json({ error: "ID inválido" }); return; }

  const [row] = await db
    .select({ treatment: treatmentsTable, patientFamilyId: patientsTable.familyId })
    .from(treatmentsTable)
    .innerJoin(patientsTable, eq(treatmentsTable.patientId, patientsTable.id))
    .where(eq(treatmentsTable.id, treatmentId))
    .limit(1);

  if (!row || row.patientFamilyId !== getAuth(req).familyId) {
    res.status(404).json({ error: "Tratamento não encontrado" });
    return;
  }
  res.json(row.treatment);
});

// ── Editar tratamento ──────────────────────────────────────────────────────
// Só afeta doses futuras ainda não geradas/registradas — a regeneração real
// de doses fica a cargo do módulo de agendamento (ZELO-18), que compara o
// updatedAt e recria apenas o que ainda não foi tomado.

router.patch("/treatments/:treatmentId", requireAuth, async (req, res): Promise<void> => {
  const treatmentId = Number(req.params.treatmentId);
  if (isNaN(treatmentId)) { res.status(400).json({ error: "ID inválido" }); return; }

  const [existing] = await db
    .select({ treatment: treatmentsTable, patientFamilyId: patientsTable.familyId })
    .from(treatmentsTable)
    .innerJoin(patientsTable, eq(treatmentsTable.patientId, patientsTable.id))
    .where(eq(treatmentsTable.id, treatmentId))
    .limit(1);

  if (!existing || existing.patientFamilyId !== getAuth(req).familyId) {
    res.status(404).json({ error: "Tratamento não encontrado" });
    return;
  }

  const body = UpdateTreatmentBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }

  const { scheduleConfig, ...rest } = body.data;
  const [updated] = await db
    .update(treatmentsTable)
    .set({
      ...rest,
      ...(scheduleConfig ? { scheduleConfig, scheduleType: scheduleConfig.scheduleType } : {}),
      updatedAt: Clock.now(),
    })
    .where(eq(treatmentsTable.id, treatmentId))
    .returning();

  await audit({
    familyId: getAuth(req).familyId,
    entityType: "treatment",
    entityId: String(treatmentId),
    action: "updated",
    actorId: String(getAuth(req).caregiverId),
    actorType: "caregiver",
    ipAddress: req.ip,
  });

  res.json(updated);
});

export default router;
