import request from "supertest";
import { describe, expect, it } from "vitest";
import app from "../../src/app";
import { withRollback } from "../support/db";
import { ProjectFactory, L2NodeFactory, L3NodeFactory } from "../support/factories";

describe("Search API", () => {
  it("POST /search routes query", async () => {
    await withRollback(async () => {
      const project = await ProjectFactory.create();

      const res = await request(app)
        .post("/api/search")
        .set("Authorization", "Bearer test-api-key")
        .send({
          query: "how does auth work",
          projectId: project.id,
        });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("results");
    });
  });

  it("POST /search/feedback updates interaction", async () => {
    await withRollback(async () => {
      const project = await ProjectFactory.create();
      const l2 = await L2NodeFactory.create({ projectId: project.id });
      const l3 = await L3NodeFactory.create({ projectId: project.id, l2NodeId: l2.id });

      const resL2 = await request(app)
        .post("/api/search/feedback")
        .set("Authorization", "Bearer test-api-key")
        .send({
          nodeId: l2.id,
          nodeLayer: "l2",
          interactionType: "click",
        });
      expect(resL2.status).toBe(200);

      const resL3 = await request(app)
        .post("/api/search/feedback")
        .set("Authorization", "Bearer test-api-key")
        .send({
          nodeId: l3.id,
          nodeLayer: "l3",
          interactionType: "click",
        });
      expect(resL3.status).toBe(200);

      const resFail = await request(app)
        .post("/api/search/feedback")
        .set("Authorization", "Bearer test-api-key")
        .send({
          nodeId: -1,
          nodeLayer: "invalid",
        });
      expect(resFail.status).toBe(400);
    });
  });
});
