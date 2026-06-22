import request from "supertest";
import { describe, expect, it } from "vitest";
import app from "../../src/app";
import { ProjectFactory, CommitFactory } from "../support/factories";
import { withRollback } from "../support/db";
import { db, projectsTable, l1TagsTable, l2NodesTable, l3NodesTable } from "@workspace/db";
import { eq } from "drizzle-orm";

describe("POST /api/projects/:id/generate", () => {
  it("processes commits and generates L1, L2, L3 nodes handling fuzzy LLM responses", async () => {
    await withRollback(async () => {
      const project = await ProjectFactory.create({ status: "active" });

      await CommitFactory.create(project.id, {
        hash: "1234567890abcdef",
        message: "feat: add module1",
        valid: true,
      });
      await CommitFactory.create(project.id, {
        hash: "abcdef1234567890",
        message: "fix: update module1",
        valid: true,
      });

      const response = await request(app)
        .post(`/api/projects/${project.id}/generate`)
        .send({ maxCommits: 50, mode: "full" })
        .expect(200);

      expect(response.body).toMatchObject({
        l1TagsCreated: 1,
        l2NodesCreated: 1,
        l3NodesCreated: 1,
        commitsProcessed: 2,
      });

      const [updatedProject] = await db
        .select()
        .from(projectsTable)
        .where(eq(projectsTable.id, project.id));
      expect(updatedProject.status).toBe("active");

      const l1Tags = await db.select().from(l1TagsTable);
      expect(l1Tags.some((t) => t.name === "tag1")).toBe(true);

      const l2Nodes = await db
        .select()
        .from(l2NodesTable)
        .where(eq(l2NodesTable.projectId, project.id));
      expect(l2Nodes.some((n) => n.name === "module1")).toBe(true);

      const l3Nodes = await db.select().from(l3NodesTable);
      expect(l3Nodes.some((n) => n.title === "rule1")).toBe(true);
    });
  });
});
