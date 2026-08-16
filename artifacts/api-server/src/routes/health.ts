import { Router, type IRouter } from "express";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";

const router: IRouter = Router();

// Verificação de saúde com confirmação de conectividade ao banco.
// Responde:
//   200 { status: "ok",    db: "ok",    uptimeSeconds: N }  — tudo saudável
//   503 { status: "error", db: "error", error: "..." }      — banco inacessível
//
// Usado por load balancer e monitoramento externo.
// Não requer autenticação — é um endpoint público.
router.get("/healthz", async (_req, res): Promise<void> => {
  const startedAt = process.hrtime.bigint();

  try {
    // Consulta mínima: 1 round-trip ao banco sem tocar em dados de usuário
    await db.execute(sql`SELECT 1`);

    const uptimeMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;

    res.status(200).json({
      status: "ok",
      db: "ok",
      uptimeSeconds: Math.floor(process.uptime()),
      dbLatencyMs: Math.round(uptimeMs),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(503).json({
      status: "error",
      db: "error",
      error: message,
    });
  }
});

export default router;
