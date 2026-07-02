import { Router } from "express";
import { ProjectService } from "../services/project.service.js";
import { logger } from "@workspace/core";
import { requireApiKey } from "../middlewares/auth.js";
import { SyncPushBody } from "@workspace/api-zod";
import { SyncService } from "../services/sync.service.js";

const router = Router();
const syncService = new SyncService();

// POST /sync/push (CQRS Outbox receiver)
router.post("/sync/push", requireApiKey, async (req, res) => {
  const parsed = SyncPushBody.safeParse(req.body);
  if (!parsed.success) {
    return res
      .status(400)
      .json({ error: parsed.error.issues[0]?.message ?? "Invalid outbox payload" });
  }

  const { projectId, events } = parsed.data;

  // Project Ownership Auth Check
  const project = await new ProjectService().getProjectById(projectId);
  if (!project) return res.status(404).json({ error: "Project not found" });
  if (project.ownerId !== (req as any).user?.id) {
    return res.status(403).json({ error: "Forbidden: Not project owner" });
  }

  // 1. Acquire Central Mutex Lock for this Project
  const acquired = await syncService.acquireProjectLock(projectId);
  if (!acquired) {
    return res.status(409).json({
      error: "Sync conflict: Resource is currently locked by another client. Try again later.",
    });
  }

  try {
    // 2. Apply DB Operations in Transaction (Two-phase commit prep)
    await syncService.processEvents(projectId, events);

    return res.json({ success: true, processed: events.length });
  } catch (err: any) {
    logger.error({ err, projectId }, "[POST /sync/push] Failed to process outbox events");
    return res.status(500).json({ error: `Sync failed: ${err.message}` });
  }
});

export { router as syncRouter };
