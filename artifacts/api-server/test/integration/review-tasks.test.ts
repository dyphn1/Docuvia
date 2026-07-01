import request from "supertest";
import { describe, expect, it } from "vitest";
import app from "../../src/app";
import { withRollback } from "../support/db";
import { ProjectFactory, L2NodeFactory, L3NodeFactory } from "../support/factories";
import { db } from "@workspace/db";
import { l1TagsTable, reviewTasksTable } from "@workspace/db";

describe("Review Tasks API", () => {
  it("GET /review-tasks returns enriched tasks", async () => {
    await withRollback(async () => {
      const project = await ProjectFactory.create();
      const l2 = await L2NodeFactory.create({ projectId: project.id });
      const l3 = await L3NodeFactory.create({ projectId: project.id, l2NodeId: l2.id });

      const [l1] = await db
        .insert(l1TagsTable)
        .values({ name: "t1", category: "arch", description: "desc" })
        .returning();
      await db
        .insert(reviewTasksTable)
        .values({ entityType: "l1_tag", entityId: l1.id, status: "pending", taskType: "validate" });
      await db.insert(reviewTasksTable).values({
        entityType: "l2_node",
        entityId: l2.id,
        status: "pending",
        taskType: "validate",
      });
      await db.insert(reviewTasksTable).values({
        entityType: "l3_node",
        entityId: l3.id,
        status: "pending",
        taskType: "validate",
      });

      const res = await request(app)
        .get("/api/review-tasks?status=pending")
        .set("Authorization", "Bearer 1");
      expect(res.status).toBe(200);
      expect(res.body.length).toBeGreaterThanOrEqual(3);
    });
  });

  it("GET /review-tasks/stats returns stats", async () => {
    await withRollback(async () => {
      const [l1] = await db
        .insert(l1TagsTable)
        .values({ name: "t2", category: "arch", description: "desc" })
        .returning();
      await db
        .insert(reviewTasksTable)
        .values({ entityType: "l1_tag", entityId: l1.id, status: "pending", taskType: "validate" });
      const res = await request(app)
        .get("/api/review-tasks/stats")
        .set("Authorization", "Bearer 1");
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("pending");
    });
  });

  it("PATCH /review-tasks/:id resolves task", async () => {
    await withRollback(async () => {
      const [l1] = await db
        .insert(l1TagsTable)
        .values({ name: "t3", category: "arch", description: "desc" })
        .returning();
      const [task] = await db
        .insert(reviewTasksTable)
        .values({ entityType: "l1_tag", entityId: l1.id, status: "pending", taskType: "validate" })
        .returning();

      const res = await request(app)
        .patch(`/api/review-tasks/${task.id}`)
        .set("Authorization", "Bearer 1")
        .send({ status: "approved" });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe("approved");
    });
  });
});
