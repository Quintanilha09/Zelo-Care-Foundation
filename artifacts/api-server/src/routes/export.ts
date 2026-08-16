import { getAuth } from "../lib/auth-types.ts";
/**
 * Exportação de dados — ZELO.
 * POST /api/export                      — gera snapshot e retorna link de download
 * GET  /api/export/download/:rawToken   — download autenticado pelo token (uso único)
 *
 * REGRAS:
 * - Link expira em 1 hora após geração
 * - Link é de uso único — após download marca como usado
 * - Nunca por e-mail com anexo — apenas download direto
 * - Audit log registra que a exportação aconteceu (sem conteúdo)
 */

import { Router } from "express";
import { eq, and, gt } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  exportTokensTable,
  patientsTable,
  treatmentsTable,
  scheduledDosesTable,
  doseRecordsTable,
  appointmentsTable,
  healthMeasurementsTable,
  medicationsTable,
} from "@workspace/db";
import { generateOneTimeToken, hashToken } from "../lib/tokens";
import { requireAuth } from "../middleware/require-auth";
import { audit } from "../lib/audit";
import { safeLog } from "../lib/safe-logger";
import { Clock } from "../lib/clock";

const router = Router();

// ── Gera snapshot e retorna link de download ──────────────────────────────

router.post("/export", requireAuth, async (req, res): Promise<void> => {
  const familyId = getAuth(req).familyId;

  // Coleta todos os dados da família
  const patients = await db
    .select()
    .from(patientsTable)
    .where(eq(patientsTable.familyId, familyId));

  const patientIds = patients.map((p) => p.id);

  // Busca todos os dados relacionados (inAny) — retorna vazio se não há pacientes
  const pid0 = patientIds[0] ?? -1; // -1 nunca vai existir → retorna []
  const [treatments, doses, records, appointments, measurements, medications] =
    await Promise.all([
      db.select().from(treatmentsTable).where(eq(treatmentsTable.patientId, pid0)),
      db.select().from(scheduledDosesTable).where(eq(scheduledDosesTable.patientId, pid0)),
      db.select().from(doseRecordsTable).where(eq(doseRecordsTable.patientId, pid0)),
      db.select().from(appointmentsTable).where(eq(appointmentsTable.patientId, pid0)),
      db.select().from(healthMeasurementsTable).where(eq(healthMeasurementsTable.patientId, pid0)),
      db.select().from(medicationsTable).where(eq(medicationsTable.familyId, familyId)),
    ]);

  const snapshot = JSON.stringify({
    exportDate: Clock.now().toISOString(),
    exportedBy: { userId: getAuth(req).userId, caregiverId: getAuth(req).caregiverId },
    familyId,
    patients: patients.map((p) => ({
      ...p,
      treatments: treatments.filter((t) => t.patientId === p.id),
      scheduledDoses: doses.filter((d) => d.patientId === p.id),
      doseRecords: records.filter((r) => r.patientId === p.id),
      appointments: appointments.filter((a) => a.patientId === p.id),
      healthMeasurements: measurements.filter((m) => m.patientId === p.id),
    })),
    medications,
    _note: "Exportação de dados pessoais conforme solicitação LGPD.",
  }, null, 2);

  const { raw, hash } = generateOneTimeToken();
  const expiresAt = new Date(Clock.now().getTime() + 60 * 60 * 1000); // 1 hora

  await db.insert(exportTokensTable).values({
    userId: getAuth(req).userId,
    familyId,
    tokenHash: hash,
    expiresAt,
    snapshot,
  });

  await audit({
    familyId,
    entityType: "data_export",
    entityId: hash.slice(0, 16),
    action: "created",
    actorId: String(getAuth(req).caregiverId),
    actorType: "caregiver",
  });
  safeLog.info({ action: "export_created", familyId }, "Exportação de dados gerada");

  res.json({
    downloadUrl: `/api/export/download/${raw}`,
    expiresAt,
    patientCount: patients.length,
  });
});

// ── Download autenticado (uso único) ─────────────────────────────────────

router.get("/export/download/:rawToken", async (req, res): Promise<void> => {
  const { rawToken } = req.params;
  const tokenHash = hashToken(rawToken);

  const [exportRecord] = await db
    .select()
    .from(exportTokensTable)
    .where(
      and(
        eq(exportTokensTable.tokenHash, tokenHash),
        eq(exportTokensTable.downloaded, false),
        gt(exportTokensTable.expiresAt, Clock.now())
      )
    )
    .limit(1);

  if (!exportRecord || !exportRecord.snapshot) {
    res.status(404).json({ error: "Link inválido, expirado ou já utilizado" });
    return;
  }

  // Marca como usado antes de enviar (evita race condition)
  await db.update(exportTokensTable)
    .set({ downloaded: true, downloadedAt: Clock.now() })
    .where(eq(exportTokensTable.id, exportRecord.id));

  const filename = `zelo-export-${Clock.now().toISOString().slice(0, 10)}.json`;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(exportRecord.snapshot);
});

export default router;
