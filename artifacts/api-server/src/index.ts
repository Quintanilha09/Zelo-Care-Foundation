import app from "./app";
import { logger } from "./lib/logger";
import { startQueue, stopQueue } from "./lib/queue";
import { extendActiveTreatmentWindows, reconcileDoseQueue } from "./lib/dose-generation";
import { runTreatmentLifecycleJob } from "./lib/treatment-lifecycle";
import { decrementStockForDoseTaken } from "./lib/stock";
import { sendDoseReminder } from "./lib/dose-reminders";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

await startQueue({
  extendWindows: async () => {
    await extendActiveTreatmentWindows();
  },
  runTreatmentLifecycle: async () => {
    await runTreatmentLifecycleJob();
  },
  onDoseTaken: async ({ patientId, medicationId }) => {
    await decrementStockForDoseTaken(patientId, medicationId);
  },
  onDoseReminder: async ({ scheduledDoseId, level }) => {
    await sendDoseReminder(scheduledDoseId, level);
  },
});

// Rede de segurança contra crash no meio de uma geração de dose anterior:
// garante que toda dose pendente futura tem um job DoseScheduled correspondente.
const reconciled = await reconcileDoseQueue();
if (reconciled > 0) {
  logger.warn({ reconciled }, "Reconciliação da fila de doses reenviou eventos faltando");
}

const server = app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
});

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    server.close(() => {
      void stopQueue().finally(() => process.exit(0));
    });
  });
}
