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
import { eq, and, gt, inArray } from "drizzle-orm";
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
import { publicTokenLimiter } from "../lib/rate-limit";
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

  // ── O defeito que ficou aqui até a QUI-17 ────────────────────────────────
  //
  // Isto era `eq(..., pid0)`, com `pid0 = patientIds[0]`. O comentário
  // original até dizia "inAny" — a intenção estava escrita, a implementação
  // não. Numa família com mais de um paciente, **só o primeiro saía com
  // dados**: os demais vinham com `treatments: []`, `doseRecords: []`, e por
  // aí. E como a exportação é o direito do titular de levar os próprios
  // dados embora, ela mentia calada.
  //
  // Não dava para ver pela tela porque não havia tela: a rota existia,
  // testada, e nada no app a chamava.
  //
  // O `-1` continua sendo necessário — `inArray` com lista vazia não gera
  // SQL válido, e uma família sem paciente é um caso real (conta nova).
  const alvos = patientIds.length > 0 ? patientIds : [-1];
  const [treatments, doses, records, appointments, measurements, medications] =
    await Promise.all([
      db.select().from(treatmentsTable).where(inArray(treatmentsTable.patientId, alvos)),
      db.select().from(scheduledDosesTable).where(inArray(scheduledDosesTable.patientId, alvos)),
      db.select().from(doseRecordsTable).where(inArray(doseRecordsTable.patientId, alvos)),
      db.select().from(appointmentsTable).where(inArray(appointmentsTable.patientId, alvos)),
      db.select().from(healthMeasurementsTable).where(inArray(healthMeasurementsTable.patientId, alvos)),
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

router.get<{ rawToken: string }>("/export/download/:rawToken", publicTokenLimiter, async (req, res): Promise<void> => {
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
