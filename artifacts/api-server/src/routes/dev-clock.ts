/**
 * Rotas de controle do relógio para desenvolvimento e testes — ZELO
 *
 * PROTEÇÃO DE PRODUÇÃO:
 * Este módulo é registrado no router APENAS quando NODE_ENV !== "production".
 * Em produção, as rotas nunca existem — o Express retorna 404 automaticamente,
 * como se o endpoint não existisse. Não há código de "retornar 404 manualmente":
 * a proteção é estrutural (o router não registra as rotas).
 *
 * NUNCA mova este arquivo para um lugar onde seja importado incondicionalmente.
 * NUNCA adicione lógica de "if production return 404" aqui — o isolamento
 * correto é não registrar as rotas, não mascarar com 404 no handler.
 */

import { Router, type IRouter } from "express";
import { Clock } from "../lib/clock";

const router: IRouter = Router();

/**
 * GET /api/dev/clock — estado atual do relógio
 */
router.get("/dev/clock", (_req, res): void => {
  res.json({
    now: Clock.now().toISOString(),
    offsetMs: Clock.currentOffsetMs(),
    isInTestMode: Clock.isInTestMode(),
  });
});

/**
 * POST /api/dev/clock/advance  { ms: number }
 * Avança o relógio por `ms` milissegundos.
 */
router.post("/dev/clock/advance", (req, res): void => {
  const ms = Number(req.body?.ms);
  if (!Number.isFinite(ms)) {
    res.status(400).json({ error: "ms deve ser um número finito" });
    return;
  }
  Clock.advance(ms);
  res.json({
    ok: true,
    advancedMs: ms,
    now: Clock.now().toISOString(),
    totalOffsetMs: Clock.currentOffsetMs(),
  });
});

/**
 * POST /api/dev/clock/freeze  { iso: string }
 * Congela o relógio em uma data ISO 8601.
 */
router.post("/dev/clock/freeze", (req, res): void => {
  const iso = req.body?.iso;
  if (!iso || typeof iso !== "string") {
    res.status(400).json({ error: "iso (string ISO 8601) é obrigatório" });
    return;
  }
  const date = new Date(iso);
  if (isNaN(date.getTime())) {
    res.status(400).json({ error: `Data inválida: "${iso}"` });
    return;
  }
  Clock.freezeAt(date);
  res.json({
    ok: true,
    frozenAt: date.toISOString(),
    now: Clock.now().toISOString(),
  });
});

/**
 * POST /api/dev/clock/reset
 * Restaura o relógio real.
 */
router.post("/dev/clock/reset", (_req, res): void => {
  Clock.reset();
  res.json({
    ok: true,
    now: Clock.now().toISOString(),
    isInTestMode: Clock.isInTestMode(),
  });
});

export default router;
