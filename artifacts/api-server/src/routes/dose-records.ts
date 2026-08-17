import { getAuth } from "../lib/auth-types.ts";
/**
 * Registros de dose — ZELO (ZELO-23).
 *
 * O PRIMEIRO REGISTRO VENCE, garantido pelo banco, não por lógica de
 * aplicação: UNIQUE(scheduled_dose_id) + INSERT ... ON CONFLICT DO NOTHING.
 * Uma corrida perdida nunca vira erro feio — devolve 200 com o registro
 * vencedor e uma mensagem simpática ("Bruno já registrou às 8:02"), nunca
 * 409. É esse desenho que faz 20 requisições simultâneas produzirem
 * exatamente 1 registro sem nenhuma delas quebrar.
 */
import { Router } from "express";
import { eq, and, gte, lte } from "drizzle-orm";
import { db } from "@workspace/db";
import { doseRecordsTable, scheduledDosesTable, treatmentsTable, caregiversTable, patientsTable } from "@workspace/db";
import { z } from "zod";
import { requireAuth } from "../middleware/require-auth";
import { requireCapability } from "../lib/capabilities.ts";
import { safeLog } from "../lib/safe-logger";
import { audit } from "../lib/audit";
import { Clock } from "../lib/clock";
import { boss, QUEUE_DOSE_TAKEN, ensureQueueStarted } from "../lib/queue.ts";

const router = Router();

const UNDO_WINDOW_MS = 60_000;

const ListQuery = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
});

const CreateDoseRecordBody = z.object({
  scheduledDoseId: z.number().int().positive(),
  // patientId vem de req.params — não aceitar do body evita confusão
  takenAt: z.string(),
  outcome: z.enum(["taken", "skipped", "postponed"]),
  postponedTo: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
}).refine((b) => b.outcome !== "postponed" || !!b.postponedTo, {
  message: "postponedTo é obrigatório quando outcome é 'postponed'",
});

/** ZELO-19: nunca formatar horário sem fuso explícito — "8:02" tem que ser 8:02 no relógio do paciente. */
function formatTimeShort(d: Date, timezone: string): string {
  return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: timezone });
}

// ── Listar registros de dose de um paciente ───────────────────────────────

router.get("/patients/:patientId/dose-records", requireAuth, async (req, res): Promise<void> => {
  const patientId = Number(req.params.patientId);
  if (isNaN(patientId)) { res.status(400).json({ error: "ID inválido" }); return; }

  // Verifica isolamento: paciente pertence à família do token
  const [patient] = await db
    .select({ id: patientsTable.id })
    .from(patientsTable)
    .where(and(eq(patientsTable.id, patientId), eq(patientsTable.familyId, getAuth(req).familyId)))
    .limit(1);
  if (!patient) { res.status(404).json({ error: "Paciente não encontrado" }); return; }

  const query = ListQuery.safeParse(req.query);
  const conditions = [eq(doseRecordsTable.patientId, patientId)];
  if (query.success && query.data.from) conditions.push(gte(doseRecordsTable.takenAt, new Date(query.data.from)));
  if (query.success && query.data.to) conditions.push(lte(doseRecordsTable.takenAt, new Date(query.data.to)));

  const records = await db
    .select({
      id: doseRecordsTable.id,
      scheduledDoseId: doseRecordsTable.scheduledDoseId,
      patientId: doseRecordsTable.patientId,
      caregiverId: doseRecordsTable.caregiverId,
      caregiverName: caregiversTable.name,
      takenAt: doseRecordsTable.takenAt,
      outcome: doseRecordsTable.outcome,
      postponedTo: doseRecordsTable.postponedTo,
      notes: doseRecordsTable.notes,
      createdAt: doseRecordsTable.createdAt,
    })
    .from(doseRecordsTable)
    .leftJoin(caregiversTable, eq(doseRecordsTable.caregiverId, caregiversTable.id))
    .where(and(...conditions))
    .orderBy(doseRecordsTable.takenAt);

  res.json(records);
});

// ── Registrar dose ────────────────────────────────────────────────────────

