/**
 * Painel operacional — ZELO (ZELO-32).
 *
 * Autenticação própria (requireAdminAuth, lib/admin-auth.ts) — nunca
 * requireAuth. Toda consulta aqui é AGREGADA e SEM RECORTE DE FAMÍLIA: a
 * pergunta é sobre o serviço inteiro ("estamos entregando >99%?"), não
 * sobre uma família específica. Nenhuma rota deste arquivo pode selecionar
 * `notifications.title`/`body` (contêm nome de paciente/medicamento nos
 * templates, ver dose-reminders.ts) nem fazer join com nome de paciente,
 * cuidador ou medicamento — só contagem, taxa, timestamp e enum. Critério
 * de aceite explícito: "nenhum campo do painel expõe dado pessoal".
 */
import { Router } from "express";
import { sql, eq, and, gte, isNull, desc } from "drizzle-orm";
import { db } from "@workspace/db";
import { notificationsTable, scheduledDosesTable, pushSubscriptionsTable, operationalAlertsTable } from "@workspace/db";
import { requireAdminAuth, verifyAdminPassword, generateAdminToken, motivoDoPainelIndisponivel } from "../lib/admin-auth.ts";
import { Clock } from "../lib/clock.ts";
import { adminLoginLimiter } from "../lib/rate-limit";

const router = Router();

router.post("/admin/login", adminLoginLimiter, (req, res): void => {
  // Painel indisponivel != senha errada, e a tela precisa saber a diferenca.
  //
  // Antes as duas coisas devolviam "Senha incorreta", e um operador com a
  // senha CERTA ficava preso numa mensagem falsa — sem jeito de descobrir que
  // o painel tinha se desabilitado sozinho por colisao de segredos.
  //
  // Dizer "o painel esta indisponivel" nao ajuda atacante nenhum: ele descobre
  // que NAO ha acesso, nao como obte-lo.
  const indisponivel = motivoDoPainelIndisponivel();
  if (indisponivel) {
    res.status(503).json({ error: indisponivel, code: "ADMIN_PANEL_UNAVAILABLE" });
    return;
  }

  const password = typeof req.body?.password === "string" ? req.body.password : "";
  if (!verifyAdminPassword(password)) {
    res.status(401).json({ error: "Senha incorreta" });
    return;
  }
  res.json({ token: generateAdminToken() });
});

// ── Status público, sem autenticação — pra equipe consultar rapidamente ────

router.get("/status", async (_req, res): Promise<void> => {
  const active = await db
    .select({ type: operationalAlertsTable.type })
    .from(operationalAlertsTable)
    .where(isNull(operationalAlertsTable.resolvedAt));

  res.json({
    status: active.length > 0 ? "degraded" : "operational",
    checkedAt: Clock.now().toISOString(),
  });
});

// ── Métricas agregadas — painel restrito ────────────────────────────────────

