import { describe, it, expect, vi, afterEach } from "vitest";
import { docuviaMemory } from "@workspace/contracts";
import { docuviaApi } from "@workspace/ui-core";
import { impactTool } from "../../../../src/mcp/tools/impact.js";
import { statusTool } from "../../../../src/mcp/tools/status.js";
import { detectChangesTool } from "../../../../src/mcp/tools/detect-changes.js";

vi.mock("@workspace/ui-core", () => ({
  docuviaApi: {
    impact: vi.fn(),
    status: vi.fn(),
    review: vi.fn(),
  },
}));

const mockImpact = vi.mocked(docuviaApi.impact);
const mockStatus = vi.mocked(docuviaApi.status);
const mockReview = vi.mocked(docuviaApi.review);

vi.mock("../../../../src/logging/create-logger.js", () => ({
  createPinoBackedLogger: () => ({ onLog: vi.fn() }),
}));

describe("docuvia_impact MCP tool", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    mockImpact.mockReset();
  });

  it("returns the ImpactResult JSON for a resolved target", async () => {
    mockImpact.mockResolvedValue({
      target: "authService",
      blastRadius: [{ name: "loginRoute", type: "route" }],
      riskLevel: "high",
    });

    const response = await impactTool.handler({ target: "authService" });

    expect(response.isError).toBeUndefined();
    expect(JSON.parse(response.content[0].text)).toMatchObject({
      target: "authService",
      riskLevel: "high",
    });
    expect(response.content).toHaveLength(1);
  });

  it("returns literal null (not isError) with a resolution hint when the target is unknown", async () => {
    mockImpact.mockResolvedValue(null);

    const response = await impactTool.handler({ target: "ghost" });

    expect(response.isError).toBeUndefined();
    expect(response.content[0].text).toBe("null");
    expect(response.content[1].text).toContain("unknown");
  });

  it("appends an incompleteness hint when the blast radius is empty and coverage is partial", async () => {
    mockImpact.mockResolvedValue({
      target: "authService",
      blastRadius: [],
      riskLevel: "low",
      tierBCoverage: {
        workspaceFilesProcessed: 3,
        workspaceFilesTotal: 10,
        ownFileLastProcessedAt: "2026-08-23T00:00:00.000Z",
      },
    });

    const response = await impactTool.handler({ target: "authService" });

    expect(response.content).toHaveLength(2);
    expect(response.content[1].text).toContain("incomplete");
  });

  it("deletes the memory scope when the workflow rejects", async () => {
    const realDeleteScope = docuviaMemory.deleteScope.bind(docuviaMemory);
    const deleteSpy = vi
      .spyOn(docuviaMemory, "deleteScope")
      .mockImplementation(realDeleteScope);
    mockImpact.mockRejectedValue(new Error("boom"));

    const response = await impactTool.handler({ target: "x" });

    expect(response.isError).toBe(true);
    expect(deleteSpy).toHaveBeenCalled();
  });

  it("rejects a missing target via the strict schema", async () => {
    const response = await impactTool.handler({});
    expect(response.isError).toBe(true);
  });
});

describe("docuvia_status MCP tool", () => {
  afterEach(() => {
    mockStatus.mockReset();
  });

  it("serializes StatusResult with a derived Tier B coverage percentage", async () => {
    mockStatus.mockResolvedValue({
      projects: 1,
      l2Nodes: 42,
      l3Nodes: 7,
      tierBFilesProcessed: 9,
      tierBFilesTotal: 12,
      tierCQueued: 0,
    });

    const response = await statusTool.handler({});

    expect(response.isError).toBeUndefined();
    expect(JSON.parse(response.content[0].text)).toEqual({
      projects: 1,
      l2Nodes: 42,
      l3Nodes: 7,
      tierBFilesProcessed: 9,
      tierBFilesTotal: 12,
      tierCQueued: 0,
      tierBCoveragePct: 75,
    });
  });

  it("reports 0% coverage on an empty graph", async () => {
    mockStatus.mockResolvedValue({
      projects: 0,
      l2Nodes: 0,
      l3Nodes: 0,
      tierBFilesProcessed: 0,
      tierBFilesTotal: 0,
      tierCQueued: 0,
    });

    const response = await statusTool.handler({});

    expect(JSON.parse(response.content[0].text).tierBCoveragePct).toBe(0);
  });

  it("rejects extra fields via the strict schema", async () => {
    const response = await statusTool.handler({ target: "x" });
    expect(response.isError).toBe(true);
  });
});

describe("docuvia_detect_changes MCP tool", () => {
  afterEach(() => {
    mockReview.mockReset();
  });

  it("passes baseRef through and returns the ChangeDetectionResult JSON plus a next-step hint", async () => {
    let capturedBaseRef: string | undefined;
    const realSet = docuviaMemory.set.bind(docuviaMemory);
    vi.spyOn(docuviaMemory, "set").mockImplementation((id, key, value) => {
      realSet(id, key, value);
      if (key === "baseRef") capturedBaseRef = value;
    });
    mockReview.mockResolvedValue({
      baseRef: "main",
      filesChanged: ["src/a.ts"],
      affectedNodes: [],
      riskLevel: "medium",
      analysis: "touches auth module",
    });

    const response = await detectChangesTool.handler({ baseRef: "main" });

    expect(capturedBaseRef).toBe("main");
    expect(response.isError).toBeUndefined();
    expect(JSON.parse(response.content[0].text)).toMatchObject({
      riskLevel: "medium",
    });
    expect(response.content[1].text).toContain("docuvia_impact");
  });

  it("omits the BASE_REF key when no baseRef is provided", async () => {
    const realGet = docuviaMemory.get.bind(docuviaMemory);
    let sawBaseRef = false;
    vi.spyOn(docuviaMemory, "get").mockImplementation((id, key) => {
      if (key === "baseRef") sawBaseRef = true;
      return realGet(id, key);
    });
    mockReview.mockResolvedValue({
      filesChanged: [],
      affectedNodes: [],
      riskLevel: "low",
      analysis: "",
    });

    await detectChangesTool.handler({});

    expect(sawBaseRef).toBe(false);
  });
});
