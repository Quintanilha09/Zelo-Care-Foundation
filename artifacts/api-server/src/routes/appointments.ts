import { getAuth } from "../lib/auth-types.ts";
/**
 * Consultas e exames — ZELO (ZELO-36).
 *
 * "A segunda maior fonte de ansiedade do cuidador, depois do remédio."
 * preparationNotes é sempre texto do que o MÉDICO disse — nunca orientação
 * do próprio app (crítério de aceite explícito da história).
 */
import { Router } from "express";
import multer from "multer";
import { eq, and, gte, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@workspace/db";
import { appointmentsTable, patientsTable } from "@workspace/db";
import { localToUtc, toLocalDateTime } from "@workspace/scheduling";
import { requireAuth } from "../middleware/require-auth";
import { requireCapability } from "../lib/capabilities.ts";
import { audit } from "../lib/audit";
import { Clock } from "../lib/clock.ts";
import { rescheduleAppointmentReminders } from "../lib/appointment-reminders.ts";
import { getPlanLimits } from "../lib/plan-limits.ts";

const DateISO = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "data deve ser YYYY-MM-DD");
const TimeOfDay = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "horário deve ser HH:mm");

const router = Router();

const ACCEPTED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => cb(null, ACCEPTED_MIME_TYPES.has(file.mimetype)),
});

const AppointmentBody = z.object({
  type: z.enum(["consultation", "exam", "procedure"]).optional(),
  specialty: z.string().min(1),
  doctorName: z.string().optional().nullable(),
  location: z.string().optional().nullable(),
  // Data+hora CIVIL separadas, nunca um ISO com fuso implícito do
  // navegador — combinadas com o fuso do PACIENTE no servidor (mesma regra
  // da ZELO-19: "14h" é 14h no relógio de parede de onde a consulta
  // acontece, não no fuso de quem está cadastrando).
  scheduledDate: DateISO,
  scheduledTime: TimeOfDay,
  notes: z.string().optional().nullable(),
  preparationNotes: z.string().optional().nullable(),
});

const UpdateAppointmentBody = AppointmentBody.partial().extend({
  status: z.enum(["scheduled", "completed", "cancelled", "rescheduled"]).optional(),
  postAppointmentNotes: z.string().optional().nullable(),
  questionsForDoctor: z.array(z.string().min(1)).optional(),
});

async function loadPatient(patientId: number, familyId: number) {
  const [patient] = await db
    .select({ id: patientsTable.id, timezone: patientsTable.timezone })
    .from(patientsTable)
    .where(and(eq(patientsTable.id, patientId), eq(patientsTable.familyId, familyId)))
    .limit(1);
  return patient ?? null;
}

async function loadAppointment(appointmentId: number, patientId: number, familyId: number) {
  const patient = await loadPatient(patientId, familyId);
  if (!patient) return null;
  const [appointment] = await db
    .select()
    .from(appointmentsTable)
    .where(and(eq(appointmentsTable.id, appointmentId), eq(appointmentsTable.patientId, patientId)))
    .limit(1);
  return appointment ?? null;
}

router.get("/patients/:patientId/appointments", requireAuth, async (req, res): Promise<void> => {
  const patientId = Number(req.params.patientId);
  if (isNaN(patientId)) { res.status(400).json({ error: "ID inválido" }); return; }

  const patient = await loadPatient(patientId, getAuth(req).familyId);
  if (!patient) { res.status(404).json({ error: "Paciente não encontrado" }); return; }

  const query = z.object({ upcomingOnly: z.coerce.boolean().optional() }).safeParse(req.query);
  const upcomingOnly = query.success && query.data.upcomingOnly;

  const rows = await db
    .select({
      id: appointmentsTable.id, type: appointmentsTable.type, specialty: appointmentsTable.specialty,
      doctorName: appointmentsTable.doctorName, location: appointmentsTable.location,
      scheduledAt: appointmentsTable.scheduledAt, notes: appointmentsTable.notes,
      preparationNotes: appointmentsTable.preparationNotes, questionsForDoctor: appointmentsTable.questionsForDoctor,
      postAppointmentNotes: appointmentsTable.postAppointmentNotes, status: appointmentsTable.status,
      // Boolean calculado NO Postgres — nunca traz o base64 do anexo pra
      // fora do banco só pra listar (bloataria toda consulta a cada fetch);
      // o anexo em si tem rota própria.
      hasAttachment: sql<boolean>`${appointmentsTable.attachmentData} is not null`,
    })
    .from(appointmentsTable)
    .where(and(
      eq(appointmentsTable.patientId, patientId),
      upcomingOnly ? and(eq(appointmentsTable.status, "scheduled"), gte(appointmentsTable.scheduledAt, Clock.now())) : undefined
    ))
    .orderBy(appointmentsTable.scheduledAt);

  // scheduledLocalDate/scheduledLocalTime resolvidos AQUI, no fuso do
  // paciente — nunca deixar o cliente reconverter o instante UTC sozinho
  // (mesmo bug de fronteira de fuso que a ZELO-19 já corrigiu uma vez,
  // desta vez pra consulta em vez de dose).
  res.json(rows.map((r) => {
    const { localDate, localTime } = toLocalDateTime(r.scheduledAt, patient.timezone);
    return { ...r, scheduledLocalDate: localDate, scheduledLocalTime: localTime };
  }));
});