router.post("/patients/:patientId/dose-records", requireAuth, requireCapability("register_dose"), async (req, res): Promise<void> => {
  const patientId = Number(req.params.patientId);
  if (isNaN(patientId)) { res.status(400).json({ error: "ID inválido" }); return; }

  const body = CreateDoseRecordBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }

  // Verifica isolamento
  const [patient] = await db
    .select({ id: patientsTable.id, timezone: patientsTable.timezone })
    .from(patientsTable)
    .where(and(eq(patientsTable.id, patientId), eq(patientsTable.familyId, getAuth(req).familyId)))
    .limit(1);
  if (!patient) { res.status(404).json({ error: "Paciente não encontrado" }); return; }

  // Verifica que a dose agendada pertence ao paciente, e pega o medicationId
  // (via treatment) pro evento DoseTaken.
  const [scheduled] = await db
    .select({ id: scheduledDosesTable.id, patientId: scheduledDosesTable.patientId, medicationId: treatmentsTable.medicationId })
    .from(scheduledDosesTable)
    .innerJoin(treatmentsTable, eq(scheduledDosesTable.treatmentId, treatmentsTable.id))
    .where(eq(scheduledDosesTable.id, body.data.scheduledDoseId))
    .limit(1);

  if (!scheduled || scheduled.patientId !== patientId) {
    res.status(404).json({ error: "Dose agendada não encontrada" });
    return;
  }

  // O PRIMEIRO REGISTRO VENCE — garantido pela constraint UNIQUE do banco,
  // não por uma checagem "SELECT antes de INSERT" (que teria uma janela de
  // corrida). onConflictDoNothing() faz o segundo INSERT simultâneo virar
  // um no-op silencioso em vez de um erro.
  const [inserted] = await db
    .insert(doseRecordsTable)
    .values({
      scheduledDoseId: body.data.scheduledDoseId,
      patientId,
      caregiverId: getAuth(req).caregiverId,
      takenAt: new Date(body.data.takenAt),
      outcome: body.data.outcome,
      postponedTo: body.data.postponedTo ? new Date(body.data.postponedTo) : null,
      notes: body.data.notes ?? null,
    })
    .onConflictDoNothing()
    .returning();

  if (inserted) {
    await db
      .update(scheduledDosesTable)
      .set({ status: inserted.outcome, updatedAt: Clock.now() })
      .where(eq(scheduledDosesTable.id, body.data.scheduledDoseId));

    safeLog.info({
      action: "created", entityType: "dose_record",
      familyId: getAuth(req).familyId,
      scheduledDoseId: inserted.scheduledDoseId,
      outcome: inserted.outcome,
    }, "Dose registrada");

    await audit({
      familyId: getAuth(req).familyId,
      entityType: "dose_record",
      entityId: String(inserted.id),
      action: "created",
      actorId: String(getAuth(req).caregiverId),
      actorType: "caregiver",
      ipAddress: req.ip,
    });

    if (inserted.outcome === "taken") {
      // Decrementar estoque é reação a este evento, não parte deste
      // fluxo — dose-records.ts não conhece stock.ts, só publica.
      await ensureQueueStarted();
      await boss.send(QUEUE_DOSE_TAKEN, { patientId, medicationId: scheduled.medicationId });
    }

    res.status(201).json({ ...inserted, wonRace: true });
    return;
  }

  // Perdeu a corrida — devolve o registro vencedor com 200, nunca um erro.
  const [winner] = await db
    .select({
      id: doseRecordsTable.id, scheduledDoseId: doseRecordsTable.scheduledDoseId, patientId: doseRecordsTable.patientId,
      caregiverId: doseRecordsTable.caregiverId, caregiverName: caregiversTable.name,
      takenAt: doseRecordsTable.takenAt, outcome: doseRecordsTable.outcome, postponedTo: doseRecordsTable.postponedTo,
      notes: doseRecordsTable.notes, createdAt: doseRecordsTable.createdAt,
    })
    .from(doseRecordsTable)
    .leftJoin(caregiversTable, eq(doseRecordsTable.caregiverId, caregiversTable.id))
    .where(eq(doseRecordsTable.scheduledDoseId, body.data.scheduledDoseId))
    .limit(1);

  res.status(200).json({
    ...winner,
    wonRace: false,
    message: winner ? `${winner.caregiverName ?? "Outro cuidador"} já registrou às ${formatTimeShort(winner.takenAt, patient.timezone)}` : "Essa dose já foi registrada",
  });
});

// ── Desfazer (até 60s depois de registrar) ─────────────────────────────────

router.post("/patients/:patientId/dose-records/:recordId/undo", requireAuth, requireCapability("register_dose"), async (req, res): Promise<void> => {
  const patientId = Number(req.params.patientId);
  const recordId = Number(req.params.recordId);
  if (isNaN(patientId) || isNaN(recordId)) { res.status(400).json({ error: "ID inválido" }); return; }

  const [patient] = await db
    .select({ id: patientsTable.id })
    .from(patientsTable)
    .where(and(eq(patientsTable.id, patientId), eq(patientsTable.familyId, getAuth(req).familyId)))
    .limit(1);
  if (!patient) { res.status(404).json({ error: "Paciente não encontrado" }); return; }

  const [record] = await db
    .select()
    .from(doseRecordsTable)
    .where(and(eq(doseRecordsTable.id, recordId), eq(doseRecordsTable.patientId, patientId)))
    .limit(1);
  if (!record) { res.status(404).json({ error: "Registro não encontrado" }); return; }

  const ageMs = Clock.now().getTime() - record.createdAt.getTime();
  if (ageMs > UNDO_WINDOW_MS) {
    res.status(409).json({ error: "Prazo para desfazer expirou (60 segundos)" });
    return;
  }

  await db.delete(doseRecordsTable).where(eq(doseRecordsTable.id, recordId));
  await db
    .update(scheduledDosesTable)
    .set({ status: "pending", updatedAt: Clock.now() })
    .where(eq(scheduledDosesTable.id, record.scheduledDoseId));

  await audit({
    familyId: getAuth(req).familyId,
    entityType: "dose_record",
    entityId: String(recordId),
    action: "deleted",
    actorId: String(getAuth(req).caregiverId),
    actorType: "caregiver",
    ipAddress: req.ip,
    diff: JSON.stringify({ undone: { outcome: record.outcome } }),
  });

  res.json({ scheduledDoseId: record.scheduledDoseId, status: "pending" });
});

export default router;
