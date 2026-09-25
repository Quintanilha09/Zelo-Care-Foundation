/**
 * Monitor operacional — ZELO-32.
 *
 * Três checagens independentes, cada uma respondendo uma pergunta que a
 * spec (§3.3) trata como P0 — "a operação precisa saber antes do usuário":
 *   - delivery_rate: a taxa de entrega (delivered/sent) da última hora caiu
 *     abaixo de 95%? (amostra mínima pra não alarmar hora vazia)
 *   - queue_stuck: existe job de lembrete/verificação de entrega vencido há
 *     mais de 5min e ainda não processado? (fila travada é sintoma de
 *     worker morto ou banco fora do ar)
 *   - no_send_window: existia dose agendada numa janela passada e NENHUM
 *     lembrete de nível 0 foi enviado pra ela? (falha de AGENDAMENTO — pior
 *     que falha de entrega, porque nem tentativa houve)
 *
 * Cada checagem cria no máximo 1 alerta ATIVO por tipo (resolvedAt nulo) —
 * rodar de novo com a condição ainda verdadeira não duplica linha, só a
 * condição voltar a ficar boa que resolve (ver resolveIfCleared). "Canal do
 * operador" aqui é log de servidor (logger.error) — sem provedor pago novo,
 * a própria história pede isso ("Postgres agregando e um alerta simples
 * resolvem no estágio atual").
 */
import { sql, eq, and, gte, isNull } from "drizzle-orm";
import { db } from "@workspace/db";
import { notificationsTable, operationalAlertsTable, type OperationalAlert } from "@workspace/db";
import { Clock } from "./clock.ts";
import { logger } from "./logger.ts";

const DELIVERY_RATE_THRESHOLD = 0.95;
const DELIVERY_RATE_MIN_SAMPLE = 5; // menos que isso na última hora, o percentual não é confiável
const QUEUE_STUCK_GRACE_MINUTES = 5;
const NO_SEND_WINDOW_START_MINUTES = 70; // dose devia ter disparado o nível 0 em scheduledAt — folga generosa
const NO_SEND_WINDOW_END_MINUTES = 10; // não olha os últimos 10min — job pode estar em voo, ainda não é atraso

interface CheckResult {
  triggered: boolean;
  message: string;
  metricValue?: number;
  thresholdValue?: number;
}

async function checkDeliveryRate(): Promise<CheckResult> {
  const oneHourAgo = new Date(Clock.now().getTime() - 60 * 60_000);
  const [row] = await db
    .select({
      sentCount: sql<number>`count(*)::int`,
      deliveredCount: sql<number>`count(${notificationsTable.deliveredAt})::int`,
    })
    .from(notificationsTable)
    .where(and(eq(notificationsTable.type, "dose_reminder"), gte(notificationsTable.sentAt, oneHourAgo)));

  const sent = row?.sentCount ?? 0;
  const delivered = row?.deliveredCount ?? 0;
  if (sent < DELIVERY_RATE_MIN_SAMPLE) {
    return { triggered: false, message: "" };
  }
  const rate = delivered / sent;
  return {
    triggered: rate < DELIVERY_RATE_THRESHOLD,
    message: `Taxa de entrega da última hora: ${Math.round(rate * 100)}% (${delivered}/${sent}), abaixo do limite de ${Math.round(DELIVERY_RATE_THRESHOLD * 100)}%.`,
    metricValue: rate,
    thresholdValue: DELIVERY_RATE_THRESHOLD,
  };
}

async function checkQueueStuck(): Promise<CheckResult> {
  // Deliberadamente new Date(), não Clock.now(): start_after em pgboss.job é
  // escrito com o relógio REAL do Postgres (pg-boss não conhece Clock.ts,
  // mesma ressalva documentada em dose-reminders.test.ts) — comparar contra
  // um corte "adiantado" via Clock.travelTo daria resultado errado em teste.
  const cutoff = new Date(Date.now() - QUEUE_STUCK_GRACE_MINUTES * 60_000); // clock-lint-ok: pgboss.job.start_after usa o relogio real do Postgres, nao o Clock
  const result = await db.execute<{ count: number }>(sql`
    SELECT count(*)::int as count
    FROM pgboss.job
    WHERE state IN ('created', 'retry')
      AND start_after < ${cutoff}
  `);
  const count = result.rows[0]?.count ?? 0;
  return {
    triggered: count > 0,
    message: `${count} job(s) na fila vencido(s) há mais de ${QUEUE_STUCK_GRACE_MINUTES}min sem processar.`,
    metricValue: count,
    thresholdValue: 0,
  };
}

async function checkNoSendWindow(): Promise<CheckResult> {
  const windowStart = new Date(Clock.now().getTime() - NO_SEND_WINDOW_START_MINUTES * 60_000);
  const windowEnd = new Date(Clock.now().getTime() - NO_SEND_WINDOW_END_MINUTES * 60_000);
  const result = await db.execute<{ count: number }>(sql`
    SELECT count(*)::int as count
    FROM scheduled_doses sd
    WHERE sd.scheduled_at BETWEEN ${windowStart} AND ${windowEnd}
      AND sd.status IN ('pending', 'late')
      AND NOT EXISTS (
        SELECT 1 FROM notifications n
        WHERE n.scheduled_dose_id = sd.id AND n.escalation_level = 0 AND n.sent_at IS NOT NULL
      )
  `);
  const count = result.rows[0]?.count ?? 0;
  return {
    triggered: count > 0,
    message: `${count} dose(s) agendada(s) sem NENHUM lembrete de nível 0 enviado — falha de agendamento, não só de entrega.`,
    metricValue: count,
    thresholdValue: 0,
  };
}

