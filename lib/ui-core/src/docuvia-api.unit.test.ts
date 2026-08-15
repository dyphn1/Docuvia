import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import crypto from "node:crypto";
import {
  docuviaMemory,
  MemoryKeys,
  createMockLogger,
} from "@workspace/contracts";

// Isolates docuviaApi.analyze()'s own memory-key dispatch logic (issue #42's new pre-LLM-branch
// check) from AnalyzeWorkflow's real (heavier) implementation, already covered by
// analyze-workflow.unit.test.ts's own dispatch-order regression test.
const executeMock = vi.fn().mockResolvedValue({
  kind: "decisionExtraction",
  targetPath: "sample.ts",
  decisions: [],
  persisted: 0,
  deduped: 0,
});
const AnalyzeWorkflowMock = vi.fn().mockImplementation(() => ({
  execute: executeMock,
}));
vi.mock("./workflows/analyze/analyze-workflow.js", () => ({
  AnalyzeWorkflow: AnalyzeWorkflowMock,
}));

describe("docuviaApi.analyze() -- agent-authored pre-LLM-branch dispatch (issue #42)", () => {
  let scopeId: string;

  beforeEach(() => {
    scopeId = crypto.randomUUID();
    docuviaMemory.createScope(scopeId);
    docuviaMemory.set(scopeId, MemoryKeys.WORKSPACE_ROOT, "/workspace");
    AnalyzeWorkflowMock.mockClear();
    executeMock.mockClear();
  });

  afterEach(() => {
    docuviaMemory.deleteScope(scopeId);
  });

  it("constructs AnalyzeWorkflow with { targetPath, agentAuthoredDecisions } and never requires LLM_BASE_URL/LLM_MODEL when both TARGET_PATH and AGENT_AUTHORED_DECISIONS are set", async () => {
    const { docuviaApi } = await import("./docuvia-api.js");
    const decisions = [
      {
        title: "Agent-authored decision",
        nodeType: "decision" as const,
        content: "Written verbatim, no LLM call.",
        confidence: 0.9,
      },
    ];
    docuviaMemory.set(scopeId, MemoryKeys.TARGET_PATH, "sample.ts");
    docuviaMemory.set(scopeId, MemoryKeys.AGENT_AUTHORED_DECISIONS, decisions);

    await docuviaApi.analyze(scopeId, createMockLogger());

    expect(AnalyzeWorkflowMock).toHaveBeenCalledWith(
      "/workspace",
      expect.anything(),
      { targetPath: "sample.ts", agentAuthoredDecisions: decisions },
    );
  });

  it("falls through to the LLM-config branch (unchanged) when TARGET_PATH is set but AGENT_AUTHORED_DECISIONS is not", async () => {
    const { docuviaApi } = await import("./docuvia-api.js");
    docuviaMemory.set(scopeId, MemoryKeys.TARGET_PATH, "sample.ts");

    await expect(
      docuviaApi.analyze(scopeId, createMockLogger()),
    ).rejects.toThrow();
    expect(AnalyzeWorkflowMock).not.toHaveBeenCalled();
  });
});
