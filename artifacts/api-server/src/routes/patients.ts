import { getAuth } from "../lib/auth-types.ts";
/**
 * Pacientes — ZELO.
 * familyId vem exclusivamente do token JWT (req.user.familyId).
 * Nunca aceita familyId vindo da URL, corpo ou query string.
 */
import { Router } from "express";
import { eq, and } from "drizzle-orm";
import { db } from "@workspace/db";
import { patientsTable, consentRecordsTable, treatmentsTable } from "@workspace/db";
import { z } from "zod";
import { requireAuth } from "../middleware/require-auth";
import { safeLog } from "../lib/safe-logger";
import { audit } from "../lib/audit";
import { Clock } from "../lib/clock";
import { clearFuturePendingDoses, generateDosesForTreatment } from "../lib/dose-generation.ts";

const router = Router();

// O consentimento de dado de saúde é POR PACIENTE, não da conta — o titular
// pode ser diferente a cada paciente cadastrado (o próprio idoso, ou um filho
// consentindo como representante legal quando ele não decide mais sozinho).
const CreatePatientBody = z.object({
  name: z.string().min(1).max(200),
  birthDate: z.string().optional().nullable(),
  timezone: z.string().default("America/Sao_Paulo"),
  notes: z.string().optional().nullable(),
  // ZELO-37: pra quando algo parecer preocupante — o app encaminha, nunca avalia.
  emergencyContactName: z.string().optional().nullable(),
  emergencyContactPhone: z.string().optional().nullable(),
  healthConsent: z.object({
    givenBy: z.enum(["self", "legal_representative"]),
    version: z.string().min(1),
  }),
});

const UpdatePatientBody = z.object({
  name: z.string().min(1).max(200).optional(),
  birthDate: z.string().optional().nullable(),
  timezone: z.string().optional(),
  notes: z.string().optional().nullable(),
  emergencyContactName: z.string().optional().nullable(),
  emergencyContactPhone: z.string().optional().nullable(),
});

// ── Listar pacientes ──────────────────────────────────────────────────────
// Por padrão só mostra ativos; ?archived=true lista os arquivados.

router.get("/patients", requireAuth, async (req, res): Promise<void> => {
  const showArchived = req.query.archived === "true";
  const patients = await db
    .select()
    .from(patientsTable)
    .where(
      and(
        eq(patientsTable.familyId, getAuth(req).familyId),
        eq(patientsTable.archived, showArchived)
      )
    )
    .orderBy(patientsTable.name);
  res.json(patients);
});

// ── Criar paciente ─────────────────────────────────────────────────────────

router.post("/patients", requireAuth, async (req, res): Promise<void> => {
  const body = CreatePatientBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const { healthConsent, ...patientData } = body.data;

  const [patient] = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(patientsTable)
      .values({ ...patientData, familyId: getAuth(req).familyId })
      .returning();

    // Consentimento de dado de saúde específico deste paciente — sempre um
    // INSERT novo, nunca reaproveita consentimento de outro paciente ou da
    // conta. É isso que torna o consentimento auditável por titular.
    await tx.insert(consentRecordsTable).values({
      userId: getAuth(req).userId,
      patientId: created.id,
      givenBy: healthConsent.givenBy,
      consentType: "health_data_processing",
      consentGiven: "true",
      version: healthConsent.version,
      ipAddress: req.ip ?? "unknown",
      userAgent: req.get("user-agent") ?? undefined,
    });

    return [created];
  });

  safeLog.info({ action: "created", entityType: "patient", familyId: patient.familyId }, "Paciente criado");
  await audit({
    familyId: patient.familyId,
    entityType: "patient",
    entityId: String(patient.id),
    action: "created",
    actorId: String(getAuth(req).caregiverId),
    actorType: "caregiver",
    ipAddress: req.ip,
  });

  res.status(201).json(patient);
});

// ── Arquivar / reativar paciente ────────────────────────────────────────────
// Arquivar suspende doses futuras sem apagar nada. Exclusão de verdade é
// outro fluxo (LGPD, export-deletion) — este endpoint nunca faz DELETE.

const ArchivePatientBody = z.object({ archived: z.boolean() });

