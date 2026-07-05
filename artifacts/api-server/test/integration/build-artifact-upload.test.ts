import request from "supertest";
import { describe, expect, it } from "vitest";
import app from "../../src/app";
import { withRollback } from "@workspace/test-utils";
import { ProjectFactory } from "@workspace/test-utils";

describe("POST /api/projects/:id/ingest/build-artifact", () => {
  it("ingests build artifact uploads from the in-memory buffer", async () => {
    await withRollback(async () => {
      const project = await ProjectFactory.create({
        name: "Build Artifacts",
        repoUrl: "https://github.com/acme/build-artifacts",
      });

      const payload = Buffer.from("build started\n\x1b[32mfinished\x1b[0m\n");
      const response = await request(app)
        .post(`/api/projects/${project.id}/ingest/build-artifact`)
        .set("Authorization", "Bearer test-api-key")
        .attach("file", payload, {
          filename: "build.log",
          contentType: "application/octet-stream",
        })
        .expect(200);

      expect(response.body.ingested).toBe(1);
      expect(response.body.errors).toEqual([]);
    });
  });
});
