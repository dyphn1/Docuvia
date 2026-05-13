import request from "supertest";
import app from "../src/app";
import { vi, describe, it, expect, beforeEach } from "vitest";

// Mock the service layer so tests don't require a real DB or OpenAI
vi.mock("../src/lib/extensions-service.js", () => {
  return {
    vscodeQuery: vi.fn(async (q: string, projectId?: number, limit = 10) => ({
      query: q,
      routingStrategy: "vector_search",
      entities: { searchQuery: q },
      results: [
        {
          source: "vector",
          nodeLayer: "l2",
          id: 1,
          title: "example-module",
          content: null,
          projectId: projectId ?? null,
          projectName: "example",
          score: 0.95,
          createdAt: new Date().toISOString(),
        },
      ],
      metadata: { classificationConfidence: 0.9, reasoning: "mocked", durationMs: 5 },
    })),
    createL3Decision: vi.fn(async (payload: any) => ({
      id: 123,
      l2NodeId: payload.l2NodeId ?? null,
      title: payload.l3Node?.title ?? "ok",
      content: payload.l3Node?.content ?? null,
      nodeType: payload.l3Node?.nodeType ?? "decision",
      createdAt: new Date().toISOString(),
    })),
    getFileContext: vi.fn(async (path: string, projectId?: number) => {
      if (path === "missing") return { path, projectId: projectId ?? null, l2Nodes: [], l3Nodes: [], sources: [] };
      return {
        path,
        projectId: projectId ?? null,
        l2Nodes: [
          { id: 1, projectId: projectId ?? 1, name: "module-a", createdAt: new Date().toISOString() },
        ],
        l3Nodes: [
          { id: 11, l2NodeId: 1, title: "decision A", createdAt: new Date().toISOString() },
        ],
        sources: [],
      };
    }),
  };
});

describe("VSCode extension endpoints", () => {
  it("POST /api/extensions/vscode/create-decision should create L3 and return 201", async () => {
    const payload = {
      projectId: 1,
      l2NodeId: 1,
      filePath: "src/foo.ts",
      agreeToLinkSource: true,
      l3Node: { title: "Decision from VSCode", content: "We should do X" },
    };

    const res = await request(app).post("/api/extensions/vscode/create-decision").send(payload);
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty("id");
    expect(res.body.title).toBe(payload.l3Node.title);
  });

  it("POST /api/extensions/vscode/query should return results array", async () => {
    const payload = { q: "auth module", limit: 5 };
    const res = await request(app).post("/api/extensions/vscode/query").send(payload);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.results)).toBe(true);
    expect(res.body.results[0]).toHaveProperty("source");
  });

  it("GET /api/extensions/vscode/file-context should return 200 for existing, 404 for missing", async () => {
    const ok = await request(app).get("/api/extensions/vscode/file-context").query({ path: "src/foo.ts" });
    expect(ok.status).toBe(200);
    expect(Array.isArray(ok.body.l2Nodes)).toBe(true);

    const missing = await request(app).get("/api/extensions/vscode/file-context").query({ path: "missing" });
    expect(missing.status).toBe(404);
  });
});