router.post("/patients/:patientId/archive", requireAuth, async (req, res): Promise<void> => {
  const patientId = Number(req.params.patientId);
  if (isNaN(patientId)) { res.status(400).json({ error: "ID inválido" }); return; }

  const body = ArchivePatientBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }

  const [updated] = await db
    .update(patientsTable)
    .set({ archived: body.data.archived, updatedAt: Clock.now() })
    .where(and(eq(patientsTable.id, patientId), eq(patientsTable.familyId, getAuth(req).familyId)))
    .returning();

  if (!updated) { res.status(404).json({ error: "Paciente não encontrado" }); return; }

  await audit({
    familyId: getAuth(req).familyId,
    entityType: "patient",
    entityId: String(patientId),
    action: "updated",
    actorId: String(getAuth(req).caregiverId),
    actorType: "caregiver",
    diff: JSON.stringify({ archived: body.data.archived }),
  });

  res.json(updated);
});

// ── Ler paciente ──────────────────────────────────────────────────────────

router.get("/patients/:patientId", requireAuth, async (req, res): Promise<void> => {
  const patientId = Number(req.params.patientId);
  if (isNaN(patientId)) { res.status(400).json({ error: "ID inválido" }); return; }

  const [patient] = await db
    .select()
    .from(patientsTable)
    .where(and(eq(patientsTable.id, patientId), eq(patientsTable.familyId, getAuth(req).familyId)))
    .limit(1);

  if (!patient) {
    res.status(404).json({ error: "Paciente não encontrado" });
    return;
  }

  // Audit de acesso (fire-and-forget)
  void audit({
    familyId: getAuth(req).familyId,
    entityType: "patient",
    entityId: String(patientId),
    action: "accessed",
    actorId: String(getAuth(req).caregiverId),
    actorType: "caregiver",
    ipAddress: req.ip,
  });

  res.json(patient);
});

// ── Atualizar paciente ────────────────────────────────────────────────────

router.patch("/patients/:patientId", requireAuth, async (req, res): Promise<void> => {
  const patientId = Number(req.params.patientId);
  if (isNaN(patientId)) { res.status(400).json({ error: "ID inválido" }); return; }

  const body = UpdatePatientBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }

  const [before] = await db
    .select({ timezone: patientsTable.timezone })
    .from(patientsTable)
    .where(and(eq(patientsTable.id, patientId), eq(patientsTable.familyId, getAuth(req).familyId)))
    .limit(1);
  if (!before) { res.status(404).json({ error: "Paciente não encontrado" }); return; }

  const [updated] = await db
    .update(patientsTable)
    .set({ ...body.data, updatedAt: Clock.now() })
    .where(and(eq(patientsTable.id, patientId), eq(patientsTable.familyId, getAuth(req).familyId)))
    .returning();

  if (!updated) { res.status(404).json({ error: "Paciente não encontrado" }); return; }

  // ZELO-19: o fuso mudou — "8:00" continua sendo "8:00", só que agora no
  // relógio de parede do fuso novo. Regenera as doses futuras AINDA
  // PENDENTES (nunca as já registradas) de todo tratamento ativo do
  // paciente, para que reflitam o novo fuso em vez do antigo, já expirado.
  if (body.data.timezone && body.data.timezone !== before.timezone) {
    const activeTreatments = await db
      .select({ id: treatmentsTable.id })
      .from(treatmentsTable)
      .where(and(eq(treatmentsTable.patientId, patientId), eq(treatmentsTable.status, "active")));

    for (const t of activeTreatments) {
      await clearFuturePendingDoses(t.id);
      await generateDosesForTreatment(t.id);
    }

    safeLog.info(
      { action: "timezone_changed", entityType: "patient", familyId: updated.familyId, treatmentsRegenerated: activeTreatments.length },
      "Fuso do paciente alterado — doses futuras regeneradas"
    );
  }

  safeLog.info({ action: "updated", entityType: "patient", familyId: updated.familyId }, "Paciente atualizado");
  await audit({
    familyId: getAuth(req).familyId,
    entityType: "patient",
    entityId: String(patientId),
    action: "updated",
    actorId: String(getAuth(req).caregiverId),
    actorType: "caregiver",
  });

  res.json(updated);
});

export default router;
