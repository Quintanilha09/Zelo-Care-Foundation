import { getAuth } from "../lib/auth-types.ts";
/**
 * Estoque — ZELO (ZELO-34).
 * A criação inicial (junto do cadastro do tratamento) vive em treatments.ts
 * — aqui só listagem e ajuste manual/reposição de um estoque já existente.
 */
import { Router } from "express";
import { eq, and } from "drizzle-orm";
import { z } from "zod";
import { db } from "@workspace/db";
import { stockEntriesTable, patientsTable, medicationsTable } from "@workspace/db";
import { requireAuth } from "../middleware/require-auth";
import { requireCapability } from "../lib/capabilities.ts";
import { audit } from "../lib/audit";
import { Clock } from "../lib/clock.ts";
import { computeDaysRemaining, loadActiveTreatmentSchedule } from "../lib/stock.ts";
import { publishPatientEvent } from "../lib/realtime.ts";

const router = Router();

async function loadPatientInFamily(patientId: number, familyId: number) {
  const [patient] = await db
    .select({ id: patientsTable.id, timezone: patientsTable.timezone })
    .from(patientsTable)
    .where(and(eq(patientsTable.id, patientId), eq(patientsTable.familyId, familyId)))
    .limit(1);
  return patient ?? null;
}

// ── Listar estoque, com dias restantes já calculados ────────────────────────

router.get("/patients/:patientId/stock", requireAuth, async (req, res): Promise<void> => {
  const patientId = Number(req.params.patientId);
  if (isNaN(patientId)) { res.status(400).json({ error: "ID inválido" }); return; }

  const patient = await loadPatientInFamily(patientId, getAuth(req).familyId);
  if (!patient) { res.status(404).json({ error: "Paciente não encontrado" }); return; }

  const entries = await db
    .select({
      id: stockEntriesTable.id,
      medicationId: stockEntriesTable.medicationId,
      medicationName: medicationsTable.name,
      quantityRemaining: stockEntriesTable.quantityRemaining,
      unit: stockEntriesTable.unit,
      prescriptionExpiresAt: stockEntriesTable.prescriptionExpiresAt,
    })
    .from(stockEntriesTable)
    .innerJoin(medicationsTable, eq(stockEntriesTable.medicationId, medicationsTable.id))
    .where(eq(stockEntriesTable.patientId, patientId));

  const withDaysRemaining = await Promise.all(
    entries.map(async (entry) => {
      const activeTreatment = await loadActiveTreatmentSchedule(patientId, entry.medicationId);
      const days = computeDaysRemaining(entry, activeTreatment, patient.timezone);
      // Issue #65: a tela precisa saber separar o que está em uso do que
      // sobrou. Sem isto ela mostrava as duas coisas iguais, e o estoque de
      // um tratamento cancelado parecia estoque corrente acabando.
      return { ...entry, ...days, temTratamentoAtivo: activeTreatment !== null };
    })
  );

  res.json(withDaysRemaining);
});

// ── Ajuste manual / registrar reposição ─────────────────────────────────────
// Mesma rota pras duas ações da história: "ajuste manual" (setQuantity — o
// cuidador recontou e corrige pro valor certo) e "registrar reposição"
// (addQuantity — comprou mais N unidades). As duas só mudam quantityRemaining
// e aceitam motivo opcional, não precisam de dois endpoints.

const AdjustStockBody = z
  .object({
    setQuantity: z.number().min(0).optional(),
    addQuantity: z.number().optional(),
    reason: z.string().trim().max(500).optional(),
  })
  .refine((b) => (b.setQuantity !== undefined) !== (b.addQuantity !== undefined), {
    message: "Envie setQuantity OU addQuantity, nunca os dois nem nenhum",
  });

