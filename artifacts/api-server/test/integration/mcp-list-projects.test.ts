import request from "supertest";
import { describe, expect, it } from "vitest";
import app from "../../src/app";
import { L2NodeFactory, L3NodeFactory, ProjectFactory } from "../support/factories";
import { withRollback } from "../support/db";

describe("GET /api/mcp/list_projects", () => {
  it("returns projects sorted by name with L2 and L3 counts", async () => {
    await withRollback(async () => {
      const zeta = await ProjectFactory.create({
        name: "Zeta",
        repoUrl: "https://github.com/acme/zeta",
      });
      const alpha = await ProjectFactory.create({
        name: "Alpha",
        repoUrl: "https://github.com/acme/alpha",
      });

      const alphaApi = await L2NodeFactory.create({ projectId: alpha.id, name: "api-server" });
      const alphaUi = await L2NodeFactory.create({ projectId: alpha.id, name: "kg-engine" });
      await L3NodeFactory.create({ l2NodeId: alphaApi.id, title: "API decision" });
      await L3NodeFactory.create({ l2NodeId: alphaUi.id, title: "UI decision" });
      await L3NodeFactory.create({ l2NodeId: alphaUi.id, title: "UI rule" });

      const zetaModule = await L2NodeFactory.create({ projectId: zeta.id, name: "ingestion" });
      await L3NodeFactory.create({ l2NodeId: zetaModule.id, title: "Ingestion decision" });

      const response = await request(app)
        .get("/api/mcp/list_projects")
        .set("Authorization", "Bearer test-mcp-token")
        .expect(200);

      expect(response.body).toEqual({
        projects: [
          {
            id: alpha.id,
            name: "Alpha",
            repoUrl: "https://github.com/acme/alpha",
            l2Count: 2,
            l3Count: 3,
          },
          {
            id: zeta.id,
            name: "Zeta",
            repoUrl: "https://github.com/acme/zeta",
            l2Count: 1,
            l3Count: 1,
          },
        ],
      });
    });
  });
});
