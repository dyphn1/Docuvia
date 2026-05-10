import { Router } from "express";
import { db } from "@workspace/db";
import { reviewTasksTable, projectsTable, l1TagsTable, l2NodesTable, l3NodesTable, activityLogTable } from "@workspace/db";
import { eq, sql, count, and, gte } from "drizzle-orm";
import {
  ResolveReviewTaskParams,
  ResolveReviewTaskBody,
} from "@workspace/api-zod";

const router = Router();

async function enrichTask(task: typeof reviewTasksTable.$inferSelect) {
  let entityName: string | null = null;
  let projectName: string | null = null;

  if (task.entityType === "l1_tag") {
    const [tag] = await db.select().from(l1TagsTable).where(eq(l1TagsTable.id, task.entityId));
    entityName = tag?.name ?? null;
  } else if (task.entityType === "l2_node") {
    const [node] = await db.select().from(l2NodesTable).where(eq(l2NodesTable.id, task.entityId));
    entityName = node?.name ?? null;
    if (node) {
      const [proj] = await db.select().from(projectsTable).where(eq(projectsTable.id, node.projectId));
      projectName = proj?.name ?? null;
    }
  } else if (task.entityType === "l3_node") {
    const [node] = await db.select().from(l3NodesTable).where(eq(l3NodesTable.id, task.entityId));
    entityName = node?.title ?? null;
  }

  return {
    ...task,
    entityName,
    projectName,
    createdAt: task.createdAt.toISOString(),
    resolvedAt: task.resolvedAt?.toISOString() ?? null,
  };
}

router.get("/review-tasks", async (req, res) => {
  const tasks = await db.select().from(reviewTasksTable).orderBy(sql`${reviewTasksTable.createdAt} desc`);
  const result = await Promise.all(tasks.map(enrichTask));
  res.json(result);
});

router.get("/review-tasks/stats", async (req, res) => {
  const [pendingRow] = await db.select({ count: count() }).from(reviewTasksTable).where(eq(reviewTasksTable.status, "pending"));
  const [approvedRow] = await db.select({ count: count() }).from(reviewTasksTable).where(eq(reviewTasksTable.status, "approved"));
  const [rejectedRow] = await db.select({ count: count() }).from(reviewTasksTable).where(eq(reviewTasksTable.status, "rejected"));
  const [deferredRow] = await db.select({ count: count() }).from(reviewTasksTable).where(eq(reviewTasksTable.status, "deferred"));
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const [todayRow] = await db.select({ count: count() }).from(reviewTasksTable).where(gte(reviewTasksTable.createdAt, today));
  res.json({
    pending: pendingRow.count,
    approved: approvedRow.count,
    rejected: rejectedRow.count,
    deferred: deferredRow.count,
    totalToday: todayRow.count,
  });
});

router.patch("/review-tasks/:id", async (req, res) => {
  const { id } = ResolveReviewTaskParams.parse({ id: Number(req.params.id) });
  const body = ResolveReviewTaskBody.parse(req.body);
  const [task] = await db.update(reviewTasksTable).set({
    status: body.status as any,
    correctedValue: body.correctedValue ?? null,
    resolvedAt: new Date(),
  }).where(eq(reviewTasksTable.id, id)).returning();
  if (!task) return res.status(404).json({ error: "Not found" });
  await db.insert(activityLogTable).values({
    type: "review_resolved",
    description: `Review task #${id} ${body.status}`,
  });
  const enriched = await enrichTask(task);
  res.json(enriched);
});

export default router;
