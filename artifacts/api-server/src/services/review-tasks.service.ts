import { db } from "@workspace/db";
import {
  reviewTasksTable,
  projectsTable,
  l1TagsTable,
  l2NodesTable,
  l3NodesTable,
  correctionExamplesTable,
  activityLogTable,
} from "@workspace/db";
import { eq, sql, count, gte } from "drizzle-orm";
import { ResolveReviewTaskBody } from "@workspace/api-zod";
import { z } from "zod";

export class ReviewTasksService {
  private async resolveReviewTaskOwnerId(
    task: typeof reviewTasksTable.$inferSelect
  ): Promise<number | null> {
    if (task.entityType === "l1_tag") {
      return 1; // Assuming 1 is the default sys owner or admin?
    }

    if (task.entityType === "l2_node") {
      const [row] = await db
        .select({ ownerId: projectsTable.ownerId })
        .from(l2NodesTable)
        .innerJoin(projectsTable, eq(projectsTable.id, l2NodesTable.projectId))
        .where(eq(l2NodesTable.id, task.entityId));
      return row?.ownerId ?? null;
    }

    const [row] = await db
      .select({ ownerId: projectsTable.ownerId })
      .from(l3NodesTable)
      .innerJoin(l2NodesTable, eq(l2NodesTable.id, l3NodesTable.l2NodeId))
      .innerJoin(projectsTable, eq(projectsTable.id, l2NodesTable.projectId))
      .where(eq(l3NodesTable.id, task.entityId));
    return row?.ownerId ?? null;
  }

  private async enrichTask(task: typeof reviewTasksTable.$inferSelect) {
    let entityName: string | null = null;
    let projectName: string | null = null;
    let nodeContent: string | null = null;
    let nodeType: string | null = null;

    if (task.entityType === "l1_tag") {
      const [tag] = await db.select().from(l1TagsTable).where(eq(l1TagsTable.id, task.entityId));
      entityName = tag?.name ?? null;
      nodeContent = tag?.description ?? null;
      nodeType = tag?.category ?? null;
    } else if (task.entityType === "l2_node") {
      const [node] = await db.select().from(l2NodesTable).where(eq(l2NodesTable.id, task.entityId));
      entityName = node?.name ?? null;
      nodeContent = node?.description ?? null;
      nodeType = node?.type ?? null;
      if (node) {
        const [proj] = await db
          .select()
          .from(projectsTable)
          .where(eq(projectsTable.id, node.projectId));
        projectName = proj?.name ?? null;
      }
    } else if (task.entityType === "l3_node") {
      const [node] = await db.select().from(l3NodesTable).where(eq(l3NodesTable.id, task.entityId));
      entityName = node?.title ?? null;
      nodeContent = node?.content ?? null;
      nodeType = node?.nodeType ?? null;
      if (node) {
        const [l2] = await db.select().from(l2NodesTable).where(eq(l2NodesTable.id, node.l2NodeId));
        if (l2) {
          const [proj] = await db
            .select()
            .from(projectsTable)
            .where(eq(projectsTable.id, l2.projectId));
          projectName = proj?.name ?? null;
        }
      }
    }

    return {
      ...task,
      entityName,
      projectName,
      nodeContent,
      nodeType,
    };
  }

  async getAllTasks() {
    const tasks = await db
      .select()
      .from(reviewTasksTable)
      .orderBy(sql`${reviewTasksTable.createdAt} desc`);
    return Promise.all(tasks.map((task) => this.enrichTask(task)));
  }

  async getTaskStats() {
    const [pendingRow] = await db
      .select({ count: count() })
      .from(reviewTasksTable)
      .where(eq(reviewTasksTable.status, "pending"));
    const [approvedRow] = await db
      .select({ count: count() })
      .from(reviewTasksTable)
      .where(eq(reviewTasksTable.status, "approved"));
    const [rejectedRow] = await db
      .select({ count: count() })
      .from(reviewTasksTable)
      .where(eq(reviewTasksTable.status, "rejected"));
    const [deferredRow] = await db
      .select({ count: count() })
      .from(reviewTasksTable)
      .where(eq(reviewTasksTable.status, "deferred"));
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const [todayRow] = await db
      .select({ count: count() })
      .from(reviewTasksTable)
      .where(gte(reviewTasksTable.createdAt, today));
      
    return {
      pending: pendingRow.count,
      approved: approvedRow.count,
      rejected: rejectedRow.count,
      deferred: deferredRow.count,
      totalToday: todayRow.count,
    };
  }

  async resolveTask(id: number, userId: number, body: z.infer<typeof ResolveReviewTaskBody>) {
    const [existingTask] = await db
      .select()
      .from(reviewTasksTable)
      .where(eq(reviewTasksTable.id, id));
    if (!existingTask) throw new Error("Task not found");

    const ownerId = await this.resolveReviewTaskOwnerId(existingTask);
    if (!ownerId || ownerId !== userId) {
      throw new Error("Forbidden");
    }

    const [task] = await db
      .update(reviewTasksTable)
      .set({
        status: body.status as any,
        correctedValue: body.correctedValue ?? null,
        resolvedAt: new Date(),
      })
      .where(eq(reviewTasksTable.id, id))
      .returning();

    // Writeback correction to the actual node + store in feedback loop
    if (body.correctedValue && task.status === "approved") {
      if (task.entityType === "l2_node") {
        const [node] = await db.select().from(l2NodesTable).where(eq(l2NodesTable.id, task.entityId));
        if (node && node.description) {
          await db.insert(correctionExamplesTable).values({
            projectId: node.projectId,
            entityType: "l2_node",
            entityId: task.entityId,
            originalContent: node.description,
            correctedContent: body.correctedValue,
          });
        }
        await db
          .update(l2NodesTable)
          .set({
            description: body.correctedValue,
            needsReview: false,
            aiGenerated: false,
          })
          .where(eq(l2NodesTable.id, task.entityId));
      } else if (task.entityType === "l3_node") {
        const [node] = await db.select().from(l3NodesTable).where(eq(l3NodesTable.id, task.entityId));
        if (node && node.content) {
          const [l2] = await db.select().from(l2NodesTable).where(eq(l2NodesTable.id, node.l2NodeId));
          if (l2) {
            await db.insert(correctionExamplesTable).values({
              projectId: l2.projectId,
              entityType: "l3_node",
              entityId: task.entityId,
              originalContent: node.content,
              correctedContent: body.correctedValue,
            });
          }
        }
        await db
          .update(l3NodesTable)
          .set({
            content: body.correctedValue,
            aiGenerated: false,
          })
          .where(eq(l3NodesTable.id, task.entityId));
      } else if (task.entityType === "l1_tag") {
        await db
          .update(l1TagsTable)
          .set({
            description: body.correctedValue,
          })
          .where(eq(l1TagsTable.id, task.entityId));
      }
    }

    // Mark node as reviewed on approve/reject
    if (task.entityType === "l2_node" && (body.status === "approved" || body.status === "rejected")) {
      await db
        .update(l2NodesTable)
        .set({ needsReview: false })
        .where(eq(l2NodesTable.id, task.entityId));
    }

    await db.insert(activityLogTable).values({
      type: "review_resolved",
      description: `Review task #${id} ${body.status}${body.correctedValue ? " (with correction)" : ""}`,
    });

    return this.enrichTask(task);
  }
}

export const reviewTasksService = new ReviewTasksService();
