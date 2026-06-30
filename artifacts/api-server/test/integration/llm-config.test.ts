import { describe, it, expect, vi } from "vitest";
import request from "supertest";
import app from "../../src/app.js";
import { ProjectFactory } from "../support/factories.js";
import { withRollback } from "../support/db.js";

vi.mock("../../src/middlewares/auth.js", () => ({
  requireApiKey: (req, res, next) => next(),
}));

describe("LLM Config API", () => {
  it("GET and PATCH llm-config", () => withRollback(async () => {
    const project = await ProjectFactory.create();

    const getRes = await request(app).get(`/api/projects/${project.id}/llm-config`);
    expect(getRes.status).toBe(200);
    expect(getRes.body.model).toBe("gpt-5.2");

    const patchRes = await request(app)
      .patch(`/api/projects/${project.id}/llm-config`)
      .send({ model: "gpt-4" });
    expect(patchRes.status).toBe(200);
    expect(patchRes.body.model).toBe("gpt-4");
  }));
});