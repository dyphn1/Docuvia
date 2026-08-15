import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import process from "process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { docuviaApi } from "@workspace/ui-core";
import { docuviaMemory } from "@workspace/contracts";
import { analyzeCommand } from "../../../src/commands/analyze.js";
import { ui } from "../../../src/ui/wizard.js";
import { UI_MESSAGES } from "../../../src/constants/ui-messages.js";
import { readStdin } from "../../../src/utils/read-stdin.js";

vi.mock("@workspace/ui-core", () => ({
  docuviaApi: { analyze: vi.fn(), checkTierBGate: vi.fn() },
}));

vi.mock("../../../src/utils/read-stdin.js", () => ({
  readStdin: vi.fn(),
}));

const spinnerSucceed = vi.fn();
const spinnerFail = vi.fn();
let lastSpinnerInstance:
  | {
      text: string;
      start: ReturnType<typeof vi.fn>;
      succeed: typeof spinnerSucceed;
      fail: typeof spinnerFail;
    }
  | undefined;

// header/info/error are referenced eagerly (as direct object properties, evaluated when the
// mocked module is first imported -- before any later top-level const in this file has
// initialized), so they must be inline vi.fn() here; assert on ui.info/ui.error directly.
// Only closures (like the object returned by spinner) can safely reference outer consts.
vi.mock("../../../src/ui/wizard.js", () => ({
  ui: {
    header: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    log: vi.fn(),
    spinner: vi.fn((text: string) => {
      lastSpinnerInstance = {
        text,
        start: vi.fn().mockReturnThis(),
        succeed: spinnerSucceed,
        fail: spinnerFail,
      };
      return lastSpinnerInstance;
    }),
  },
}));

const mockAnalyze = vi.mocked(docuviaApi.analyze);
const mockReadStdin = vi.mocked(readStdin);

const ENV_KEYS = [
  "AI_DOCUVIA_INTEGRATIONS_OPENAI_BASE_URL",
  "AI_DOCUVIA_INTEGRATIONS_OPENAI_API_KEY",
  "AI_DOCUVIA_MODEL",
  "AI_DOCUVIA_FAST_MODEL",
] as const;

