import request from "supertest";
import { describe, expect, it } from "vitest";
import app from "../../src/app";
import { withRollback } from "@workspace/test-utils";
import { ProjectFactory, L2NodeFactory } from "@workspace/test-utils";

describe("L3 Nodes API", () => {
  it("CRUD operations for L3 Nodes", async () => {
    await withRollback(async () => {
      const project = await ProjectFactory.create();
      const l2Node = await L2NodeFactory.create({ projectId: project.id });

      // Create
      const resCreate = await request(app)
        .post(`/api/l2-nodes/${l2Node.id}/l3-nodes`)
        .set("Authorization", "Bearer test-api-key")
        .send({
          l2NodeId: l2Node.id,
          title: "Use Redis for caching",
          content: "We decided to use Redis",
          nodeType: "decision",
          commitHash: "abc1234",
        });
      expect(resCreate.status).toBe(201);
      const l3NodeId = resCreate.body.id;

      // Get
      const resGet = await request(app)
        .get(`/api/l2-nodes/${l2Node.id}/l3-nodes`)
        .set("Authorization", "Bearer test-api-key");
      expect(resGet.status).toBe(200);
      expect(Array.isArray(resGet.body)).toBe(true);

      // Patch
      const resPatch = await request(app)
        .patch(`/api/l3-nodes/${l3NodeId}`)
        .set("Authorization", "Bearer test-api-key")
        .send({
          title: "Use Redis Updated",
        });
      expect(resPatch.status).toBe(200);
      expect(resPatch.body.title).toBe("Use Redis Updated");

      // Delete
      const resDelete = await request(app)
        .delete(`/api/l3-nodes/${l3NodeId}`)
        .set("Authorization", "Bearer test-api-key");
      expect(resDelete.status).toBe(204);
    });
  });
});
