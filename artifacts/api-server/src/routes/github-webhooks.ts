import { API_MESSAGES } from "@workspace/core";
// Max's Rule: VCR-style testing uses static signed fixtures.
// Do not test against live GitHub API in CI to prevent rate limits.
import { Router } from "express";
import { logger } from "@workspace/core";
import { GithubWebhookService } from "../services/github-webhook.service.js";

const router = Router();
const webhookService = new GithubWebhookService();

// POST /webhooks/github/:projectId
// Note: this router is mounted with express.raw() middleware in app.ts
router.post("/:projectId", async (req, res) => {
  const projectId = Number(req.params.projectId);
  if (isNaN(projectId)) {
    return res.status(400).json({ error: API_MESSAGES.GITHUB_WEBHOOK_INVALID_PROJECT_ID });
  }

  const rawBody = req.body as Buffer;
  const signature = req.headers["x-hub-signature-256"] as string | undefined;
  const eventType = req.headers["x-github-event"] as string | undefined;

  const webhookSecret = process.env.GITHUB_WEBHOOK_SECRET;

  if (!webhookSecret || webhookSecret.length < 16) {
    logger.error(
      "GITHUB_WEBHOOK_SECRET is not properly configured (missing or too short). Failing closed."
    );
    return res.status(500).json({ error: API_MESSAGES.SERVER_MISCONFIGURATION });
  }

  try {
    const result = await webhookService.processWebhook(
      projectId,
      rawBody,
      signature || "",
      eventType || "",
      webhookSecret
    );

    if (result.error) {
      return res.status(result.status).json({ error: result.error });
    }
    return res.status(result.status).json({ message: result.message });
  } catch (err) {
    logger.error({ err, projectId }, "Unhandled error in webhook processing");
    return res.status(500).json({ error: API_MESSAGES.INTERNAL_SERVER_ERROR });
  }
});

export { router as githubWebhooksRouter };
