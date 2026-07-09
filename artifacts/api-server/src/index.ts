import { API_MESSAGES } from "@workspace/core";
import app from "./app";
import { logger, JanitorService, L3HealingService } from "@workspace/core";
import { jobQueueWorker } from "./workers/job-queue.worker";
import { ENV_PORT_KEY, STARTUP_JANITOR_DELAY_MS, JANITOR_INTERVAL_MS } from "./constants/index.js";

const rawPort = process.env[ENV_PORT_KEY];

if (!rawPort) {
  throw new Error(API_MESSAGES.PORT_REQUIRED);
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(API_MESSAGES.INVALID_PORT(rawPort));
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");

  // Start job queue worker
  jobQueueWorker.start();

  // Start background janitor
  const janitor = new JanitorService();
  const l3Healer = new L3HealingService();

  // Run once on startup (with a small delay)
  setTimeout(() => {
    l3Healer.reanchorL3Rules().catch((err: unknown) => {
      logger.error({ err }, "Initial janitor run failed");
    });
    janitor.purgeOldLogsAndJobs().catch((err: unknown) => {
      logger.error({ err }, "Initial janitor run failed");
    });
  }, STARTUP_JANITOR_DELAY_MS);

  setInterval(() => {
    l3Healer.reanchorL3Rules().catch((err: unknown) => {
      logger.error({ err }, "Janitor interval run failed");
    });
    janitor.purgeOldLogsAndJobs().catch((err: unknown) => {
      logger.error({ err }, "Janitor purge logs run failed");
    });
  }, JANITOR_INTERVAL_MS);
});
