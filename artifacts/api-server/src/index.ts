import app from "./app";
import { logger, JanitorService } from "@workspace/core";
import { jobQueueWorker } from "./workers/job-queue.worker";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error("PORT environment variable is required but was not provided.");
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
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
  const JANITOR_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

  // Run once on startup (with a small delay)
  setTimeout(() => {
    janitor.reanchorL3Rules().catch((err: unknown) => {
      logger.error({ err }, "Initial janitor run failed");
    });
    janitor.purgeOldLogsAndJobs().catch((err: unknown) => {
      logger.error({ err }, "Initial janitor run failed");
    });
  }, 10000);

  setInterval(() => {
    janitor.reanchorL3Rules().catch((err: unknown) => {
      logger.error({ err }, "Janitor interval run failed");
    });
    janitor.purgeOldLogsAndJobs().catch((err: unknown) => {
      logger.error({ err }, "Janitor purge logs run failed");
    });
  }, JANITOR_INTERVAL_MS);
});