router.patch("/patients/:patientId/stock/:medicationId", requireAuth, requireCapability("edit_treatment"), async (req, res): Promise<void> => {
  const patientId = Number(req.params.patientId);
  const medicationId = Number(req.params.medicationId);
  if (isNaN(patientId) || isNaN(medicationId)) { res.status(400).json({ error: "ID inválido" }); return; }

  const patient = await loadPatientInFamily(patientId, getAuth(req).familyId);
  if (!patient) { res.status(404).json({ error: "Paciente não encontrado" }); return; }

  const body = AdjustStockBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }

  const [stock] = await db
    .select()
    .from(stockEntriesTable)
    .where(and(eq(stockEntriesTable.patientId, patientId), eq(stockEntriesTable.medicationId, medicationId)))
    .limit(1);
  if (!stock) { res.status(404).json({ error: "Nenhum estoque cadastrado para este medicamento" }); return; }

  const activeTreatment = await loadActiveTreatmentSchedule(patientId, medicationId);
  const before = computeDaysRemaining(stock, activeTreatment, patient.timezone);

  const newQuantity = body.data.setQuantity !== undefined
    ? body.data.setQuantity
    : Math.max(0, stock.quantityRemaining + body.data.addQuantity!);

  const [updated] = await db
    .update(stockEntriesTable)
    .set({ quantityRemaining: newQuantity, updatedAt: Clock.now() })
    .where(eq(stockEntriesTable.id, stock.id))
    .returning();

  await audit({
    familyId: getAuth(req).familyId,
    entityType: "stock_entry",
    entityId: String(stock.id),
    action: "updated",
    actorId: String(getAuth(req).caregiverId),
    actorType: "caregiver",
    ipAddress: req.ip,
    diff: JSON.stringify({ from: stock.quantityRemaining, to: newQuantity, reason: body.data.reason ?? null }),
  });

  // Mesmo critério do decremento automático: só notifica em tempo real
  // quando CRUZA pra baixo do limite agora — um ajuste que já começa baixo
  // (ou que sobe o estoque) não deveria gerar um alerta novo.
  const after = computeDaysRemaining({ ...stock, quantityRemaining: newQuantity }, activeTreatment, patient.timezone);
  if (after.isLow && !before.isLow) {
    const [medication] = await db.select({ name: medicationsTable.name }).from(medicationsTable).where(eq(medicationsTable.id, medicationId)).limit(1);
    publishPatientEvent(patientId, { type: "low_stock", medicationName: medication?.name ?? "Medicamento" });
  }

  res.json({ ...updated, ...after });
});

// ── Remover uma entrada de estoque — Issue #65 ─────────────────────────────

/**
 * Antes desta rota o estoque era um beco sem saída: dava para ajustar a
 * quantidade e nunca para tirar a linha da tela. Um tratamento cancelado
 * deixava o estoque para trás e não havia o que fazer com ele.
 *
 * Mesma capacidade do PATCH ao lado: quem pode ajustar quantidade pode
 * remover a entrada.
 *
 * NÃO encosta em histórico. Estoque é quanto tem na caixa hoje; `dose_records`
 * e `audit_log` são o que aconteceu, e continuam intactos.
 */
router.delete("/patients/:patientId/stock/:medicationId", requireAuth, requireCapability("edit_treatment"), async (req, res): Promise<void> => {
  const patientId = Number(req.params.patientId);
  const medicationId = Number(req.params.medicationId);
  if (isNaN(patientId) || isNaN(medicationId)) { res.status(400).json({ error: "ID inválido" }); return; }

  // 404 e nunca 403 para paciente de outra família — invariante 2. O
  // `familyId` vem do JWT, jamais da URL.
  const patient = await loadPatientInFamily(patientId, getAuth(req).familyId);
  if (!patient) { res.status(404).json({ error: "Paciente não encontrado" }); return; }

  const [removida] = await db
    .delete(stockEntriesTable)
    .where(and(eq(stockEntriesTable.patientId, patientId), eq(stockEntriesTable.medicationId, medicationId)))
    .returning({ id: stockEntriesTable.id });

  if (!removida) { res.status(404).json({ error: "Nenhum estoque cadastrado para este medicamento" }); return; }

  await audit({
    familyId: getAuth(req).familyId,
    entityType: "stock",
    entityId: String(removida.id),
    action: "deleted",
    actorId: String(getAuth(req).caregiverId),
    actorType: "caregiver",
  });

  // Sem evento em tempo real: o único tipo que existe é `low_stock`, e
  // remover uma entrada não é um alerta de reposição. Inventar um tipo novo
  // aqui seria mudar contrato para nada — quem está com a tela aberta
  // recarrega a lista pela própria ação.
  res.status(204).end();
});

export default router;
