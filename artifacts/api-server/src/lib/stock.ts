/**
 * Estoque — reação ao evento DoseTaken (ZELO-23).
 *
 * Decoupled de propósito: dose-records.ts não conhece esta função, só
 * publica o evento DoseTaken na fila (lib/queue.ts). Quem decrementa é o
 * worker registrado em startQueue (index.ts), separado do módulo de
 * registro de dose.
 */
import { eq, and } from "drizzle-orm";
import { db } from "@workspace/db";
import { stockEntriesTable, medicationsTable } from "@workspace/db";
import { Clock } from "./clock.ts";
import { publishPatientEvent } from "./realtime.ts";

/**
 * Decrementa 1 unidade do estoque do medicamento do paciente, se houver
 * estoque cadastrado. Sem estoque cadastrado, não faz nada — rastrear
 * estoque é opcional, não todo tratamento tem.
 */
export async function decrementStockForDoseTaken(patientId: number, medicationId: number): Promise<void> {
  const [stock] = await db
    .select()
    .from(stockEntriesTable)
    .where(and(eq(stockEntriesTable.patientId, patientId), eq(stockEntriesTable.medicationId, medicationId)))
    .limit(1);

  if (!stock) return;

  const newQuantity = Math.max(0, stock.quantityRemaining - 1);
  await db
    .update(stockEntriesTable)
    .set({ quantityRemaining: newQuantity, updatedAt: Clock.now() })
    .where(eq(stockEntriesTable.id, stock.id));

  // ZELO-25: só avisa em tempo real quando CRUZA pra baixo do limite agora
  // — decrementar quando já estava baixo não deveria reemitir o aviso.
  if (stock.lowStockThreshold != null && newQuantity <= stock.lowStockThreshold && stock.quantityRemaining > stock.lowStockThreshold) {
    const [medication] = await db.select({ name: medicationsTable.name }).from(medicationsTable).where(eq(medicationsTable.id, medicationId)).limit(1);
    publishPatientEvent(patientId, { type: "low_stock", medicationName: medication?.name ?? "Medicamento" });
  }
}
