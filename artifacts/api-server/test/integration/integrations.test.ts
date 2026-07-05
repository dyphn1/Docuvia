import { describe, it, expect, vi } from "vitest";
import request from "supertest";
import app from "../../src/app.js";
import { ProjectFactory } from "@workspace/test-utils";
import { withRollback } from "@workspace/test-utils";

vi.mock("@workspace/core", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    sendTestNotification: vi.fn().mockResolvedValue(true),
  };
});

describe("Integrations API", () => {
  it("CRUD operations for integrations", () =>
    withRollback(async () => {
      const project = await ProjectFactory.create();

      const createRes = await request(app)
        .post(`/api/projects/${project.id}/integrations`)
        .set("Authorization", "Bearer test-api-key")
        .send({
          integrationType: "slack",
          webhookUrl: "https://slack.com",
          notificationTypes: ["pr.merged"],
          enabled: true,
        });
      expect(createRes.status).toBe(201);
      const integrationId = createRes.body.id;

      const listRes = await request(app)
        .get(`/api/projects/${project.id}/integrations`)
        .set("Authorization", "Bearer test-api-key");
      expect(listRes.status).toBe(200);
      expect(listRes.body).toHaveLength(1);

      const updateRes = await request(app)
        .patch(`/api/integrations/${integrationId}`)
        .set("Authorization", "Bearer test-api-key")
        .send({ notificationTypes: ["pr.merged", "doc.updated"] });
      expect(updateRes.status).toBe(200);
      expect(updateRes.body.notificationTypes).toContain("doc.updated");

      const testRes = await request(app)
        .post(`/api/integrations/${integrationId}/test`)
        .set("Authorization", "Bearer test-api-key");
      expect(testRes.status).toBe(200);
      expect(testRes.body.success).toBe(true);

      const deleteRes = await request(app)
        .delete(`/api/integrations/${integrationId}`)
        .set("Authorization", "Bearer test-api-key");
      expect(deleteRes.status).toBe(204);
    }));
});