router.post("/patients/:patientId/appointments", requireAuth, requireCapability("edit_treatment"), async (req, res): Promise<void> => {
  const patientId = Number(req.params.patientId);
  if (isNaN(patientId)) { res.status(400).json({ error: "ID inválido" }); return; }

  const patient = await loadPatient(patientId, getAuth(req).familyId);
  if (!patient) { res.status(404).json({ error: "Paciente não encontrado" }); return; }

  // ZELO-38: "Consultas e exames" é recurso do plano Família por inteiro —
  // mesmo desenho do relatório em PDF (ZELO-35), paywall duro na criação.
  const limits = await getPlanLimits(getAuth(req).familyId);
  if (!limits.appointments) {
    res.status(403).json({ error: "Agenda de consultas é um recurso do plano Família.", code: "PLAN_LIMIT" });
    return;
  }

  const body = AppointmentBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }

  const scheduledAt = localToUtc(body.data.scheduledDate, body.data.scheduledTime, patient.timezone);

  // Não existe consulta no passado. O formulário também impede, mas o cliente
  // não é fronteira: quem chamar a API direto tem que receber o mesmo não.
  // A comparação usa o fuso DO PACIENTE, que é o que define o dia civil dele.
  if (scheduledAt.getTime() <= Clock.now().getTime()) {
    res.status(400).json({
      error: "Essa data já passou. Escolha uma data a partir de hoje.",
      code: "APPOINTMENT_IN_THE_PAST",
    });
    return;
  }

  const [appointment] = await db.insert(appointmentsTable).values({
    patientId, type: body.data.type ?? "consultation", specialty: body.data.specialty,
    doctorName: body.data.doctorName, location: body.data.location,
    scheduledAt, notes: body.data.notes,
    preparationNotes: body.data.preparationNotes,
  }).returning();

  await rescheduleAppointmentReminders(appointment.id, appointment.scheduledAt);

  await audit({
    familyId: getAuth(req).familyId, entityType: "appointment", entityId: String(appointment.id),
    action: "created", actorId: String(getAuth(req).caregiverId), actorType: "caregiver",
  });

  res.status(201).json(appointment);
});

router.patch("/patients/:patientId/appointments/:appointmentId", requireAuth, requireCapability("edit_treatment"), async (req, res): Promise<void> => {
  const patientId = Number(req.params.patientId);
  const appointmentId = Number(req.params.appointmentId);
  if (isNaN(patientId) || isNaN(appointmentId)) { res.status(400).json({ error: "ID inválido" }); return; }

  const patient = await loadPatient(patientId, getAuth(req).familyId);
  if (!patient) { res.status(404).json({ error: "Paciente não encontrado" }); return; }
  const existing = await loadAppointment(appointmentId, patientId, getAuth(req).familyId);
  if (!existing) { res.status(404).json({ error: "Consulta não encontrada" }); return; }

  const body = UpdateAppointmentBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }

  const { scheduledDate, scheduledTime, ...rest } = body.data;
  const rescheduled = scheduledDate !== undefined && scheduledTime !== undefined;
  const [updated] = await db
    .update(appointmentsTable)
    .set({
      ...rest,
      ...(rescheduled ? { scheduledAt: localToUtc(scheduledDate, scheduledTime, patient.timezone) } : {}),
      updatedAt: Clock.now(),
    })
    .where(eq(appointmentsTable.id, appointmentId))
    .returning();

  // Remarcar (nova data) ou mudar de status sempre recalcula os lembretes a
  // partir do estado final: "scheduled" reagenda os 3 níveis a partir do
  // scheduledAt atual, qualquer outro status só cancela — nunca deixa lembrete
  // órfão de uma consulta cancelada/concluída/remarcada.
  if (rescheduled || body.data.status !== undefined) {
    await rescheduleAppointmentReminders(appointmentId, updated.status === "scheduled" ? updated.scheduledAt : null);
  }

  await audit({
    familyId: getAuth(req).familyId, entityType: "appointment", entityId: String(appointmentId),
    action: "updated", actorId: String(getAuth(req).caregiverId), actorType: "caregiver",
  });

  res.json(updated);
});

router.post(
  "/patients/:patientId/appointments/:appointmentId/attachment",
  requireAuth, requireCapability("edit_treatment"), upload.single("file"),
  async (req, res): Promise<void> => {
    const patientId = Number(req.params.patientId);
    const appointmentId = Number(req.params.appointmentId);
    if (isNaN(patientId) || isNaN(appointmentId)) { res.status(400).json({ error: "ID inválido" }); return; }

    const existing = await loadAppointment(appointmentId, patientId, getAuth(req).familyId);
    if (!existing) { res.status(404).json({ error: "Consulta não encontrada" }); return; }

    if (!req.file) { res.status(400).json({ error: "Envie um arquivo em JPEG, PNG, WebP ou PDF, até 8MB." }); return; }

    await db.update(appointmentsTable).set({
      attachmentData: req.file.buffer.toString("base64"),
      attachmentMimeType: req.file.mimetype,
      attachmentFileName: req.file.originalname,
      updatedAt: Clock.now(),
    }).where(eq(appointmentsTable.id, appointmentId));

    res.status(201).json({ ok: true });
  }
);

router.get("/patients/:patientId/appointments/:appointmentId/attachment", requireAuth, async (req, res): Promise<void> => {
  const patientId = Number(req.params.patientId);
  const appointmentId = Number(req.params.appointmentId);
  if (isNaN(patientId) || isNaN(appointmentId)) { res.status(400).json({ error: "ID inválido" }); return; }

  const appointment = await loadAppointment(appointmentId, patientId, getAuth(req).familyId);
  if (!appointment || !appointment.attachmentData) { res.status(404).json({ error: "Anexo não encontrado" }); return; }

  res.setHeader("Content-Type", appointment.attachmentMimeType ?? "application/octet-stream");
  res.setHeader("Content-Disposition", `inline; filename="${appointment.attachmentFileName ?? "anexo"}"`);
  res.send(Buffer.from(appointment.attachmentData, "base64"));
});

export default router;