describe("analyzeCommand", () => {
  let originalEnv: Record<string, string | undefined>;

  beforeEach(() => {
    originalEnv = {};
    for (const key of ENV_KEYS) {
      originalEnv[key] = process.env[key];
      delete process.env[key];
    }
    mockAnalyze.mockReset();
    mockReadStdin.mockReset();
    spinnerSucceed.mockReset();
    spinnerFail.mockReset();
    lastSpinnerInstance = undefined;
    vi.mocked(ui.info).mockReset();
    vi.mocked(ui.error).mockReset();
    vi.mocked(ui.header).mockReset();
    process.exitCode = undefined;
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (originalEnv[key] === undefined) delete process.env[key];
      else process.env[key] = originalEnv[key];
    }
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  describe("no target path (auto mode)", () => {
    it("prints projectType/suggestedTags/file summary on a full-ingestion result", async () => {
      mockAnalyze.mockResolvedValue({
        kind: "autoFullIngestion",
        projectType: "typescript",
        suggestedTags: ["typescript", "react"],
        filesRequested: 3,
        filesParsed: 3,
        filesFailed: 0,
        filesSkippedOversized: 0,
      });

      await analyzeCommand();

      expect(mockAnalyze).toHaveBeenCalled();
      expect(spinnerSucceed).toHaveBeenCalledWith(
        UI_MESSAGES.ANALYZE_AUTO_FULL_SUCCESS,
      );
      expect(ui.info).toHaveBeenCalledWith(
        expect.stringContaining("typescript"),
      );
      expect(ui.info).toHaveBeenCalledWith(
        UI_MESSAGES.ANALYZE_AUTO_FULL_SUMMARY(3, 3, 0),
      );
    });

    it("prints a re-parsed/deleted/queued summary on a delta result", async () => {
      mockAnalyze.mockResolvedValue({
        kind: "autoDelta",
        fromSha: "aaa",
        headSha: "bbb",
        filesReparsed: 2,
        filesDeleted: 1,
        filesFailed: 0,
        filesSkippedOversized: 0,
        tierBQueued: 1,
      });

      await analyzeCommand();

      expect(spinnerSucceed).toHaveBeenCalledWith(
        UI_MESSAGES.ANALYZE_AUTO_DELTA_SUCCESS,
      );
      expect(ui.info).toHaveBeenCalledWith(
        UI_MESSAGES.ANALYZE_AUTO_DELTA_SUMMARY(2, 1, 1),
      );
    });

    it("prints an up-to-date message on a noop result", async () => {
      mockAnalyze.mockResolvedValue({
        kind: "autoDeltaNoop",
        headSha: "bbb",
      });

      await analyzeCommand();

      expect(spinnerSucceed).toHaveBeenCalledWith(
        UI_MESSAGES.ANALYZE_AUTO_NOOP_SUCCESS,
      );
    });

    it("calls spinner.fail and sets process.exitCode = 1 (not process.exit()) when docuviaApi.analyze() throws", async () => {
      mockAnalyze.mockRejectedValue(new Error("boom"));

      await analyzeCommand();

      expect(spinnerFail).toHaveBeenCalledWith(expect.stringContaining("boom"));
      expect(process.exitCode).toBe(1);
    });

    it("prints a large (50-entry) suggestedTags list as a single joined ui.info call without truncation or throwing", async () => {
      const tags = Array.from({ length: 50 }, (_, i) => "tag-" + i);
      mockAnalyze.mockResolvedValue({
        kind: "autoFullIngestion",
        projectType: "generic",
        suggestedTags: tags,
        filesRequested: 0,
        filesParsed: 0,
        filesFailed: 0,
        filesSkippedOversized: 0,
      });

      await analyzeCommand();

      expect(ui.info).toHaveBeenCalledWith(
        UI_MESSAGES.ANALYZE_SUGGESTED_TAGS + tags.join(", "),
      );
    });

    it("updates spinner.text when the underlying workflow emits an info log event mid-call", async () => {
      mockAnalyze.mockImplementation(async (_scopeId, logger) => {
        logger.info("Checking knowledge graph freshness...");
        return {
          kind: "autoDeltaNoop",
          headSha: null,
        };
      });

      await analyzeCommand();

      expect(lastSpinnerInstance?.text).toBe(
        "Checking knowledge graph freshness...",
      );
    });

    it("does not leak docuviaMemory scopes across repeated runs (idempotency)", async () => {
      mockAnalyze.mockResolvedValue({
        kind: "autoDeltaNoop",
        headSha: null,
      });
      const createScopeSpy = vi.spyOn(docuviaMemory, "createScope");
      const deleteScopeSpy = vi.spyOn(docuviaMemory, "deleteScope");

      await analyzeCommand();
      await analyzeCommand();

      expect(createScopeSpy).toHaveBeenCalledTimes(2);
      expect(deleteScopeSpy).toHaveBeenCalledTimes(2);
      expect(spinnerSucceed).toHaveBeenCalledTimes(2);
    });
  });

  describe("target path given (focused LLM decision extraction)", () => {
    it("does not call docuviaApi.analyze() and exits 1 with ANALYZE_LLM_MISSING_ENV when the base URL env var is missing", async () => {
      process.env.AI_DOCUVIA_MODEL = "some-model";

      await analyzeCommand("src/foo.ts");

      expect(mockAnalyze).not.toHaveBeenCalled();
      expect(ui.error).toHaveBeenCalledWith(
        UI_MESSAGES.ANALYZE_LLM_MISSING_ENV,
      );
      expect(process.exitCode).toBe(1);
    });

    it("does not call docuviaApi.analyze() and exits 1 when both model env vars are missing (base URL set)", async () => {
      process.env.AI_DOCUVIA_INTEGRATIONS_OPENAI_BASE_URL =
        "http://localhost:8317";

      await analyzeCommand("src/foo.ts");

      expect(mockAnalyze).not.toHaveBeenCalled();
      expect(ui.error).toHaveBeenCalledWith(
        UI_MESSAGES.ANALYZE_LLM_MISSING_ENV,
      );
      expect(process.exitCode).toBe(1);
    });

    it("accepts AI_DOCUVIA_FAST_MODEL alone (no AI_DOCUVIA_MODEL) as the model", async () => {
      process.env.AI_DOCUVIA_INTEGRATIONS_OPENAI_BASE_URL =
        "http://localhost:8317";
      process.env.AI_DOCUVIA_FAST_MODEL = "fast-model";
      mockAnalyze.mockResolvedValue({
        kind: "decisionExtraction",
        targetPath: "src/foo.ts",
        decisions: [],
        persisted: 0,
        deduped: 0,
      });
      const setSpy = vi.spyOn(docuviaMemory, "set");

      await analyzeCommand("src/foo.ts");

      expect(mockAnalyze).toHaveBeenCalled();
      expect(setSpy).toHaveBeenCalledWith(
        expect.any(String),
        "llmModel",
        "fast-model",
      );
    });

    it("sets targetPath/llmBaseUrl/llmApiKey/llmModel into docuviaMemory and calls docuviaApi.analyze() when env vars are present", async () => {
      process.env.AI_DOCUVIA_INTEGRATIONS_OPENAI_BASE_URL =
        "http://localhost:8317";
      process.env.AI_DOCUVIA_INTEGRATIONS_OPENAI_API_KEY = "secret-key";
      process.env.AI_DOCUVIA_MODEL = "big-model";
      mockAnalyze.mockResolvedValue({
        kind: "decisionExtraction",
        targetPath: "src/foo.ts",
        decisions: [],
        persisted: 0,
        deduped: 0,
      });
      const setSpy = vi.spyOn(docuviaMemory, "set");

      await analyzeCommand("src/foo.ts");

      expect(mockAnalyze).toHaveBeenCalled();
      const scopeId = mockAnalyze.mock.calls[0][0];
      expect(setSpy).toHaveBeenCalledWith(scopeId, "targetPath", "src/foo.ts");
      expect(setSpy).toHaveBeenCalledWith(
        scopeId,
        "llmBaseUrl",
        "http://localhost:8317",
      );
      expect(setSpy).toHaveBeenCalledWith(scopeId, "llmApiKey", "secret-key");
      expect(setSpy).toHaveBeenCalledWith(scopeId, "llmModel", "big-model");
    });

    it("prints 'title (nodeType, confidence: N)' plus content lines for each decision on success", async () => {
      process.env.AI_DOCUVIA_INTEGRATIONS_OPENAI_BASE_URL =
        "http://localhost:8317";
      process.env.AI_DOCUVIA_MODEL = "big-model";
      mockAnalyze.mockResolvedValue({
        kind: "decisionExtraction",
        targetPath: "src/foo.ts",
        decisions: [
          {
            title: "Use exitCode not exit()",
            nodeType: "rule",
            content: "Avoids a Windows crash while fetch handles close.",
            confidence: 0.85,
          },
        ],
        persisted: 1,
        deduped: 0,
      });
      await analyzeCommand("src/foo.ts");

      expect(spinnerSucceed).toHaveBeenCalledWith(
        UI_MESSAGES.ANALYZE_FOCUSED_SUCCESS,
      );
      expect(ui.info).toHaveBeenCalledWith(
        "Use exitCode not exit() (rule, confidence: 0.85)",
      );
      expect(ui.log).toHaveBeenCalledWith(
        "    Avoids a Windows crash while fetch handles close.",
      );
      expect(ui.info).toHaveBeenCalledWith(
        UI_MESSAGES.ANALYZE_FOCUSED_PERSISTED(1, 0),
      );
    });

    it("reports N persisted, M deduplicated after the per-decision output", async () => {
      process.env.AI_DOCUVIA_INTEGRATIONS_OPENAI_BASE_URL =
        "http://localhost:8317";
      process.env.AI_DOCUVIA_MODEL = "big-model";
      mockAnalyze.mockResolvedValue({
        kind: "decisionExtraction",
        targetPath: "src/foo.ts",
        decisions: [
          {
            title: "Decision A",
            nodeType: "decision",
            content: "content A",
            confidence: 0.9,
          },
          {
            title: "Decision B",
            nodeType: "decision",
            content: "content B",
            confidence: 0.8,
          },
        ],
        persisted: 1,
        deduped: 1,
      });

      await analyzeCommand("src/foo.ts");

      expect(ui.info).toHaveBeenCalledWith("1 persisted, 1 deduplicated");
    });

    it("does not print a persisted/deduplicated line when decisions is empty", async () => {
      process.env.AI_DOCUVIA_INTEGRATIONS_OPENAI_BASE_URL =
        "http://localhost:8317";
      process.env.AI_DOCUVIA_MODEL = "big-model";
      mockAnalyze.mockResolvedValue({
        kind: "decisionExtraction",
        targetPath: "src/foo.ts",
        decisions: [],
        persisted: 0,
        deduped: 0,
      });

      await analyzeCommand("src/foo.ts");

      expect(ui.info).not.toHaveBeenCalledWith(
        expect.stringContaining("deduplicated"),
      );
    });

    it("prints ANALYZE_FOCUSED_NONE when decisions is empty", async () => {
      process.env.AI_DOCUVIA_INTEGRATIONS_OPENAI_BASE_URL =
        "http://localhost:8317";
      process.env.AI_DOCUVIA_MODEL = "big-model";
      mockAnalyze.mockResolvedValue({
        kind: "decisionExtraction",
        targetPath: "src/foo.ts",
        decisions: [],
        persisted: 0,
        deduped: 0,
      });

      await analyzeCommand("src/foo.ts");

      expect(ui.info).toHaveBeenCalledWith(UI_MESSAGES.ANALYZE_FOCUSED_NONE);
    });

    it("calls spinner.fail and sets process.exitCode = 1 (not process.exit()) when docuviaApi.analyze() rejects", async () => {
      process.env.AI_DOCUVIA_INTEGRATIONS_OPENAI_BASE_URL =
        "http://localhost:8317";
      process.env.AI_DOCUVIA_MODEL = "big-model";
      mockAnalyze.mockRejectedValue(new Error("LLM exploded"));

      await analyzeCommand("src/foo.ts");

      expect(spinnerFail).toHaveBeenCalledWith(
        expect.stringContaining("LLM exploded"),
      );
      expect(process.exitCode).toBe(1);
    });
  });

  describe("--escalate-to-lsp (Tier B batch, phase1-decision-integration.md §8)", () => {
    const mockCheckTierBGate = vi.mocked(docuviaApi.checkTierBGate);

    beforeEach(() => {
      mockCheckTierBGate.mockReset();
      // Default to "environment ready" so tests below that aren't about the gate itself don't
      // have to stub it individually -- `confirmTierBGateOrAbort` now calls this unconditionally
      // (regression: it used to short-circuit past this call entirely for non-interactive
      // invocations, see the "hard-fails" tests below for the behavior that fixed).
      mockCheckTierBGate.mockResolvedValue({ available: true });
    });

    // vitest's own process never runs with a TTY stdin, so every test below exercises the
    // "background/non-interactive" path (§8c: never prompts) -- the interactive-prompt branch
    // itself lives entirely behind a `process.stdin.isTTY` check this suite cannot flip.

    it("checks the Tier B gate and calls docuviaApi.analyze() without prompting when the environment is ready (non-interactive)", async () => {
      mockAnalyze.mockResolvedValue({
        kind: "tierBBatch",
        headSha: "abc123",
        filesQueued: 1,
        filesDroppedDeleted: 0,
        filesSkippedLanguage: 0,
        filesProcessed: 1,
        filesFailed: 0,
        filesFailedPermanent: 0,
        edgesApplied: 2,
        edgesPruned: 0,
        degraded: false,
        commitCapExceeded: false,
      });
      const setSpy = vi.spyOn(docuviaMemory, "set");

      await analyzeCommand(undefined, "/workspace", { escalateToLsp: true });

      expect(mockCheckTierBGate).toHaveBeenCalled();
      expect(mockAnalyze).toHaveBeenCalled();
      const scopeId = mockAnalyze.mock.calls[0][0];
      expect(setSpy).toHaveBeenCalledWith(scopeId, "escalateToLsp", true);
      expect(spinnerSucceed).toHaveBeenCalledWith(
        UI_MESSAGES.ANALYZE_TIER_B_SUCCESS,
      );
      expect(ui.info).toHaveBeenCalledWith(
        UI_MESSAGES.ANALYZE_TIER_B_SUMMARY(1, 2, 0, 0),
      );
    });

    it("regression: hard-fails (process.exitCode=1) and never calls docuviaApi.analyze() when the environment isn't ready, non-interactive, no --fallback-ast -- previously this silently degraded and reported success, wasting a full batch's wall-clock time on an unbuilt target project", async () => {
      mockCheckTierBGate.mockResolvedValue({
        available: false,
        reason: "node_modules not found",
      });

      await analyzeCommand(undefined, "/workspace", { escalateToLsp: true });

      expect(mockCheckTierBGate).toHaveBeenCalled();
      expect(mockAnalyze).not.toHaveBeenCalled();
      expect(ui.error).toHaveBeenCalledWith(
        UI_MESSAGES.ANALYZE_TIER_B_GATE_FAILED("node_modules not found"),
      );
      expect(process.exitCode).toBe(1);
    });

    it("skips the gate entirely and still calls docuviaApi.analyze() when --fallback-ast is passed, even if the environment isn't ready -- the pre-push hook's own escape hatch", async () => {
      mockCheckTierBGate.mockResolvedValue({
        available: false,
        reason: "node_modules not found",
      });
      mockAnalyze.mockResolvedValue({
        kind: "tierBBatch",
        headSha: "abc123",
        filesQueued: 0,
        filesDroppedDeleted: 0,
        filesSkippedLanguage: 0,
        filesProcessed: 0,
        filesFailed: 0,
        filesFailedPermanent: 0,
        edgesApplied: 0,
        edgesPruned: 0,
        degraded: true,
        degradedReason: "node_modules not found",
        commitCapExceeded: false,
      });

      await analyzeCommand(undefined, "/workspace", {
        escalateToLsp: true,
        fallbackAst: true,
      });

      expect(mockCheckTierBGate).not.toHaveBeenCalled();
      expect(mockAnalyze).toHaveBeenCalled();
      expect(process.exitCode).not.toBe(1);
    });

    it("regression: sets process.exitCode = 1 when the batch degrades at runtime after the gate passed (no --fallback-ast) -- previously this exited 0, indistinguishable from a real success at the shell level (2026-07 CLI benchmark finding, live-reproduced against nestjs/nest)", async () => {
      mockCheckTierBGate.mockResolvedValue({ available: true });
      mockAnalyze.mockResolvedValue({
        kind: "tierBBatch",
        headSha: "abc123",
        filesQueued: 5,
        filesDroppedDeleted: 0,
        filesSkippedLanguage: 0,
        filesProcessed: 0,
        filesFailed: 5,
        filesFailedPermanent: 0,
        edgesApplied: 0,
        edgesPruned: 0,
        degraded: true,
        degradedReason:
          "LSP server exited before completing its initialize handshake",
        commitCapExceeded: false,
      });

      await analyzeCommand(undefined, "/workspace", {
        escalateToLsp: true,
        isInteractive: false,
      });

      expect(mockAnalyze).toHaveBeenCalled();
      expect(process.exitCode).toBe(1);
    });

    it("prints the degraded message (not the success summary) when the batch degraded", async () => {
      mockAnalyze.mockResolvedValue({
        kind: "tierBBatch",
        headSha: "abc123",
        filesQueued: 1,
        filesDroppedDeleted: 0,
        filesSkippedLanguage: 0,
        filesProcessed: 0,
        filesFailed: 0,
        filesFailedPermanent: 0,
        edgesApplied: 0,
        edgesPruned: 0,
        degraded: true,
        degradedReason: "binary not resolvable",
        commitCapExceeded: false,
      });

      await analyzeCommand(undefined, "/workspace", { escalateToLsp: true });

      expect(spinnerSucceed).toHaveBeenCalledWith(
        UI_MESSAGES.ANALYZE_TIER_B_DEGRADED("binary not resolvable"),
      );
    });

    it("reads DOCUVIA_LSP_BINARY/DOCUVIA_LSP_ARGS/DOCUVIA_LSP_TIMEOUT_MS/DOCUVIA_TIER_B_COMMIT_CAP into docuviaMemory", async () => {
      process.env.DOCUVIA_LSP_BINARY = "/custom/lsp";
      process.env.DOCUVIA_LSP_ARGS = "--stdio --verbose";
      process.env.DOCUVIA_LSP_TIMEOUT_MS = "5000";
      process.env.DOCUVIA_TIER_B_COMMIT_CAP = "5";
      mockAnalyze.mockResolvedValue({
        kind: "tierBBatch",
        headSha: null,
        filesQueued: 0,
        filesDroppedDeleted: 0,
        filesSkippedLanguage: 0,
        filesProcessed: 0,
        filesFailed: 0,
        filesFailedPermanent: 0,
        edgesApplied: 0,
        edgesPruned: 0,
        degraded: false,
        commitCapExceeded: false,
      });
      const setSpy = vi.spyOn(docuviaMemory, "set");

      await analyzeCommand(undefined, "/workspace", { escalateToLsp: true });

      const scopeId = mockAnalyze.mock.calls[0][0];
      expect(setSpy).toHaveBeenCalledWith(
        scopeId,
        "lspBinaryOverride",
        "/custom/lsp",
      );
      expect(setSpy).toHaveBeenCalledWith(scopeId, "lspArgsOverride", [
        "--stdio",
        "--verbose",
      ]);
      expect(setSpy).toHaveBeenCalledWith(scopeId, "lspTimeoutMs", 5000);
      expect(setSpy).toHaveBeenCalledWith(scopeId, "tierBCommitCap", 5);

      delete process.env.DOCUVIA_LSP_BINARY;
      delete process.env.DOCUVIA_LSP_ARGS;
      delete process.env.DOCUVIA_LSP_TIMEOUT_MS;
      delete process.env.DOCUVIA_TIER_B_COMMIT_CAP;
    });

    it("prefers options.lspTimeoutMs (--lsp-timeout) over DOCUVIA_LSP_TIMEOUT_MS when both are set", async () => {
      process.env.DOCUVIA_LSP_TIMEOUT_MS = "5000";
      mockAnalyze.mockResolvedValue({
        kind: "tierBBatch",
        headSha: null,
        filesQueued: 0,
        filesDroppedDeleted: 0,
        filesSkippedLanguage: 0,
        filesProcessed: 0,
        filesFailed: 0,
        filesFailedPermanent: 0,
        edgesApplied: 0,
        edgesPruned: 0,
        degraded: false,
        commitCapExceeded: false,
      });
      const setSpy = vi.spyOn(docuviaMemory, "set");

      await analyzeCommand(undefined, "/workspace", {
        escalateToLsp: true,
        lspTimeoutMs: 300_000,
      });

      const scopeId = mockAnalyze.mock.calls[0][0];
      expect(setSpy).toHaveBeenCalledWith(scopeId, "lspTimeoutMs", 300_000);

      delete process.env.DOCUVIA_LSP_TIMEOUT_MS;
    });

    it("treats options.lspTimeoutMs: 0 as an explicit override, not 'unset' (0 <= always wait)", async () => {
      mockAnalyze.mockResolvedValue({
        kind: "tierBBatch",
        headSha: null,
        filesQueued: 0,
        filesDroppedDeleted: 0,
        filesSkippedLanguage: 0,
        filesProcessed: 0,
        filesFailed: 0,
        filesFailedPermanent: 0,
        edgesApplied: 0,
        edgesPruned: 0,
        degraded: false,
        commitCapExceeded: false,
      });
      const setSpy = vi.spyOn(docuviaMemory, "set");

      await analyzeCommand(undefined, "/workspace", {
        escalateToLsp: true,
        lspTimeoutMs: 0,
      });

      const scopeId = mockAnalyze.mock.calls[0][0];
      expect(setSpy).toHaveBeenCalledWith(scopeId, "lspTimeoutMs", 0);
    });

    it("uses the Tier B failure message prefix (not the generic one) when the batch throws", async () => {
      mockAnalyze.mockRejectedValue(new Error("lock timeout"));

      await analyzeCommand(undefined, "/workspace", { escalateToLsp: true });

      expect(spinnerFail).toHaveBeenCalledWith(
        UI_MESSAGES.ANALYZE_TIER_B_FAIL + "lock timeout",
      );
      expect(process.exitCode).toBe(1);
    });

    it("sets MemoryKeys.TIER_B_FULL_RESYNC when --full is passed alongside --escalate-to-lsp (typescript-cli-benchmark.md §5.3/§5.7 item 1)", async () => {
      mockAnalyze.mockResolvedValue({
        kind: "tierBBatch",
        headSha: "abc123",
        filesQueued: 3,
        filesDroppedDeleted: 0,
        filesSkippedLanguage: 0,
        filesProcessed: 3,
        filesFailed: 0,
        filesFailedPermanent: 0,
        edgesApplied: 0,
        edgesPruned: 0,
        degraded: false,
        commitCapExceeded: false,
      });
      const setSpy = vi.spyOn(docuviaMemory, "set");

      await analyzeCommand(undefined, "/workspace", {
        escalateToLsp: true,
        full: true,
      });

      const scopeId = mockAnalyze.mock.calls[0][0];
      expect(setSpy).toHaveBeenCalledWith(scopeId, "tierBFullResync", true);
    });

    it("does not set MemoryKeys.TIER_B_FULL_RESYNC when --full is omitted (regression guard)", async () => {
      mockAnalyze.mockResolvedValue({
        kind: "tierBBatch",
        headSha: "abc123",
        filesQueued: 1,
        filesDroppedDeleted: 0,
        filesSkippedLanguage: 0,
        filesProcessed: 1,
        filesFailed: 0,
        filesFailedPermanent: 0,
        edgesApplied: 0,
        edgesPruned: 0,
        degraded: false,
        commitCapExceeded: false,
      });
      const setSpy = vi.spyOn(docuviaMemory, "set");

      await analyzeCommand(undefined, "/workspace", { escalateToLsp: true });

      expect(setSpy).not.toHaveBeenCalledWith(
        expect.any(String),
        "tierBFullResync",
        true,
      );
    });

    it("targetPath takes priority over --escalate-to-lsp when both are somehow given", async () => {
      process.env.AI_DOCUVIA_INTEGRATIONS_OPENAI_BASE_URL =
        "http://localhost:8317";
      process.env.AI_DOCUVIA_MODEL = "big-model";
      mockAnalyze.mockResolvedValue({
        kind: "decisionExtraction",
        targetPath: "src/foo.ts",
        decisions: [],
        persisted: 0,
        deduped: 0,
      });

      await analyzeCommand("src/foo.ts", "/workspace", { escalateToLsp: true });

      expect(mockCheckTierBGate).not.toHaveBeenCalled();
      expect(spinnerSucceed).toHaveBeenCalledWith(
        UI_MESSAGES.ANALYZE_FOCUSED_SUCCESS,
      );
    });
  });

  describe("--agent-authored (issue #42, roadmap items 32-34)", () => {
    it("hard-fails (exitCode=1) and never touches stdin/docuviaApi.analyze() when --agent-authored is passed without a target path", async () => {
      await analyzeCommand(undefined, "/workspace", { agentAuthored: true });

      expect(mockReadStdin).not.toHaveBeenCalled();
      expect(mockAnalyze).not.toHaveBeenCalled();
      expect(ui.error).toHaveBeenCalledWith(
        UI_MESSAGES.ANALYZE_AGENT_AUTHORED_MISSING_TARGET,
      );
      expect(process.exitCode).toBe(1);
    });

    it("reads a valid payload from stdin (default) and sets targetPath/AGENT_AUTHORED/AGENT_AUTHORED_DECISIONS into docuviaMemory, skipping the LLM env requirement entirely", async () => {
      mockReadStdin.mockResolvedValue(
        JSON.stringify({
          decisions: [
            {
              title: "Agent-authored decision",
              content: "Written verbatim, no LLM call.",
              nodeType: "decision",
              confidence: 0.9,
            },
          ],
        }),
      );
      mockAnalyze.mockResolvedValue({
        kind: "decisionExtraction",
        targetPath: "src/foo.ts",
        decisions: [],
        persisted: 1,
        deduped: 0,
      });
      const setSpy = vi.spyOn(docuviaMemory, "set");

      await analyzeCommand("src/foo.ts", "/workspace", {
        agentAuthored: true,
      });

      expect(mockAnalyze).toHaveBeenCalled();
      const scopeId = mockAnalyze.mock.calls[0][0];
      expect(setSpy).toHaveBeenCalledWith(scopeId, "targetPath", "src/foo.ts");
      expect(setSpy).toHaveBeenCalledWith(scopeId, "agentAuthored", true);
      expect(setSpy).toHaveBeenCalledWith(scopeId, "agentAuthoredDecisions", [
        {
          title: "Agent-authored decision",
          content: "Written verbatim, no LLM call.",
          nodeType: "decision",
          confidence: 0.9,
        },
      ]);
      expect(ui.error).not.toHaveBeenCalledWith(
        UI_MESSAGES.ANALYZE_LLM_MISSING_ENV,
      );
    });

    it("reads the payload from --decisions-file instead of stdin when decisionsFile is given", async () => {
      const tmpDir = fs.mkdtempSync(
        path.join(os.tmpdir(), "docuvia-analyze-decisions-file-test-"),
      );
      const decisionsFile = path.join(tmpDir, "decisions.json");
      fs.writeFileSync(
        decisionsFile,
        JSON.stringify({
          decisions: [
            {
              title: "From a file",
              content: "content",
              nodeType: "rule",
              confidence: 0.5,
            },
          ],
        }),
      );
      mockAnalyze.mockResolvedValue({
        kind: "decisionExtraction",
        targetPath: "src/foo.ts",
        decisions: [],
        persisted: 1,
        deduped: 0,
      });

      try {
        await analyzeCommand("src/foo.ts", "/workspace", {
          agentAuthored: true,
          decisionsFile,
        });
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }

      expect(mockReadStdin).not.toHaveBeenCalled();
      expect(mockAnalyze).toHaveBeenCalled();
    });

    it("hard-fails with ANALYZE_AGENT_AUTHORED_MISSING_PAYLOAD (not a hang) when the caller is at a real TTY with no --decisions-file", async () => {
      const originalIsTTY = process.stdin.isTTY;
      Object.defineProperty(process.stdin, "isTTY", {
        value: true,
        configurable: true,
      });

      try {
        await analyzeCommand("src/foo.ts", "/workspace", {
          agentAuthored: true,
        });
      } finally {
        Object.defineProperty(process.stdin, "isTTY", {
          value: originalIsTTY,
          configurable: true,
        });
      }

      expect(mockReadStdin).not.toHaveBeenCalled();
      expect(mockAnalyze).not.toHaveBeenCalled();
      expect(ui.error).toHaveBeenCalledWith(
        UI_MESSAGES.ANALYZE_AGENT_AUTHORED_MISSING_PAYLOAD,
      );
      expect(process.exitCode).toBe(1);
    });

    it("hard-fails with ANALYZE_AGENT_AUTHORED_MISSING_PAYLOAD when stdin closes with no data", async () => {
      mockReadStdin.mockResolvedValue("");

      await analyzeCommand("src/foo.ts", "/workspace", {
        agentAuthored: true,
      });

      expect(mockAnalyze).not.toHaveBeenCalled();
      expect(ui.error).toHaveBeenCalledWith(
        UI_MESSAGES.ANALYZE_AGENT_AUTHORED_MISSING_PAYLOAD,
      );
      expect(process.exitCode).toBe(1);
    });

    it("hard-fails with a clear message (not a silent coercion) on malformed JSON", async () => {
      mockReadStdin.mockResolvedValue("{ not valid json");

      await analyzeCommand("src/foo.ts", "/workspace", {
        agentAuthored: true,
      });

      expect(mockAnalyze).not.toHaveBeenCalled();
      expect(ui.error).toHaveBeenCalledWith(
        expect.stringContaining("not valid JSON"),
      );
      expect(process.exitCode).toBe(1);
    });

    it.each([
      [
        "missing title",
        { content: "c", nodeType: "decision", confidence: 0.5 },
      ],
      [
        "invalid nodeType",
        { title: "t", content: "c", nodeType: "bogus", confidence: 0.5 },
      ],
      [
        "confidence above 1",
        { title: "t", content: "c", nodeType: "decision", confidence: 1.5 },
      ],
      [
        "confidence below 0",
        { title: "t", content: "c", nodeType: "decision", confidence: -0.1 },
      ],
    ])(
      "hard-fails with a clear message (not a silent coercion) on a schema-violating decision: %s",
      async (_label, badDecision) => {
        mockReadStdin.mockResolvedValue(
          JSON.stringify({ decisions: [badDecision] }),
        );

        await analyzeCommand("src/foo.ts", "/workspace", {
          agentAuthored: true,
        });

        expect(mockAnalyze).not.toHaveBeenCalled();
        expect(ui.error).toHaveBeenCalledWith(
          expect.stringContaining("does not match the expected shape"),
        );
        expect(process.exitCode).toBe(1);
      },
    );

    it("a valid empty { decisions: [] } payload succeeds (0 persisted/0 deduped), not a validation failure", async () => {
      mockReadStdin.mockResolvedValue(JSON.stringify({ decisions: [] }));
      mockAnalyze.mockResolvedValue({
        kind: "decisionExtraction",
        targetPath: "src/foo.ts",
        decisions: [],
        persisted: 0,
        deduped: 0,
      });
      const setSpy = vi.spyOn(docuviaMemory, "set");

      await analyzeCommand("src/foo.ts", "/workspace", {
        agentAuthored: true,
      });

      expect(mockAnalyze).toHaveBeenCalled();
      const scopeId = mockAnalyze.mock.calls[0][0];
      expect(setSpy).toHaveBeenCalledWith(
        scopeId,
        "agentAuthoredDecisions",
        [],
      );
      expect(process.exitCode).not.toBe(1);
    });
  });
});
