import { getAuth } from "../lib/auth-types.ts";
/**
 * Relatório de adesão em PDF — ZELO (ZELO-35).
 *
 * POST /api/patients/:id/adherence-report  — gera o PDF, devolve o link
 * GET  /api/reports/:rawToken              — download público pelo link (sem auth)
 *
 * Exclusivo do plano pago — paywall DURO aqui (403), diferente do "convite
 * calmo" da ZELO-33 (calendário de adesão): a spec desta história diz
 * "exclusivo do plano pago" sem a ressalva de nunca bloquear, então o
 * comportamento é deliberadamente diferente entre as duas.
 *
 * O link não é de uso único (diferente do /export/download da LGPD) — o
 * médico pode abrir mais de uma vez dentro dos 7 dias. Expirado, para de
 * servir (410), nunca 404 (o link existiu e existe registro do que foi
 * gerado, só não serve mais).
 */
import { Router } from "express";
import { eq, and, gt } from "drizzle-orm";
import { z } from "zod";
import { db } from "@workspace/db";
import { patientsTable, adherenceReportsTable } from "@workspace/db";
import { requireAuth } from "../middleware/require-auth";
import { hasPaidAccess } from "../lib/subscription.ts";
import { computeReportData, generateReportPdf } from "../lib/adherence-report.ts";
import { generateOneTimeToken, hashToken } from "../lib/tokens.ts";
import { audit } from "../lib/audit";
import { safeLog } from "../lib/safe-logger";
import { Clock } from "../lib/clock.ts";

const router = Router();

const DateISO = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "data deve ser YYYY-MM-DD");
const MAX_RANGE_DAYS = 366;
const LINK_EXPIRY_DAYS = 7;

async function loadPatient(patientId: number, familyId: number) {
  const [patient] = await db
    .select({ id: patientsTable.id, name: patientsTable.name, familyId: patientsTable.familyId })
    .from(patientsTable)
    .where(and(eq(patientsTable.id, patientId), eq(patientsTable.familyId, familyId)))
    .limit(1);
  return patient ?? null;
}

router.post("/patients/:patientId/adherence-report", requireAuth, async (req, res): Promise<void> => {
  const patientId = Number(req.params.patientId);
  if (isNaN(patientId)) { res.status(400).json({ error: "ID inválido" }); return; }

  const auth = getAuth(req);
  const patient = await loadPatient(patientId, auth.familyId);
  if (!patient) { res.status(404).json({ error: "Paciente não encontrado" }); return; }

  const body = z.object({ from: DateISO, to: DateISO }).safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }
  const { from, to } = body.data;
  if (from > to) { res.status(400).json({ error: "'from' precisa ser antes de 'to'" }); return; }
  const rangeDays = Math.round((new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / 86_400_000);
  if (rangeDays > MAX_RANGE_DAYS) { res.status(400).json({ error: `intervalo máximo de ${MAX_RANGE_DAYS} dias` }); return; }

  if (!(await hasPaidAccess(auth.familyId))) {
    res.status(403).json({ error: "Relatório em PDF é exclusivo do plano pago" });
    return;
  }

  const data = await computeReportData(patientId, from, to);
  const pdfBuffer = await generateReportPdf(data);

  const { raw, hash } = generateOneTimeToken();
  const expiresAt = new Date(Clock.now().getTime() + LINK_EXPIRY_DAYS * 86_400_000);

  const [report] = await db.insert(adherenceReportsTable).values({
    patientId,
    familyId: auth.familyId,
    generatedByCaregiverId: auth.caregiverId,
    periodStart: from,
    periodEnd: to,
    pdfData: pdfBuffer.toString("base64"),
    tokenHash: hash,
    expiresAt,
  }).returning();

  await audit({
    familyId: auth.familyId,
    entityType: "adherence_report",
    entityId: String(report.id),
    action: "created",
    actorId: String(auth.caregiverId),
    actorType: "caregiver",
  });
  safeLog.info({ action: "adherence_report_created", familyId: auth.familyId, patientId }, "Relatório de adesão gerado");

  res.json({ reportId: report.id, downloadUrl: `/api/reports/${raw}`, expiresAt });
});

router.get("/reports/:rawToken", async (req, res): Promise<void> => {
  const { rawToken } = req.params;
  const tokenHash = hashToken(rawToken);

  const [report] = await db
    .select()
    .from(adherenceReportsTable)
    .where(and(eq(adherenceReportsTable.tokenHash, tokenHash), gt(adherenceReportsTable.expiresAt, Clock.now())))
    .limit(1);

  if (!report) {
    res.status(410).json({ error: "Link expirado ou inválido" });
    return;
  }

  if (!report.accessedAt) {
    await db.update(adherenceReportsTable).set({ accessedAt: Clock.now() }).where(eq(adherenceReportsTable.id, report.id));
  }

  await audit({
    familyId: report.familyId,
    entityType: "adherence_report",
    entityId: String(report.id),
    action: "accessed",
    actorType: "system",
  });

  const filename = `zelo-relatorio-adesao-${report.periodStart}-a-${report.periodEnd}.pdf`;
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="${filename}"`);
  res.send(Buffer.from(report.pdfData, "base64"));
});

export default router;
