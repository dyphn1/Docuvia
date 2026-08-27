import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { applyDecisionTool } from "../../../src/mcp/tools/apply-decision.js";
import { docuviaApi } from "@workspace/ui-core";
import { docuviaMemory } from "@workspace/contracts";

vi.mock("@workspace/ui-core", () => ({
  docuviaApi: {
    stageAgentAuthoredDecisions: vi.fn(),
  },
}));

vi.mock("../../../src/logging/create-logger.js", () => ({
  createPinoBackedLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn().mockReturnThis(),
  })),
}));

describe("MCP applyDecision tool", () => {
  const originalCwd = process.cwd;

  beforeEach(() => {
    vi.clearAllMocks();
    process.cwd = vi.fn().mockReturnValue("/test/workspace");
  });

  afterEach(() => {
    process.cwd = originalCwd;
  });

  it("has correct tool definition", () => {
    expect(applyDecisionTool.definition.name).toBe("docuvia_apply_decision");
    expect(
      applyDecisionTool.definition.description!.length,
    ).toBeGreaterThanOrEqual(1);
    expect(applyDecisionTool.definition.inputSchema.required).toContain(
      "targetPath",
    );
    expect(applyDecisionTool.definition.inputSchema.required).toContain(
      "decisions",
    );
  });

  it("calls docuviaApi.stageAgentAuthoredDecisions with the correct args", async () => {
    vi.mocked(docuviaApi.stageAgentAuthoredDecisions).mockResolvedValue({
      staged: 2,
    });

    const response = await applyDecisionTool.handler({
      targetPath: "src/auth.ts",
      decisions: [
        {
          title: "Use optimistic locking",
          content: "Avoids holding a row lock across the LLM round-trip.",
          nodeType: "decision",
          confidence: 0.9,
        },
        {
          title: "Rate limit by IP",
          content: "Standard practice for public APIs.",
          nodeType: "rule",
          confidence: 0.85,
        },
      ],
    });

    expect(docuviaApi.stageAgentAuthoredDecisions).toHaveBeenCalledOnce();
    expect(response.isError).toBeUndefined();
    expect(response.content[0].text).toContain("2 decision(s) staged");
    expect(response.content[0].text).toContain("src/auth.ts");
  });

  it("wraps errors with error prefix", async () => {
    vi.mocked(docuviaApi.stageAgentAuthoredDecisions).mockRejectedValue(
      new Error("path not found"),
    );

    const response = await applyDecisionTool.handler({
      targetPath: "src/missing.ts",
      decisions: [
        {
          title: "Some decision",
          content: "Some content",
          nodeType: "decision",
          confidence: 0.8,
        },
      ],
    });

    expect(response.isError).toBe(true);
    expect(response.content[0].text).toContain("Error applying decision");
    expect(response.content[0].text).toContain("path not found");
  });

  it("rejects missing targetPath", async () => {
    const response = await applyDecisionTool.handler({
      decisions: [
        {
          title: "title",
          content: "content",
          nodeType: "decision",
          confidence: 0.8,
        },
      ],
    });

    expect(response.isError).toBe(true);
    expect(response.content[0].text).toContain("Error applying decision");
  });

  it("rejects empty decisions array", async () => {
    const response = await applyDecisionTool.handler({
      targetPath: "src/index.ts",
      decisions: [],
    });

    expect(response.isError).toBe(true);
    expect(response.content[0].text).toContain("Error applying decision");
  });

  it("rejects invalid nodeType", async () => {
    const response = await applyDecisionTool.handler({
      targetPath: "src/index.ts",
      decisions: [
        {
          title: "title",
          content: "content",
          nodeType: "invalid",
          confidence: 0.8,
        },
      ],
    });

    expect(response.isError).toBe(true);
  });

  it("rejects out-of-range confidence", async () => {
    const response = await applyDecisionTool.handler({
      targetPath: "src/index.ts",
      decisions: [
        {
          title: "title",
          content: "content",
          nodeType: "decision",
          confidence: 1.5,
        },
      ],
    });

    expect(response.isError).toBe(true);
  });

  it("rejects unknown extra fields (strict mode)", async () => {
    vi.mocked(docuviaApi.stageAgentAuthoredDecisions).mockResolvedValue({
      staged: 1,
    });

    const response = await applyDecisionTool.handler({
      targetPath: "src/index.ts",
      decisions: [
        {
          title: "title",
          content: "content",
          nodeType: "decision",
          confidence: 0.8,
        },
      ],
      unexpectedField: "should fail",
    });

    expect(response.isError).toBe(true);
  });
});
