import { Router } from "express";
import {
  CreateSubscriptionBody,
  DeleteSubscriptionParams,
  ListProjectSubscriptionsParams,
} from "@workspace/api-zod";
import { logger } from "@workspace/core";
import { SubscriptionService } from "../services/subscription.service.js";

const router = Router();
const subscriptionService = new SubscriptionService();

router.post("/subscriptions", async (req, res) => {
  try {
    const body = CreateSubscriptionBody.parse(req.body);

    const subscriber = await subscriptionService.getProject(body.subscriberProjectId);
    if (!subscriber) return res.status(404).json({ error: "Subscriber project not found" });

    const publisher = await subscriptionService.getProject(body.publisherProjectId);
    if (!publisher) return res.status(404).json({ error: "Publisher project not found" });

    const sub = await subscriptionService.createSubscription(
      body.subscriberProjectId,
      body.publisherProjectId
    );

    return res.status(201).json({ ...sub, createdAt: sub.createdAt.toISOString() });
  } catch (err: unknown) {
    if (err instanceof Error && err.message.toLowerCase().includes("unique")) {
      return res.status(409).json({ error: "Subscription already exists" });
    }
    logger.error({ err }, "Failed to create subscription");
    return res.status(500).json({ error: "Failed to create subscription" });
  }
});

router.delete("/subscriptions/:subscriptionId", async (req, res) => {
  try {
    const params = DeleteSubscriptionParams.parse(req.params);
    const deleted = await subscriptionService.deleteSubscription(params.subscriptionId);

    if (!deleted) return res.status(404).json({ error: "Subscription not found" });
    return res.status(204).end();
  } catch (err: unknown) {
    logger.error({ err }, "Failed to delete subscription");
    return res.status(500).json({ error: "Failed to delete subscription" });
  }
});

router.get("/projects/:projectId/subscriptions", async (req, res) => {
  try {
    const params = ListProjectSubscriptionsParams.parse(req.params);

    const subs = await subscriptionService.getSubscriptionsForProject(params.projectId);

    return res.json({
      subscriptions: subs.map((s) => ({ ...s, createdAt: s.createdAt.toISOString() })),
    });
  } catch (err: unknown) {
    logger.error({ err }, "Failed to list subscriptions");
    return res.status(500).json({ error: "Failed to list subscriptions" });
  }
});

export { router as subscriptionsRouter };
