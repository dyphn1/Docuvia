import { Router } from "express";
import type { Request } from "express";
import { reviewTasksService } from "../services/review-tasks.service.js";
import { ResolveReviewTaskParams, ResolveReviewTaskBody } from "@workspace/api-zod";

const router = Router();

function getRequestUserId(req: Request): number | null {
  const requestUserId = (req as any).user?.id;
  if (Number.isInteger(requestUserId) && requestUserId > 0) {
    return requestUserId;
  }

  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    return null;
  }

  const tokenUserId = Number(authHeader.substring(7).trim());
  return Number.isInteger(tokenUserId) && tokenUserId > 0 ? tokenUserId : null;
}

router.get("/review-tasks", async (req, res) => {
  const tasks = await reviewTasksService.getAllTasks();
  res.json(
    tasks.map((task) => ({
      ...task,
      createdAt: task.createdAt.toISOString(),
      resolvedAt: task.resolvedAt?.toISOString() ?? null,
    }))
  );
});

router.get("/review-tasks/stats", async (req, res) => {
  const stats = await reviewTasksService.getTaskStats();
  res.json(stats);
});

router.patch("/review-tasks/:id", async (req, res) => {
  const { id } = ResolveReviewTaskParams.parse({ id: Number(req.params.id) });
  const body = ResolveReviewTaskBody.parse(req.body);

  const userId = getRequestUserId(req);
  if (!userId) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const task = await reviewTasksService.resolveTask(id, userId, body);
    return res.json({
      ...task,
      createdAt: task.createdAt.toISOString(),
      resolvedAt: task.resolvedAt?.toISOString() ?? null,
    });
  } catch (error: any) {
    if (error.message === "Task not found") {
      return res.status(404).json({ error: "Not found" });
    }
    if (error.message === "Forbidden") {
      return res.status(403).json({ error: "Forbidden" });
    }
    console.error(error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export { router as reviewTasksRouter };
