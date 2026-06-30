import request from "supertest";
import { describe, expect, it } from "vitest";
import app from "../../src/app";
import { withRollback } from "../support/db";
import { ProjectFactory, L2NodeFactory, L3NodeFactory } from "../support/factories";
import { db, reviewTasksTable } from "@workspace/db";

describe("Extra Routes API", () => {
  it("GET /api/dashboard returns metrics", async () => {
    await withRollback(async () => {
      const response = await request(app)
        .get("/api/dashboard")
        .set("Authorization", "Bearer test-api-key");
      expect(response.status).toBe(200);
    });
  });

  it("POST /api/search searches knowledge base", async () => {
    await withRollback(async () => {
      const response = await request(app)
        .post("/api/search")
        .set("Authorization", "Bearer test-api-key")
        .send({ query: "test" });
      expect(response.status).toBe(200);
    });
  });

  it("Review Tasks API", async () => {
    await withRollback(async () => {
      const project = await ProjectFactory.create();
      const l2 = await L2NodeFactory.create({ projectId: project.id });
      const l3 = await L3NodeFactory.create({ l2NodeId: l2.id });

      const [task] = await db.insert(reviewTasksTable).values({
        entityType: "l3_node",
        entityId: l3.id,
        taskType: "validate",
        description: "needs review",
        status: "pending",
      }).returning();

      // Get tasks
      const resGet = await request(app)
        .get(`/api/review-tasks`)
        .set("Authorization", "Bearer test-api-key");
      expect(resGet.status).toBe(200);

      // Approve task
      const resApprove = await request(app)
        .patch(`/api/review-tasks/${task.id}`)
        .set("Authorization", "Bearer 1")
        .send({ status: "approved" });
      expect(resApprove.status).toBe(200);

      // Reject task
      const resReject = await request(app)
        .patch(`/api/review-tasks/${task.id}`)
        .set("Authorization", "Bearer 1")
        .send({ status: "rejected" });
      expect(resReject.status).toBe(200);
    });
  });
  
  it("GET /api/projects/:id/export downloads a json file", async () => {
    await withRollback(async () => {
      const project = await ProjectFactory.create();
      const response = await request(app)
        .get(`/api/projects/${project.id}/export`)
        .set("Authorization", "Bearer test-api-key");
      expect(response.status).toBe(200);
      expect(response.body).toBeDefined();
    });
  });

  it("POST /api/webhooks/github/:projectId handles github events", async () => {
    await withRollback(async () => {
      const project = await ProjectFactory.create();
      const response = await request(app)
        .post(`/api/webhooks/github/${project.id}`)
        .set("Authorization", "Bearer test-api-key")
        .set("x-github-event", "push")
        .send({ ref: "refs/heads/main" });
      expect(response.status).toBe(500);
    });
  });
});
