import { describe, it, expect } from "vitest";
import request from "supertest";
import app from "../../src/app.js";
import { ProjectFactory } from "../support/factories.js";
import { withRollback } from "../support/db.js";

describe("Subscriptions API", () => {
  it("CRUD operations for subscriptions", () => withRollback(async () => {
    const subscriber = await ProjectFactory.create();
    const publisher = await ProjectFactory.create();

    const createRes = await request(app)
      .post("/api/subscriptions")
      .send({
        subscriberProjectId: subscriber.id,
        publisherProjectId: publisher.id
      });
    expect(createRes.status).toBe(201);
    const subId = createRes.body.id;

    const listRes = await request(app).get(`/api/projects/${subscriber.id}/subscriptions`);
    expect(listRes.status).toBe(200);
    expect(listRes.body.subscriptions).toHaveLength(1);

    const deleteRes = await request(app).delete(`/api/subscriptions/${subId}`);
    expect(deleteRes.status).toBe(204);
  }));
});