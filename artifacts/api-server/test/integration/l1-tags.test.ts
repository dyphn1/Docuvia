import request from "supertest";
import { describe, expect, it } from "vitest";
import app from "../../src/app";
import { withRollback } from "@workspace/test-utils";

describe("L1 Tags API", () => {
  it("CRUD operations for L1 Tags", async () => {
    await withRollback(async () => {
      // Create
      const resCreate = await request(app)
        .post("/api/l1-tags")
        .set("Authorization", "Bearer test-api-key")
        .send({
          name: "Architecture",
          category: "general",
          description: "System architecture docs",
        });
      expect(resCreate.status).toBe(201);
      const tagId = resCreate.body.id;

      // Get
      const resGet = await request(app)
        .get("/api/l1-tags")
        .set("Authorization", "Bearer test-api-key");
      expect(resGet.status).toBe(200);
      expect(Array.isArray(resGet.body)).toBe(true);

      // Patch
      const resPatch = await request(app)
        .patch(`/api/l1-tags/${tagId}`)
        .set("Authorization", "Bearer test-api-key")
        .send({
          name: "Arch Updated",
        });
      expect(resPatch.status).toBe(200);
      expect(resPatch.body.name).toBe("Arch Updated");

      // Delete
      const resDelete = await request(app)
        .delete(`/api/l1-tags/${tagId}`)
        .set("Authorization", "Bearer test-api-key");
      expect(resDelete.status).toBe(204);
    });
  });
});
