import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  docuviaMemory,
  ErrorCodes,
  MemoryKeys,
  createMockLogger,
} from "@workspace/contracts";

// TDD-SOURCE: docs/gitbook/architecture/application-lifecycle-and-state.md#2-roles--state-management-boundaries
// TDD-SOURCE: docs/gitbook/architecture/virtual-contracts-architecture.md
// TDD-SOURCE: lib/ui-core/src/docuvia-api.ts#docuviaApi

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

  it("fails with INVALID_INPUT before constructing a workflow when WORKSPACE_ROOT is missing", async () => {
    const { docuviaApi } = await import("./docuvia-api.js");
    docuviaMemory.deleteScope(scopeId);
    docuviaMemory.createScope(scopeId);

    await expect(
      docuviaApi.analyze(scopeId, createMockLogger()),
    ).rejects.toMatchObject({
      code: ErrorCodes.INVALID_INPUT,
      message: expect.stringContaining(MemoryKeys.WORKSPACE_ROOT),
    });
    expect(AnalyzeWorkflowMock).not.toHaveBeenCalled();
  });

  it("returns equivalent results and workflow options across repeated identical dispatch", async () => {
    const { docuviaApi } = await import("./docuvia-api.js");
    const decisions = [
      {
        title: "Stable decision",
        nodeType: "decision" as const,
        content: "same input",
        confidence: 0.8,
      },
    ];
    docuviaMemory.set(scopeId, MemoryKeys.TARGET_PATH, "sample.ts");
    docuviaMemory.set(scopeId, MemoryKeys.AGENT_AUTHORED_DECISIONS, decisions);

    const first = await docuviaApi.analyze(scopeId, createMockLogger());
    const firstOptions = AnalyzeWorkflowMock.mock.calls[0]?.[2];
    const second = await docuviaApi.analyze(scopeId, createMockLogger());
    const secondOptions = AnalyzeWorkflowMock.mock.calls[1]?.[2];

    expect(second).toEqual(first);
    expect(secondOptions).toEqual(firstOptions);
    expect(first).toEqual({
      kind: "decisionExtraction",
      targetPath: "sample.ts",
      decisions: [],
      persisted: 0,
      deduped: 0,
    });
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

  it("[invalid-input] rejects an existing absolute target outside WORKSPACE_ROOT before staging (#471)", async () => {
    const { docuviaApi } = await import("./docuvia-api.js");
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "docuvia-stage-workspace-"),
    );
    const outsideRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "docuvia-stage-outside-"),
    );
    const outsideFile = path.join(outsideRoot, "outside.ts");
    fs.writeFileSync(outsideFile, "export const outside = true;\n");

    try {
      docuviaMemory.set(scopeId, MemoryKeys.WORKSPACE_ROOT, workspaceRoot);
      docuviaMemory.set(scopeId, MemoryKeys.TARGET_PATH, outsideFile);
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
      ).rejects.toMatchObject({
        code: ErrorCodes.INVALID_INPUT,
      });
      expect(
        fs.existsSync(
          path.join(
            workspaceRoot,
            ".docuvia",
            "pending-l3-decisions.json",
          ),
        ),
      ).toBe(false);
    } finally {
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
      fs.rmSync(outsideRoot, { recursive: true, force: true });
    }
  });
});
