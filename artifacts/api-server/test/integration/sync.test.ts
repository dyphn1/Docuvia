import { describe, it, expect, vi } from "vitest";
import request from "supertest";
import app from "../../src/app.js";
import { ProjectFactory, L2NodeFactory } from "@workspace/test-utils";
import { withRollback } from "@workspace/test-utils";

vi.mock("@workspace/core", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    writeKnowledgeToOrphanBranch: vi.fn().mockResolvedValue(true),
    logger: actual.logger,
  };
});

vi.mock("../../src/middlewares/auth.js", () => ({
  requireApiKey: (req, res, next) => {
    req.user = { id: req.body.ownerId || 1 };
    next();
  },
}));

describe("Sync API", () => {
  it("POST /api/sync/push processes UPDATE_L3", () =>
    withRollback(async () => {
      const project = await ProjectFactory.create({ ownerId: 1 });
      const l2 = await L2NodeFactory.create({ projectId: project.id });

      const res = await request(app)
        .post("/api/sync/push")
        .send({
          projectId: project.id,
          ownerId: 1,
          events: [
            {
              id: "evt2",
              type: "UPDATE_L3",
              payload: {
                id: 999,
                data: { title: "Updated" },
              },
              timestamp: new Date().toISOString(),
            },
          ],
        });

      expect(res.status).toBe(200);
    }));

  it("POST /api/sync/push returns 403 if not owner", () =>
    withRollback(async () => {
      const project = await ProjectFactory.create({ ownerId: 2 });
      const res = await request(app).post("/api/sync/push").send({
        projectId: project.id,
        ownerId: 1, // our fake user is 1
        events: [],
      });
      expect(res.status).toBe(403);
    }));

  it("POST /api/sync/push processes sync events", () =>
    withRollback(async () => {
      const project = await ProjectFactory.create({ ownerId: 1 });
      const l2 = await L2NodeFactory.create({ projectId: project.id });

      const res = await request(app)
        .post("/api/sync/push")
        .send({
          projectId: project.id,
          ownerId: 1,
          events: [
            {
              id: "evt1",
              type: "CREATE_L3",
              payload: {
                l2NodeId: l2.id,
                title: "New node",
                content: "Content",
                nodeType: "change",
              },
              timestamp: new Date().toISOString(),
            },
          ],
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    }));
});
