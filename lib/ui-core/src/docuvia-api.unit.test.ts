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

  it("passes llmApiKey through as an explicit argument instead of reading it from docuviaMemory (issue #109)", async () => {
    const { docuviaApi } = await import("./docuvia-api.js");
    docuviaMemory.set(scopeId, MemoryKeys.TARGET_PATH, "sample.ts");
    docuviaMemory.set(
      scopeId,
      MemoryKeys.LLM_BASE_URL,
      "http://localhost:8317",
    );
    docuviaMemory.set(scopeId, MemoryKeys.LLM_MODEL, "big-model");

    await docuviaApi.analyze(scopeId, createMockLogger(), "secret-key");

    expect(AnalyzeWorkflowMock).toHaveBeenCalledWith(
      "/workspace",
      expect.anything(),
      {
        targetPath: "sample.ts",
        llmBaseUrl: "http://localhost:8317",
        llmApiKey: "secret-key",
        llmModel: "big-model",
      },
    );
    expect(docuviaMemory.get(scopeId, "llmApiKey" as never)).toBeUndefined();
  });

  it("constructs AnalyzeWorkflow with { flushStagedL3: true } and checks it before TARGET_PATH/AGENT_AUTHORED_DECISIONS/ESCALATE_TO_LSP (issue #42 §8.2)", async () => {
    const { docuviaApi } = await import("./docuvia-api.js");
    docuviaMemory.set(scopeId, MemoryKeys.FLUSH_STAGED_L3, true);

    await docuviaApi.analyze(scopeId, createMockLogger());

    expect(AnalyzeWorkflowMock).toHaveBeenCalledWith(
      "/workspace",
      expect.anything(),
      { flushStagedL3: true },
    );
  });
});

describe("docuviaApi.stageAgentAuthoredDecisions() -- input-time target existence guard (issue #53 finding 3)", () => {
  let scopeId: string;

  beforeEach(() => {
    scopeId = crypto.randomUUID();
    docuviaMemory.createScope(scopeId);
    docuviaMemory.set(scopeId, MemoryKeys.WORKSPACE_ROOT, "/workspace");
  });

  afterEach(() => {
    docuviaMemory.deleteScope(scopeId);
  });

  it("throws FS_READ_FAILED for a nonexistent target instead of leaving an entry pending", async () => {
    const { docuviaApi } = await import("./docuvia-api.js");
    const { ErrorCodes } = await import("@workspace/contracts");
    docuviaMemory.set(scopeId, MemoryKeys.TARGET_PATH, "does-not-exist.ts");
    docuviaMemory.set(scopeId, MemoryKeys.AGENT_AUTHORED_DECISIONS, [
      {
        title: "x",
        content: "y",
        nodeType: "rule",
        confidence: 0.5,
      },
    ]);

    await expect(
      docuviaApi.stageAgentAuthoredDecisions(scopeId, createMockLogger()),
    ).rejects.toThrowError(
      expect.objectContaining({
        code: ErrorCodes.FS_READ_FAILED,
      }),
    );
  });
});
