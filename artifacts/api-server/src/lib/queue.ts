/**
 * Fila de jobs — ZELO (ZELO-18).
 *
 * pg-boss rodando sobre o mesmo Postgres da aplicação (não uma infra
 * separada). É isso que permite inserir uma dose e enfileirar o job
 * correspondente NA MESMA TRANSAÇÃO (via fromDrizzle, usado em
 * dose-generation.ts) — dose e job não podem divergir, porque um commit
 * que falha desfaz os dois juntos.
 *
 * Duas filas:
 * - QUEUE_DOSE_SCHEDULED: um evento por dose criada. Ainda sem consumidor
 *   (nenhuma notificação nesta história) — existe para uma história futura
 *   assinar. policy "exclusive" + singletonKey por dose faz do envio uma
 *   operação idempotente: reenviar para a mesma dose é no-op se já houver
 *   job ativo ou na fila. É isso que torna a reconciliação seguro rodar
 *   quantas vezes for preciso (ver reconcileDoseQueue em dose-generation.ts).
 * - QUEUE_EXTEND_DOSE_WINDOW: job diário (cron) que estende a janela
 *   rolante de 14 dias de todo tratamento ativo.
 * - QUEUE_TREATMENT_LIFECYCLE: job diário (cron) que fecha tratamento
 *   vencido, avisa véspera de fim, e lembra revisão de tratamento contínuo
 *   (ZELO-20). Horário deslocado 5min do de doses só pra não competir à toa.
 * - QUEUE_DOSE_TAKEN: um evento por dose registrada como tomada (ZELO-23).
 *   Decrementa estoque sem o módulo de registro de dose conhecer o de
 *   estoque — só publica o evento, quem decrementa é um worker separado.
 * - QUEUE_DOSE_REMINDER: um job por dose criada, agendado pra disparar em
 *   scheduled_at (ZELO-27). policy "exclusive" + singletonKey
 *   `reminder:{doseId}:0` — mesma idempotência de enfileiramento que
 *   QUEUE_DOSE_SCHEDULED. retryLimit/retryBackoff no nível da fila: uma
 *   falha de infraestrutura (não de envio — ver lib/dose-reminders.ts) faz
 *   o pg-boss retentar sozinho, sem lógica extra no handler.
 */
import { PgBoss } from "pg-boss";

export const QUEUE_DOSE_SCHEDULED = "dose-scheduled";
export const QUEUE_EXTEND_DOSE_WINDOW = "extend-dose-window";
export const QUEUE_TREATMENT_LIFECYCLE = "treatment-lifecycle";
export const QUEUE_DOSE_TAKEN = "dose-taken";
export const QUEUE_DOSE_REMINDER = "dose-reminder";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL must be set. Did you forget to provision a database?");
}

export const boss = new PgBoss({
  connectionString: process.env.DATABASE_URL,
  // Este processo é o único produtor/consumidor por enquanto — sem
  // necessidade de várias instâncias competindo pelo mesmo schema.
});

/**
 * Sobe a fila e garante que a fila de evento existe. boss.start() é
 * idempotente (retorna cedo se já iniciado) e createQueue usa
 * ON CONFLICT DO NOTHING — chamar isto quantas vezes for preciso, de
 * qualquer lugar (rotas, testes), é seguro e barato depois da 1ª vez.
 *
 * Sem isto, dose-generation.ts explodiria ao tentar usar `boss` antes de
 * `start()` — cada função que usa a fila chama isto primeiro.
 */
export async function ensureQueueStarted(): Promise<void> {
  await boss.start();
  await boss.createQueue(QUEUE_DOSE_SCHEDULED, { policy: "exclusive" });
  await boss.createQueue(QUEUE_DOSE_TAKEN, { policy: "standard" });
  // 30s inicial, dobra a cada tentativa (com jitter), até 10min, 5 tentativas
  // — número não vem da spec (só pede "backoff exponencial" + "limite"),
  // escolhido pra não bater no serviço de push a cada segundo numa falha
  // persistente, mas ainda assim recuperar rápido de um blip momentâneo.
  await boss.createQueue(QUEUE_DOSE_REMINDER, {
    policy: "exclusive",
    retryLimit: 5,
    retryBackoff: true,
    retryDelay: 30,
    retryDelayMax: 600,
  });
}

/**
 * Além do básico de ensureQueueStarted, registra o cron diário de
 * manutenção e o worker que o processa. Chamado uma vez, no boot do
 * processo (index.ts) — não em testes, que não precisam do cron rodando.
 *
 * `extendWindows` é injetado (em vez de importado direto de
 * dose-generation.ts) para não criar um ciclo de import entre os dois
 * módulos — quem monta a ligação é o entrypoint (index.ts).
 */
export async function startQueue(handlers: {
  extendWindows: () => Promise<void>;
  runTreatmentLifecycle: () => Promise<void>;
  onDoseTaken: (data: { patientId: number; medicationId: number }) => Promise<void>;
  onDoseReminder: (data: { scheduledDoseId: number; level?: number }) => Promise<void>;
}): Promise<void> {
  await ensureQueueStarted();

  await boss.createQueue(QUEUE_EXTEND_DOSE_WINDOW, { policy: "singleton" });
  await boss.createQueue(QUEUE_TREATMENT_LIFECYCLE, { policy: "singleton" });

  // 03:00 UTC todo dia — não é crítico ser exato por fuso do paciente,
  // a janela é de 14 dias, algumas horas de folga não importam.
  await boss.schedule(QUEUE_EXTEND_DOSE_WINDOW, "0 3 * * *", null, { tz: "UTC" });
  await boss.schedule(QUEUE_TREATMENT_LIFECYCLE, "5 3 * * *", null, { tz: "UTC" });

  await boss.work(QUEUE_EXTEND_DOSE_WINDOW, async () => {
    await handlers.extendWindows();
  });
  await boss.work(QUEUE_TREATMENT_LIFECYCLE, async () => {
    await handlers.runTreatmentLifecycle();
  });
  await boss.work(QUEUE_DOSE_TAKEN, async (jobs) => {
    for (const job of jobs) {
      await handlers.onDoseTaken(job.data as { patientId: number; medicationId: number });
    }
  });
  await boss.work(QUEUE_DOSE_REMINDER, async (jobs) => {
    for (const job of jobs) {
      await handlers.onDoseReminder(job.data as { scheduledDoseId: number; level?: number });
    }
  });
}

export async function stopQueue(): Promise<void> {
  await boss.stop({ graceful: true });
}
