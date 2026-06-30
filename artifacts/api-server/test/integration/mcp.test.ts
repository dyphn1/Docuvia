import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import app from "../../src/app.js";
import { ProjectFactory } from "../support/factories.js";
import { withRollback } from "../support/db.js";
import crypto from "crypto";

vi.mock("@workspace/core", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    ProjectService: {
      listProjects: vi.fn().mockResolvedValue([])
    },
    DependencyService: {
      getDependencies: vi.fn().mockResolvedValue({})
    },
    ImpactAnalysisService: {
      analyzeImpact: vi.fn().mockResolvedValue({})
    },
    DecisionRecordService: {
      getDecisionRecord: vi.fn().mockResolvedValue({})
    },
    routeQuery: vi.fn().mockResolvedValue({ results: [] })
  };
});

describe("MCP API", () => {

  it("GET /api/mcp/read_shared_memory", () => withRollback(async () => {
    const res = await request(app).get("/api/mcp/read_shared_memory").set(authHeaders);
    expect(res.status).toBe(200);
  }));

  it("GET /api/mcp/retrieve_original", () => withRollback(async () => {
    const res = await request(app).get("/api/mcp/retrieve_original?id=123").set(authHeaders);
    expect(res.status).toBe(404); // Not found because it doesn't exist
  }));

  beforeEach(() => {
    process.env.MCP_PAT = "test-token";
  });

  const authHeaders = { Authorization: "Bearer test-token" };

  it("GET /api/mcp/list_projects", () => withRollback(async () => {
    const res = await request(app).get("/api/mcp/list_projects").set(authHeaders);
    expect(res.status).toBe(200);
  }));

  it("GET /api/mcp/search_knowledge", () => withRollback(async () => {
    const res = await request(app).get("/api/mcp/search_knowledge?query=test").set(authHeaders);
    expect(res.status).toBe(200);
  }));

  it("GET /api/mcp/get_dependencies", () => withRollback(async () => {
    const res = await request(app).get("/api/mcp/get_dependencies?module=test&project_id=1").set(authHeaders);
    expect(res.status).toBe(200);
  }));

  it("GET /api/mcp/impact_analysis", () => withRollback(async () => {
    const res = await request(app).get("/api/mcp/impact_analysis?module=test&project_id=1").set(authHeaders);
    expect(res.status).toBe(200);
  }));

  it("GET /api/mcp/get_decision_record", () => withRollback(async () => {
    const res = await request(app).get("/api/mcp/get_decision_record?commit_hash=abc").set(authHeaders);
    expect(res.status).toBe(200);
  }));

  it("POST /api/mcp/query", () => withRollback(async () => {
    const res = await request(app).post("/api/mcp/query").set(authHeaders).send({ q: "test" });
    expect(res.status).toBe(200);
  }));

  it("GET /api/mcp/tools", () => withRollback(async () => {
    const res = await request(app).get("/api/mcp/tools").set(authHeaders);
    expect(res.status).toBe(200);
  }));
});