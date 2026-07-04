import { describe, it, expect } from "vitest";
import request from "supertest";
import app from "../../src/app.js";
import { ProjectFactory, CommitFactory, L2NodeFactory, L3NodeFactory } from "@workspace/test-utils";
import { db } from "@workspace/db";
import { pullRequestsTable } from "@workspace/db";
import { withRollback } from "@workspace/test-utils";

const prDefaults = {
  headSha: "head123",
  baseSha: "base123",
  author: "testuser",
  url: "https://example.com/pr",
  body: "PR body",
};

describe("Pull Requests API", () => {
  it("GET /api/projects/:id/pull-requests returns PRs", () =>
    withRollback(async () => {
      const project = await ProjectFactory.create();
      await db.insert(pullRequestsTable).values({
        projectId: project.id,
        githubPrNumber: 101,
        title: "Fix bug",
        status: "open",
        htmlUrl: "http://example.com/pr/101",
        ...prDefaults,
      });

      const res = await request(app).get(`/api/projects/${project.id}/pull-requests`);
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].title).toBe("Fix bug");
    }));

  it("GET /api/projects/:id/pull-requests/:prNumber returns details", () =>
    withRollback(async () => {
      const project = await ProjectFactory.create();
      const pr = (
        await db
          .insert(pullRequestsTable)
          .values({
            projectId: project.id,
            githubPrNumber: 102,
            title: "Feature X",
            status: "open",
            htmlUrl: "http://example.com/pr/102",
            ...prDefaults,
          })
          .returning()
      )[0];

      const commit = await CommitFactory.create({ projectId: project.id });
      const l2 = await L2NodeFactory.create({ projectId: project.id });
      await L3NodeFactory.create({ l2NodeId: l2.id, commitHash: commit.hash });

      const res = await request(app).get(`/api/projects/${project.id}/pull-requests/102`);
      expect(res.status).toBe(200);
      expect(res.body.pr.githubPrNumber).toBe(102);
      expect(res.body.commitsCount).toBe(1);
      expect(res.body.l2Nodes).toHaveLength(1);
      expect(res.body.l3Nodes).toHaveLength(1);
    }));

  it("POST /api/projects/:id/pull-requests/:prNumber/analyze triggers analysis", () =>
    withRollback(async () => {
      const project = await ProjectFactory.create();
      await db.insert(pullRequestsTable).values({
        projectId: project.id,
        githubPrNumber: 103,
        title: "Feature Y",
        status: "open",
        htmlUrl: "http://example.com/pr/103",
        ...prDefaults,
      });

      const res = await request(app).post(`/api/projects/${project.id}/pull-requests/103/analyze`);
      expect(res.status).toBe(202);
      expect(res.body.status).toBe("triggered");
    }));
});