router.get("/admin/metrics", requireAdminAuth, async (req, res): Promise<void> => {
  const days = Math.min(90, Math.max(1, parseInt(String(req.query.days ?? "30"), 10) || 30));
  const since = new Date(Clock.now().getTime() - days * 86_400_000);
  const since24h = new Date(Clock.now().getTime() - 24 * 60 * 60_000);
  const periodFilter = and(eq(notificationsTable.type, "dose_reminder"), gte(notificationsTable.sentAt, since));

  const [totals] = await db
    .select({
      sent: sql<number>`count(*)`.mapWith(Number),
      delivered: sql<number>`count(${notificationsTable.deliveredAt})`.mapWith(Number),
      acked: sql<number>`count(${notificationsTable.ackedAt})`.mapWith(Number),
    })
    .from(notificationsTable)
    .where(periodFilter);

  const byPlatformRows = await db
    .select({
      platform: notificationsTable.deliveredViaPlatform,
      delivered: sql<number>`count(*)`.mapWith(Number),
    })
    .from(notificationsTable)
    .where(and(periodFilter, sql`${notificationsTable.deliveredAt} is not null`))
    .groupBy(notificationsTable.deliveredViaPlatform);

  const failuresByReasonRows = await db
    .select({
      reason: notificationsTable.lastFailureReason,
      count: sql<number>`count(*)`.mapWith(Number),
    })
    .from(notificationsTable)
    .where(and(periodFilter, sql`${notificationsTable.lastFailureReason} is not null`))
    .groupBy(notificationsTable.lastFailureReason);

  const dayBucket = sql<string>`date_trunc('day', ${notificationsTable.sentAt})`;
  const byDayRows = await db
    .select({
      bucket: dayBucket,
      sent: sql<number>`count(*)`.mapWith(Number),
      delivered: sql<number>`count(${notificationsTable.deliveredAt})`.mapWith(Number),
    })
    .from(notificationsTable)
    .where(periodFilter)
    .groupBy(dayBucket)
    .orderBy(dayBucket);

  const hourBucket = sql<string>`date_trunc('hour', ${notificationsTable.sentAt})`;
  const byHourRows = await db
    .select({
      bucket: hourBucket,
      sent: sql<number>`count(*)`.mapWith(Number),
      delivered: sql<number>`count(${notificationsTable.deliveredAt})`.mapWith(Number),
    })
    .from(notificationsTable)
    .where(and(eq(notificationsTable.type, "dose_reminder"), gte(notificationsTable.sentAt, since24h)))
    .groupBy(hourBucket)
    .orderBy(hourBucket);

  // Latência só faz sentido pro nível 0 — os demais são deliberadamente
  // atrasados (T+15/30/60), não é "atraso" ali, é o desenho da cascata.
  const [latencyRow] = await db
    .select({
      avgLatencySeconds: sql<number | null>`avg(extract(epoch from (${notificationsTable.sentAt} - ${scheduledDosesTable.scheduledAt})))`.mapWith((v) => (v === null ? null : Number(v))),
    })
    .from(notificationsTable)
    .innerJoin(scheduledDosesTable, eq(scheduledDosesTable.id, notificationsTable.scheduledDoseId))
    .where(and(periodFilter, eq(notificationsTable.escalationLevel, 0)));

  const subscriptionRows = await db
    .select({
      active: pushSubscriptionsTable.active,
      count: sql<number>`count(*)`.mapWith(Number),
    })
    .from(pushSubscriptionsTable)
    .groupBy(pushSubscriptionsTable.active);

  const sent = totals?.sent ?? 0;
  const delivered = totals?.delivered ?? 0;
  const acked = totals?.acked ?? 0;

  res.json({
    periodDays: days,
    totalSent: sent,
    totalDelivered: delivered,
    totalActed: acked,
    deliveryRate: sent > 0 ? delivered / sent : null,
    actionRate: delivered > 0 ? acked / delivered : null,
    avgLatencySeconds: latencyRow?.avgLatencySeconds ?? null,
    byPlatform: byPlatformRows.filter((r) => r.platform !== null).map((r) => ({ platform: r.platform, delivered: r.delivered })),
    failuresByReason: failuresByReasonRows.filter((r) => r.reason !== null).map((r) => ({ reason: r.reason, count: r.count })),
    byDay: byDayRows.map((r) => ({ date: r.bucket, sent: r.sent, delivered: r.delivered })),
    byHour: byHourRows.map((r) => ({ hour: r.bucket, sent: r.sent, delivered: r.delivered })),
    subscriptions: {
      active: subscriptionRows.find((r) => r.active === true)?.count ?? 0,
      inactive: subscriptionRows.find((r) => r.active === false)?.count ?? 0,
    },
  });
});

router.get("/admin/alerts", requireAdminAuth, async (req, res): Promise<void> => {
  const limit = Math.min(200, Math.max(1, parseInt(String(req.query.limit ?? "50"), 10) || 50));

  const active = await db
    .select()
    .from(operationalAlertsTable)
    .where(isNull(operationalAlertsTable.resolvedAt))
    .orderBy(desc(operationalAlertsTable.triggeredAt));

  const recent = await db
    .select()
    .from(operationalAlertsTable)
    .orderBy(desc(operationalAlertsTable.triggeredAt))
    .limit(limit);

  res.json({ active, recent });
});

export default router;
