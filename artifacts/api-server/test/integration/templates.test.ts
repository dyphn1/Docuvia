import request from "supertest";
import { describe, expect, it } from "vitest";
import app from "../../src/app";
import { withRollback } from "../support/db";
import { ProjectFactory } from "../support/factories";

describe("Templates API", () => {
  it("CRUD for templates", async () => {
    await withRollback(async () => {
      const project = await ProjectFactory.create();

      // Put
      const resPut = await request(app)
        .put(`/api/projects/${project.id}/templates/l1_tagger`)
        .set("Authorization", "Bearer test-api-key")
        .send({
          systemPrompt: "L1 Tagger Content system prompt min 10 chars",
        });
      expect(resPut.status).toBe(201);

      // Get
      const resGet = await request(app)
        .get(`/api/projects/${project.id}/templates`)
        .set("Authorization", "Bearer test-api-key");
      expect(resGet.status).toBe(200);
      expect(Array.isArray(resGet.body)).toBe(true);

      // Delete
      const resDelete = await request(app)
        .delete(`/api/projects/${project.id}/templates/l1_tagger`)
        .set("Authorization", "Bearer test-api-key");
      expect(resDelete.status).toBe(204);
    });
  });
});
