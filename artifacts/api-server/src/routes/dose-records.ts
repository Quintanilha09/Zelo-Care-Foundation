import { getAuth } from "../lib/auth-types.ts";
/**
 * Registros de dose — ZELO (ZELO-23, ZELO-24).
 *
 * O PRIMEIRO REGISTRO VENCE, garantido pelo banco, não por lógica de
 * aplicação: UNIQUE(scheduled_dose_id) + INSERT ... ON CONFLICT DO NOTHING.
 * Uma corrida perdida nunca vira erro feio — devolve 200 com o registro
 * vencedor e uma mensagem simpática ("Bruno já registrou às 8:02"), nunca
 * 409. É esse desenho que faz 20 requisições simultâneas produzirem
 * exatamente 1 registro sem nenhuma delas quebrar.
 *
 * ZELO-24 — registro retroativo: takenAt (quando aconteceu, segundo o
 * cuidador) e createdAt (quando foi registrado no sistema) já eram dois
 * campos separados desde sempre — o relatório médico usa takenAt, a
 * auditoria usa createdAt. Dentro da janela configurável da família
 * (padrão 24h) entre os dois, registra sem perguntar mais nada. Fora dela,
 * pede uma justificativa curta — texto livre, neutro, sem lista de motivos
 * pré-definidos que julgue o cuidador. Dose no futuro é sempre rejeitada.
 */
