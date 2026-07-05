import { describe, it, expect } from "vitest";
import request from "supertest";
import app from "../../src/app.js";
import { ProjectFactory } from "@workspace/test-utils";
import { db } from "@workspace/db";
import { notificationsTable } from "@workspace/db";
import { withRollback } from "@workspace/test-utils";

describe("Notifications API", () => {
  it("operations for notifications", () =>
    withRollback(async () => {
      const project = await ProjectFactory.create();

      const [notif] = await db
        .insert(notificationsTable)
        .values({
          projectId: project.id,
          title: "Test notification",
          body: "Testing",
          type: "system",
          read: false,
        })
        .returning();

      const listRes = await request(app)
        .get(`/api/projects/${project.id}/notifications`)
        .set("Authorization", "Bearer test-api-key");
      expect(listRes.status).toBe(200);
      expect(listRes.body.items).toHaveLength(1);

      const readRes = await request(app)
        .patch(`/api/notifications/${notif.id}/read`)
        .set("Authorization", "Bearer test-api-key");
      expect(readRes.status).toBe(200);
      expect(readRes.body.read).toBe(true);

      await db.insert(notificationsTable).values({
        projectId: project.id,
        title: "Test 2",
        body: "Testing",
        type: "system",
        read: false,
      });

      const readAllRes = await request(app)
        .post("/api/notifications/mark-all-read")
        .set("Authorization", "Bearer test-api-key")
        .send({ projectId: project.id });
      expect(readAllRes.status).toBe(200);
      expect(readAllRes.body.updated).toBe(1);
    }));
});
