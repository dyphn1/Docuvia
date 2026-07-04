import request from "supertest";
import { describe, expect, it } from "vitest";
import app from "../../src/app";
import { withRollback } from "@workspace/test-utils";

describe("Projects API", () => {
  it("GET /api/projects returns a list of projects", async () => {
    await withRollback(async () => {
      const response = await request(app)
        .get("/api/projects")
        .set("Authorization", "Bearer test-api-key");
      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
    });
  });

  it("POST /api/projects creates a new project and GET/PATCH/DELETE works", async () => {
    await withRollback(async () => {
      // Create
      const resCreate = await request(app)
        .post("/api/projects")
        .set("Authorization", "Bearer test-api-key")
        .send({
          name: "Test Project",
          repoUrl: "https://github.com/test/repo",
          description: "Test description",
        });
      expect(resCreate.status).toBe(201);
      const projectId = resCreate.body.id;

      // Get
      const resGet = await request(app)
        .get(`/api/projects/${projectId}`)
        .set("Authorization", "Bearer test-api-key");
      expect(resGet.status).toBe(200);
      expect(resGet.body.name).toBe("Test Project");

      // Patch
      const resPatch = await request(app)
        .patch(`/api/projects/${projectId}`)
        .set("Authorization", "Bearer test-api-key")
        .send({
          name: "Updated Project",
        });
      expect(resPatch.status).toBe(200);
      expect(resPatch.body.name).toBe("Updated Project");

      // GET graph
      const resGraph = await request(app)
        .get(`/api/projects/${projectId}/graph`)
        .set("Authorization", "Bearer test-api-key");
      expect(resGraph.status).toBe(200);

      // GET commits
      const resCommits = await request(app)
        .get(`/api/projects/${projectId}/commits`)
        .set("Authorization", "Bearer test-api-key");
      expect(resCommits.status).toBe(200);

      // POST commits
      const resPostCommits = await request(app)
        .post(`/api/projects/${projectId}/commits`)
        .set("Authorization", "Bearer test-api-key")
        .send({
          hash: "abc1234",
          message: "test commit",
          author: "Author",
        });
      expect(resPostCommits.status).toBe(201);

      // GET l2-nodes
      const resL2 = await request(app)
        .get(`/api/projects/${projectId}/l2-nodes`)
        .set("Authorization", "Bearer test-api-key");
      expect(resL2.status).toBe(200);

      // POST sync
      // It might require mocking or trigger external calls, so we mock or skip or test the error
      // We will skip full sync here and just do delete

      // Delete
      const resDelete = await request(app)
        .delete(`/api/projects/${projectId}`)
        .set("Authorization", "Bearer test-api-key");
      expect(resDelete.status).toBe(204);

      const resGetAfterDelete = await request(app)
        .get(`/api/projects/${projectId}`)
        .set("Authorization", "Bearer test-api-key");
      expect(resGetAfterDelete.status).toBe(404);
    });
  });
});
