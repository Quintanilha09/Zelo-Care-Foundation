import { getAuth } from "../lib/auth-types.ts";
/**
 * Sincronização em tempo real — ZELO (ZELO-25).
 *
 * GET /patients/:patientId/events — SSE, uma conexão por aba/dispositivo
 * assistindo aquele paciente. Autenticado como qualquer rota (Bearer
 * token) — nada de token na query string, isso vazaria em log de acesso.
 * O cliente usa fetch() + leitura manual do stream (não o EventSource
 * nativo) exatamente porque EventSource não permite header customizado.
 */
import { Router } from "express";
import { eq } from "drizzle-orm";
import { db } from "@workspace/db";
import { caregiversTable } from "@workspace/db";
import { requireAuth } from "../middleware/require-auth";
import { verifyPatientBelongsToFamily } from "../lib/family-access.ts";
import { subscribeToPatientEvents, registerConnection, unregisterConnection } from "../lib/realtime.ts";

const router = Router();

const HEARTBEAT_MS = 20_000;
// Revalidação de autorização: além da revogação imediata (ver
// revokeCaregiverAccess em routes/caregivers.ts), esta é a rede de
// segurança pra qualquer outro caminho de perda de acesso.
const REAUTH_CHECK_MS = 5_000;

router.get("/patients/:patientId/events", requireAuth, async (req, res): Promise<void> => {
  const patientId = Number(req.params.patientId);
  if (isNaN(patientId)) { res.status(400).json({ error: "ID inválido" }); return; }

  const belongs = await verifyPatientBelongsToFamily(patientId, getAuth(req).familyId);
  if (!belongs) { res.status(404).json({ error: "Paciente não encontrado" }); return; }

  const { userId, caregiverId } = getAuth(req);

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no", // desliga buffering de proxy (nginx) — evento tem que sair na hora
  });
  res.write(": conectado\n\n");

  registerConnection(userId, res);

  const unsubscribe = subscribeToPatientEvents(patientId, (event) => {
    res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
  });

  const heartbeat = setInterval(() => {
    res.write(": heartbeat\n\n");
  }, HEARTBEAT_MS);

  const reauthCheck = setInterval(async () => {
    const [caregiver] = await db.select({ id: caregiversTable.id }).from(caregiversTable).where(eq(caregiversTable.id, caregiverId)).limit(1);
    if (!caregiver) {
      cleanup();
      res.end();
    }
  }, REAUTH_CHECK_MS);

  function cleanup() {
    clearInterval(heartbeat);
    clearInterval(reauthCheck);
    unsubscribe();
    unregisterConnection(userId, res);
  }

  req.on("close", cleanup);
});

export default router;