import { Router } from "express";
import { eq, and, gte, lte } from "drizzle-orm";
import { db } from "@workspace/db";
import { doseRecordsTable, scheduledDosesTable, treatmentsTable, medicationsTable, caregiversTable, patientsTable, familiesTable } from "@workspace/db";
import { z } from "zod";
import { requireAuth } from "../middleware/require-auth";
import { requireCapability } from "../lib/capabilities.ts";
import { safeLog } from "../lib/safe-logger";
import { audit } from "../lib/audit";
import { Clock } from "../lib/clock";
import { boss, QUEUE_DOSE_TAKEN, QUEUE_DOSE_REMINDER, ensureQueueStarted } from "../lib/queue.ts";
import { ESCALATION_LEVEL_SNOOZE } from "../lib/dose-reminders.ts";
import { publishPatientEvent } from "../lib/realtime.ts";
import { isPatientEditable, READ_ONLY_MESSAGE } from "../lib/plan-limits.ts";

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
  // ZELO-24: só exigida pelo servidor quando takenAt cai fora da janela
  // retroativa da família — texto curto e neutro, nunca uma escolha numa
  // lista de motivos.
  justification: z.string().trim().max(500).optional().nullable(),
  notes: z.string().optional().nullable(),
  // ZELO-40: enviado pela tela do modo idoso — muda só o rótulo exibido
  // ("Dona Maria" em vez do cuidador logado no aparelho), nunca quem é o
  // caregiverId responsável de verdade (isso continua vindo do token).
  viaElderMode: z.boolean().optional(),
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
      justification: doseRecordsTable.justification,
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

  // ZELO-38: downgrade nunca apaga dado — paciente excedente do plano
  // atual fica visível pra sempre, só não aceita registro novo.
  if (!(await isPatientEditable(patientId, getAuth(req).familyId))) {
    res.status(403).json({ error: READ_ONLY_MESSAGE, code: "PLAN_READ_ONLY" });
    return;
  }

  // Verifica que a dose agendada pertence ao paciente, e pega o medicationId
  // (via treatment) pro evento DoseTaken e o nome do medicamento pro evento
  // de sincronização em tempo real (ZELO-25).
  const [scheduled] = await db
    .select({
      id: scheduledDosesTable.id, patientId: scheduledDosesTable.patientId,
      scheduledLocalTime: scheduledDosesTable.scheduledLocalTime,
      medicationId: treatmentsTable.medicationId, medicationName: medicationsTable.name,
    })
    .from(scheduledDosesTable)
    .innerJoin(treatmentsTable, eq(scheduledDosesTable.treatmentId, treatmentsTable.id))
    .innerJoin(medicationsTable, eq(treatmentsTable.medicationId, medicationsTable.id))
    .where(eq(scheduledDosesTable.id, body.data.scheduledDoseId))
    .limit(1);

  if (!scheduled || scheduled.patientId !== patientId) {
    res.status(404).json({ error: "Dose agendada não encontrada" });
    return;
  }

  // ZELO-24: nunca registrar dose no futuro.
  const takenAt = new Date(body.data.takenAt);
  if (takenAt.getTime() > Clock.now().getTime()) {
    res.status(400).json({ error: "Não é possível registrar uma dose no futuro." });
    return;
  }

  // ZELO-24: fora da janela retroativa da família, exige justificativa —
  // dentro dela, só confirmar o horário real já basta.
  const [family] = await db
    .select({ retroactiveWindowHours: familiesTable.retroactiveWindowHours })
    .from(familiesTable)
    .where(eq(familiesTable.id, getAuth(req).familyId))
    .limit(1);
  const windowMs = (family?.retroactiveWindowHours ?? 24) * 3_600_000;
  const gapMs = Clock.now().getTime() - takenAt.getTime();
  if (gapMs > windowMs && !body.data.justification?.trim()) {
    res.status(400).json({
      error: `Esse registro é de mais de ${family?.retroactiveWindowHours ?? 24}h atrás — adicione uma breve justificativa pra confirmar.`,
      code: "JUSTIFICATION_REQUIRED",
    });
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
      takenAt,
      outcome: body.data.outcome,
      postponedTo: body.data.postponedTo ? new Date(body.data.postponedTo) : null,
      justification: body.data.justification?.trim() || null,
      notes: body.data.notes ?? null,
      registeredViaElderMode: body.data.viaElderMode ?? false,
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

    // ZELO-25: quem mais estiver com este paciente aberto vê a mudança em
    // tempo real, sem dar refresh — "o irmão registrou e você vê na hora".
    const [actingCaregiver] = await db.select({ name: caregiversTable.name }).from(caregiversTable).where(eq(caregiversTable.id, getAuth(req).caregiverId)).limit(1);
    publishPatientEvent(patientId, {
      type: "dose_registered",
      scheduledDoseId: inserted.scheduledDoseId,
      medicationName: scheduled.medicationName,
      scheduledLocalTime: scheduled.scheduledLocalTime,
      caregiverName: actingCaregiver?.name ?? "Um cuidador",
      status: inserted.outcome,
    });

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

// ── Adiar lembrete em 15min (ZELO-28) ───────────────────────────────────────
// Botão "Adiar 15 min" da notificação — nunca cria dose_record, só reagenda
// um segundo lembrete (nível 1) pra daqui a 15 minutos.
//
// ZELO-30: o nível 1 já tem um job agendado desde a criação da dose (T+15
// upfront, às vezes só disparando horas depois) — a policy "exclusive"
// (queue.ts) rejeita em silêncio (ON CONFLICT DO NOTHING) qualquer segundo
// job com a mesma singletonKey enquanto o primeiro não chegar a um estado
// terminal, então só mandar um job novo não bastaria: precisa apagar
// qualquer job pendente desse nível ANTES de recriar — inclusive um "Adiar"
// anterior, que assim vira "adiar de novo a partir de agora" em vez de
// travar. Idempotência de verdade continua vindo de outro lugar (UNIQUE em
// notifications, dose-reminders.ts): se o nível 1 já foi enviado de fato,
// recriar o job não reenvia nada.
router.post("/patients/:patientId/dose-records/:scheduledDoseId/snooze", requireAuth, requireCapability("register_dose"), async (req, res): Promise<void> => {
  const patientId = Number(req.params.patientId);
  const scheduledDoseId = Number(req.params.scheduledDoseId);
  if (isNaN(patientId) || isNaN(scheduledDoseId)) { res.status(400).json({ error: "ID inválido" }); return; }

  const [patient] = await db
    .select({ id: patientsTable.id })
    .from(patientsTable)
    .where(and(eq(patientsTable.id, patientId), eq(patientsTable.familyId, getAuth(req).familyId)))
    .limit(1);
  if (!patient) { res.status(404).json({ error: "Paciente não encontrado" }); return; }

  const [dose] = await db
    .select({ id: scheduledDosesTable.id, status: scheduledDosesTable.status })
    .from(scheduledDosesTable)
    .where(and(eq(scheduledDosesTable.id, scheduledDoseId), eq(scheduledDosesTable.patientId, patientId)))
    .limit(1);
  if (!dose) { res.status(404).json({ error: "Dose agendada não encontrada" }); return; }
  if (dose.status !== "pending") { res.status(409).json({ error: "Essa dose já foi registrada, não há o que adiar" }); return; }

  await ensureQueueStarted();
  const snoozedUntil = new Date(Clock.now().getTime() + 15 * 60_000);
  const singletonKey = `reminder:${scheduledDoseId}:${ESCALATION_LEVEL_SNOOZE}`;
  const existing = await boss.findJobs(QUEUE_DOSE_REMINDER, { key: singletonKey });
  if (existing.length > 0) {
    await boss.deleteJob(QUEUE_DOSE_REMINDER, existing.map((j) => j.id));
  }
  await boss.send(
    QUEUE_DOSE_REMINDER,
    { scheduledDoseId, level: ESCALATION_LEVEL_SNOOZE },
    { singletonKey, startAfter: snoozedUntil }
  );

  res.json({ scheduledDoseId, snoozedUntil: snoozedUntil.toISOString() });
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

  publishPatientEvent(patientId, { type: "dose_undone", scheduledDoseId: record.scheduledDoseId });

  res.json({ scheduledDoseId: record.scheduledDoseId, status: "pending" });
});

export default router;
