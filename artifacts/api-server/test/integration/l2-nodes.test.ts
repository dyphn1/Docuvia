import request from "supertest";
import { describe, expect, it } from "vitest";
import app from "../../src/app";
import { withRollback } from "../support/db";
import { ProjectFactory, L2NodeFactory } from "../support/factories";
import path from "path";
import fsUtils from "fs/promises";
import os from "os";
import { db } from "@workspace/db";
import { l1TagsTable } from "@workspace/db";

describe("L2 Nodes API", () => {
  it("CRUD operations for L2 Nodes", async () => {
    await withRollback(async () => {
      const project = await ProjectFactory.create();
      
      const [l1Tag] = await db.insert(l1TagsTable).values({ name: "t1", category: "arch", description: "desc" }).returning();

      // Create with L1 tag
      const resCreate = await request(app)
        .post("/api/l2-nodes")
        .set("Authorization", "Bearer test-api-key")
        .send({
          projectId: project.id,
          name: "Auth Module",
          type: "module",
          description: "Handles authentication",
          l1TagIds: [l1Tag.id]
        });
      expect(resCreate.status).toBe(201);
      const nodeId = resCreate.body.id;

      // Patch with L1 tag
      const resPatch = await request(app)
        .patch(`/api/l2-nodes/${nodeId}`)
        .set("Authorization", "Bearer test-api-key")
        .send({
          name: "Auth Module Updated",
          l1TagIds: []
        });
      expect(resPatch.status).toBe(200);
      expect(resPatch.body.name).toBe("Auth Module Updated");

      // Links POST
      const node2 = await L2NodeFactory.create({ projectId: project.id });
      const resLinkPost = await request(app)
        .post(`/api/l2-nodes/${nodeId}/links`)
        .set("Authorization", "Bearer test-api-key")
        .send({
          targetNodeId: node2.id,
          linkType: "depends_on"
        });
      expect(resLinkPost.status).toBe(201);
      const linkId = resLinkPost.body.id;

      // Links GET
      const resLinks = await request(app)
        .get(`/api/l2-nodes/${nodeId}/links`)
        .set("Authorization", "Bearer test-api-key");
      expect(resLinks.status).toBe(200);
      expect(resLinks.body.length).toBeGreaterThan(0);

      // Delete
      const resDelete = await request(app)
        .delete(`/api/l2-nodes/${nodeId}`)
        .set("Authorization", "Bearer test-api-key");
      expect(resDelete.status).toBe(204);
    });
  });

  it("POST /projects/:id/l2-nodes/confirm-bootstrap", async () => {
    await withRollback(async () => {
      const tempDir = await fsUtils.mkdtemp(path.join(os.tmpdir(), "docuvia-test-"));
      const project = await ProjectFactory.create({ repoUrl: tempDir });
      const l2Node1 = await L2NodeFactory.create({ projectId: project.id, isBootstrapConfirmed: false });
      const l2Node2 = await L2NodeFactory.create({ projectId: project.id, isBootstrapConfirmed: false });

      const res = await request(app)
        .post(`/api/projects/${project.id}/l2-nodes/confirm-bootstrap`)
        .set("Authorization", "Bearer test-api-key")
        .send({
          approvedModules: [{ id: l2Node1.id, pathPatterns: ["src/**/*"] }],
          rejectedModuleIds: [l2Node2.id]
        });
        
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      
      const configYaml = await fsUtils.readFile(path.join(tempDir, ".docuvia", "config.yaml"), "utf-8");
      expect(configYaml).toContain("src/**/*");
    });
  });
});