/**
 * A última cópia de segurança é velha demais? — Issue #199.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * BACKUP QUE FALHA CALADO É O MESMO QUE NÃO TER BACKUP.
 *
 * O job roda de hora em hora. Se ele parar — credencial expirada, bucket
 * renomeado, `pg_dump` sumindo da imagem num deploy — nada quebra na tela, e
 * ninguém percebe. A descoberta viria no dia em que se precisa restaurar, que
 * é o pior dia possível para descobrir.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Três horas de tolerância: duas execuções perdidas. Uma só pode ser um
 * reinício do contêiner na hora errada, e alertar nisso ensina a ignorar o
 * alerta.
 *
 * ── Por que a fonte é o pg-boss, e não o S3 ──────────────────────────────
 *
 * Perguntar ao S3 exigiria dar `s3:ListBucket` do bucket de backup à
 * credencial do app — e o desenho da #199 é justamente que ela só escreva.
 * O pg-boss já registra quando cada job terminou, no mesmo banco.
 *
 * ── Por que só quando o backup está configurado ──────────────────────────
 *
 * Sem `BACKUP_S3_BUCKET` não há backup a cobrar: é o caso do dev local e do
 * CI. Em produção sem configuração, quem grita é o próprio job, que registra
 * `[SEGURANCA]` e falha — e job falhando acorda o `queue_stuck`.
 */
const BACKUP_TOLERANCIA_HORAS = 3;

async function checkBackupAtrasado(): Promise<CheckResult> {
  if (!process.env.BACKUP_S3_BUCKET?.trim()) {
    return { triggered: false, message: "backup não configurado neste ambiente" };
  }

  // `completed_on` e escrito pelo pg-boss com o relogio REAL do Postgres, e
  // nao pelo Clock — mesma ressalva do checkQueueStuck logo acima.
  const corte = new Date(Date.now() - BACKUP_TOLERANCIA_HORAS * 60 * 60_000); // clock-lint-ok: pgboss.job.completed_on usa o relogio real do Postgres, nao o Clock

  const resultado = await db.execute<{ ultimo: Date | null }>(sql`
    SELECT max(completed_on) AS ultimo
    FROM pgboss.job
    WHERE name = 'backup-do-banco'
      AND state = 'completed'
  `);

  const ultimo = resultado.rows[0]?.ultimo ?? null;

  if (!ultimo) {
    return {
      triggered: true,
      message:
        "Nenhuma copia de seguranca bem-sucedida registrada. " +
        "O banco esta sem backup proprio.",
      metricValue: 0,
      thresholdValue: BACKUP_TOLERANCIA_HORAS,
    };
  }

  const horas = (Date.now() - new Date(ultimo).getTime()) / 3_600_000; // clock-lint-ok: comparado contra completed_on, que e do relogio do Postgres
  return {
    triggered: new Date(ultimo) < corte,
    message: `Ultima copia de seguranca ha ${horas.toFixed(1)}h (tolerancia: ${BACKUP_TOLERANCIA_HORAS}h).`,
    metricValue: Number(horas.toFixed(1)),
    thresholdValue: BACKUP_TOLERANCIA_HORAS,
  };
}

const CHECKS: Record<
  "delivery_rate" | "queue_stuck" | "no_send_window" | "backup_atrasado",
  () => Promise<CheckResult>
> = {
  delivery_rate: checkDeliveryRate,
  queue_stuck: checkQueueStuck,
  no_send_window: checkNoSendWindow,
  backup_atrasado: checkBackupAtrasado,
};

async function findActiveAlert(type: keyof typeof CHECKS): Promise<OperationalAlert | null> {
  const [row] = await db
    .select()
    .from(operationalAlertsTable)
    .where(and(eq(operationalAlertsTable.type, type), isNull(operationalAlertsTable.resolvedAt)))
    .limit(1);
  return row ?? null;
}

/**
 * Roda as 4 checagens. Pra cada uma: condição verdadeira + sem alerta ativo
 * do tipo -> cria (e loga ERROR, o "canal do operador"); condição falsa +
 * alerta ativo existente -> resolve. Reprocessar com a mesma condição não
 * cria linha nova nem loga de novo — só a TRANSIÇÃO de estado é evento.
 */
export async function runOperationalChecks(): Promise<void> {
  for (const type of Object.keys(CHECKS) as Array<keyof typeof CHECKS>) {
    const result = await CHECKS[type]();
    const active = await findActiveAlert(type);

    if (result.triggered && !active) {
      await db.insert(operationalAlertsTable).values({
        type,
        message: result.message,
        metricValue: result.metricValue ?? null,
        thresholdValue: result.thresholdValue ?? null,
        triggeredAt: Clock.now(),
      });
      logger.error({ alertType: type, metricValue: result.metricValue }, `[ALERTA OPERACIONAL] ${result.message}`);
    } else if (!result.triggered && active) {
      await db.update(operationalAlertsTable).set({ resolvedAt: Clock.now() }).where(eq(operationalAlertsTable.id, active.id));
      logger.warn({ alertType: type }, `[ALERTA OPERACIONAL] resolvido: ${type}`);
    }
  }
}
