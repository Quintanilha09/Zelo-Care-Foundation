import { getAuth } from "../lib/auth-types.ts";
/**
 * Pacientes — ZELO.
 * familyId vem exclusivamente do token JWT (req.user.familyId).
 * Nunca aceita familyId vindo da URL, corpo ou query string.
 */
import { Router } from "express";
import { eq, and } from "drizzle-orm";
import { db } from "@workspace/db";
import { patientsTable, consentRecordsTable } from "@workspace/db";
import { z } from "zod";
import { requireAuth } from "../middleware/require-auth";
import { safeLog } from "../lib/safe-logger";
import { audit } from "../lib/audit";
import { Clock } from "../lib/clock";

const router = Router();

const CreatePatientBody = z.object({
  name: z.string().min(1).max(200),
  birthDate: z.string().optional().nullable(),
  timezone: z.string().default("America/Sao_Paulo"),
  notes: z.string().optional().nullable(),
});

const UpdatePatientBody = z.object({
  name: z.string().min(1).max(200).optional(),
  birthDate: z.string().optional().nullable(),
  timezone: z.string().optional(),
  notes: z.string().optional().nullable(),
});

// ── Listar pacientes ──────────────────────────────────────────────────────

router.get("/patients", requireAuth, async (req, res): Promise<void> => {
  const patients = await db
    .select()
    .from(patientsTable)
    .where(eq(patientsTable.familyId, getAuth(req).familyId))
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

  // LGPD: exige consentimento de dados de saúde antes de cadastrar paciente
  const [consent] = await db
    .select({ id: consentRecordsTable.id })
    .from(consentRecordsTable)
    .where(
      and(
        eq(consentRecordsTable.userId, getAuth(req).userId),
        eq(consentRecordsTable.consentType, "health_data_processing"),
        eq(consentRecordsTable.consentGiven, "true")
      )
    )
    .limit(1);

  if (!consent) {
    res.status(403).json({
      error: "Consentimento para tratamento de dados de saúde é necessário antes de cadastrar paciente",
      code: "MISSING_HEALTH_CONSENT",
    });
    return;
  }

  const [patient] = await db
    .insert(patientsTable)
    .values({ ...body.data, familyId: getAuth(req).familyId })
    .returning();

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

  const [updated] = await db
    .update(patientsTable)
    .set({ ...body.data, updatedAt: Clock.now() })
    .where(and(eq(patientsTable.id, patientId), eq(patientsTable.familyId, getAuth(req).familyId)))
    .returning();

  if (!updated) { res.status(404).json({ error: "Paciente não encontrado" }); return; }

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
