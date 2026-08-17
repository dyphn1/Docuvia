import { describe, it, expect, vi, beforeEach } from "vitest";
import { DoctorWorkflow } from "../../src/workflows/doctor/doctor-workflow.js";
import {
  docuviaFactory,
  TOKENS,
  DiagnosticStatus,
  DocuviaError,
} from "@workspace/contracts";
import { GitConstants } from "@workspace/core";
import * as fs from "fs/promises";
import * as path from "path";
import { probeDocuviaResolvable } from "../../src/workflows/doctor/git-hook-resolvability.js";
import { DOCTOR_MESSAGES } from "../../src/workflows/doctor/doctor-messages.js";
import { appendTierBQueueEntries } from "../../src/workflows/analyze/tier-b-queue.js";

vi.mock("fs/promises");
vi.mock("../../src/workflows/doctor/git-hook-resolvability.js", () => ({
  probeDocuviaResolvable: vi.fn(),
}));

describe("DoctorWorkflow", () => {
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    flush: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    docuviaFactory.reset();
  });

  it("skips all skippable checks when options are passed -- the LLM reachability and agent-hooks checks have no bearing on skipDb/skipGit/skipLogs and always evaluate", async () => {
    vi.mocked(fs.stat).mockRejectedValue(new Error("ENOENT"));

    const wf = new DoctorWorkflow("/test", logger);
    const result = await wf.execute({
      skipDb: true,
      skipGit: true,
      skipLogs: true,
    });
    expect(result.allPassed).toBe(true);
    expect(result.diagnostics).toEqual({
      llm_reachability: {
        status: DiagnosticStatus.PASS,
        message:
          "Not configured -- Tier C is inactive (AI_DOCUVIA_INTEGRATIONS_OPENAI_BASE_URL not set).",
      },
      agent_hooks_claude: {
        status: DiagnosticStatus.PASS,
        message: "Claude hooks not found (run `docuvia init` to install).",
      },
      agent_hooks_cursor: {
        status: DiagnosticStatus.PASS,
        message: "Cursor hooks not found (run `docuvia init` to install).",
      },
    });
  });

  describe("DB Check", () => {
    it("fails if local DB is not found", async () => {
      vi.mocked(fs.stat).mockRejectedValue(new Error("Not found"));
      const wf = new DoctorWorkflow("/test", logger);
      const result = await wf.execute({ skipGit: true, skipLogs: true });
      expect(result.allPassed).toBe(false);
      expect(result.diagnostics["db_found"].status).toBe(DiagnosticStatus.FAIL);
    });

    it("fails if DiagnosticRunnerDb is not registered", async () => {
      vi.mocked(fs.stat).mockResolvedValue({} as any);
      const wf = new DoctorWorkflow("/test", logger);
      const result = await wf.execute({ skipGit: true, skipLogs: true });
      expect(result.allPassed).toBe(false);
      expect(result.diagnostics["db_runner"].status).toBe(
        DiagnosticStatus.FAIL,
      );
    });

    it("runs DiagnosticRunnerDb and accumulates results", async () => {
      vi.mocked(fs.stat).mockResolvedValue({} as any);
      const dbRunner = {
        checkHealth: vi.fn().mockResolvedValue({
          check1: { status: DiagnosticStatus.PASS, message: "ok" },
        }),
      };
      docuviaFactory.register(TOKENS.DiagnosticRunnerDb, () => dbRunner);

      const wf = new DoctorWorkflow("/test", logger);
      const result = await wf.execute({ skipGit: true, skipLogs: true });
      expect(result.allPassed).toBe(true);
      expect(result.diagnostics["check1"].status).toBe(DiagnosticStatus.PASS);
    });

    it("runs DiagnosticRunnerDb and catches failures", async () => {
      vi.mocked(fs.stat).mockResolvedValue({} as any);
      const dbRunner = {
        checkHealth: vi.fn().mockResolvedValue({
          check1: { status: DiagnosticStatus.FAIL, message: "err" },
        }),
      };
      docuviaFactory.register(TOKENS.DiagnosticRunnerDb, () => dbRunner);

      const wf = new DoctorWorkflow("/test", logger);
      const result = await wf.execute({ skipGit: true, skipLogs: true });
      expect(result.allPassed).toBe(false);
      expect(result.diagnostics["check1"].status).toBe(DiagnosticStatus.FAIL);
    });
  });

  describe("Git Check", () => {
    it("fails if DiagnosticRunnerGit is not registered", async () => {
      const wf = new DoctorWorkflow("/test", logger);
      const result = await wf.execute({ skipDb: true, skipLogs: true });
      expect(result.allPassed).toBe(false);
      expect(result.diagnostics["git_runner"].status).toBe(
        DiagnosticStatus.FAIL,
      );
    });

    it("runs DiagnosticRunnerGit and accumulates results", async () => {
      const gitRunner = {
        checkHealth: vi.fn().mockResolvedValue({
          git1: { status: DiagnosticStatus.PASS, message: "ok" },
        }),
      };
      docuviaFactory.register(TOKENS.DiagnosticRunnerGit, () => gitRunner);

      const wf = new DoctorWorkflow("/test", logger);
      const result = await wf.execute({ skipDb: true, skipLogs: true });
      expect(result.allPassed).toBe(true);
      expect(result.diagnostics["git1"].status).toBe(DiagnosticStatus.PASS);
    });

    it("handles GIT_NETWORK_TIMEOUT DocuviaError", async () => {
      const gitRunner = {
        checkHealth: vi
          .fn()
          .mockRejectedValue(
            new DocuviaError("GIT_NETWORK_TIMEOUT", "timeout"),
          ),
      };
      docuviaFactory.register(TOKENS.DiagnosticRunnerGit, () => gitRunner);

      const wf = new DoctorWorkflow("/test", logger);
      const result = await wf.execute({ skipDb: true, skipLogs: true });
      expect(result.allPassed).toBe(false);
      expect(result.diagnostics["git_reachability"].status).toBe(
        DiagnosticStatus.FAIL,
      );
      expect(result.diagnostics["git_reachability"].suggestion).toContain(
        "DNS settings",
      );
    });

    it("handles GIT_COMMAND_FAILED not a git repository", async () => {
      const gitRunner = {
        checkHealth: vi
          .fn()
          .mockRejectedValue(
            new DocuviaError(
              "GIT_COMMAND_FAILED",
              "does not appear to be a git repository",
            ),
          ),
      };
      docuviaFactory.register(TOKENS.DiagnosticRunnerGit, () => gitRunner);

      const wf = new DoctorWorkflow("/test", logger);
      const result = await wf.execute({ skipDb: true, skipLogs: true });
      expect(result.allPassed).toBe(false);
      expect(result.diagnostics["git_reachability"].suggestion).toContain(
        "origin' is set correctly",
      );
    });

    it("handles GIT_COMMAND_FAILED could not read from remote", async () => {
      const gitRunner = {
        checkHealth: vi
          .fn()
          .mockRejectedValue(
            new DocuviaError(
              "GIT_COMMAND_FAILED",
              "Could not read from remote repository",
            ),
          ),
      };
      docuviaFactory.register(TOKENS.DiagnosticRunnerGit, () => gitRunner);

      const wf = new DoctorWorkflow("/test", logger);
      const result = await wf.execute({ skipDb: true, skipLogs: true });
      expect(result.allPassed).toBe(false);
      expect(result.diagnostics["git_reachability"].suggestion).toContain(
        "SSH keys",
      );
    });

    it("handles general error", async () => {
      const gitRunner = {
        checkHealth: vi.fn().mockRejectedValue(new Error("generic error")),
      };
      docuviaFactory.register(TOKENS.DiagnosticRunnerGit, () => gitRunner);

      const wf = new DoctorWorkflow("/test", logger);
      const result = await wf.execute({ skipDb: true, skipLogs: true });
      expect(result.allPassed).toBe(false);
      expect(result.diagnostics["git_reachability"].message).toContain(
        "generic error",
      );
      expect(result.diagnostics["git_reachability"].suggestion).toBeUndefined();
    });
  });

  describe("Logs Check", () => {
    it("handles no logs found", async () => {
      vi.mocked(fs.readdir).mockRejectedValue(new Error("enoent"));
      const wf = new DoctorWorkflow("/test", logger);
      const result = await wf.execute({ skipDb: true, skipGit: true });
      expect(result.allPassed).toBe(true);
      expect(result.diagnostics["logs"].status).toBe(DiagnosticStatus.PASS);
    });

    it("handles logs with no errors", async () => {
      vi.mocked(fs.readdir).mockResolvedValue(["a.log", "b.txt"] as any);
      vi.mocked(fs.readFile).mockResolvedValue(
        `{"level":30}\ninvalid\n{"level":20}\n`,
      );
      const wf = new DoctorWorkflow("/test", logger);
      const result = await wf.execute({ skipDb: true, skipGit: true });
      expect(result.allPassed).toBe(true);
      expect(result.diagnostics["logs"].status).toBe(DiagnosticStatus.PASS);
    });

    it("handles logs with errors", async () => {
      vi.mocked(fs.readdir).mockResolvedValue(["a.log"] as any);
      vi.mocked(fs.readFile).mockResolvedValue(`{"level":50}\n{"level":60}\n`);
      const wf = new DoctorWorkflow("/test", logger);
      const result = await wf.execute({ skipDb: true, skipGit: true });
      expect(result.allPassed).toBe(false);
      expect(result.diagnostics["logs"].status).toBe(DiagnosticStatus.FAIL);
      expect(result.diagnostics["logs"].message).toContain("2 critical errors");
    });
  });

  describe("Tier B Commit Cap Check (phase1-decision-integration.md §10c doctor-half, §9m item 1 metric)", () => {
    function registerPassingDbAndGitRunners() {
      vi.mocked(fs.stat).mockResolvedValue({} as any);
      docuviaFactory.register(TOKENS.DiagnosticRunnerDb, () => ({
        checkHealth: vi.fn().mockResolvedValue({}),
      }));
      docuviaFactory.register(TOKENS.DiagnosticRunnerGit, () => ({
        checkHealth: vi.fn().mockResolvedValue({}),
      }));
    }

    function makeMockStore(changedBytes: string | undefined) {
      return {
        meta: { get: vi.fn().mockReturnValue(changedBytes), set: vi.fn() },
        close: vi.fn().mockResolvedValue(undefined),
      };
    }

    it("is skipped silently (no diagnostic key, no crash) when GraphStoreOpener isn't registered", async () => {
      registerPassingDbAndGitRunners();

      const wf = new DoctorWorkflow("/test", logger);
      const result = await wf.execute({ skipLogs: true });

      expect(result.diagnostics["tier_b_commit_cap"]).toBeUndefined();
    });

    it("is not evaluated at all when skipDb is set", async () => {
      const store = makeMockStore(
        String(GitConstants.DEFAULT_TIER_B_COMMIT_CAP_BYTES),
      );
      const openStore = vi.fn().mockResolvedValue(store);
      docuviaFactory.register(TOKENS.GraphStoreOpener, () => openStore);

      const wf = new DoctorWorkflow("/test", logger);
      await wf.execute({ skipDb: true, skipLogs: true });

      expect(openStore).not.toHaveBeenCalled();
    });

    it("is still evaluated when only skipGit is set -- the check no longer needs IGitProvider", async () => {
      registerPassingDbAndGitRunners();
      const store = makeMockStore(
        String(GitConstants.DEFAULT_TIER_B_COMMIT_CAP_BYTES),
      );
      const openStore = vi.fn().mockResolvedValue(store);
      docuviaFactory.register(TOKENS.GraphStoreOpener, () => openStore);

      const wf = new DoctorWorkflow("/test", logger);
      const result = await wf.execute({ skipGit: true, skipLogs: true });

      expect(openStore).toHaveBeenCalled();
      expect(result.diagnostics["tier_b_commit_cap"]).toBeDefined();
    });

    it("reports PASS with the exceeded message when the accumulated changed-bytes counter is at or above the cap", async () => {
      registerPassingDbAndGitRunners();
      const store = makeMockStore(
        String(GitConstants.DEFAULT_TIER_B_COMMIT_CAP_BYTES),
      );
      docuviaFactory.register(TOKENS.GraphStoreOpener, () =>
        vi.fn().mockResolvedValue(store),
      );

      const wf = new DoctorWorkflow("/test", logger);
      const result = await wf.execute({ skipLogs: true });

      expect(result.diagnostics["tier_b_commit_cap"].status).toBe(
        DiagnosticStatus.PASS,
      );
      expect(result.diagnostics["tier_b_commit_cap"].message).toContain(
        "exceeded the cap",
      );
      expect(result.allPassed).toBe(true);
      expect(store.close).toHaveBeenCalled();
    });

    it("reports PASS with the not-yet-reached message when the commit-cap key is absent", async () => {
      registerPassingDbAndGitRunners();
      const store = makeMockStore(undefined);
      docuviaFactory.register(TOKENS.GraphStoreOpener, () =>
        vi.fn().mockResolvedValue(store),
      );

      const wf = new DoctorWorkflow("/test", logger);
      const result = await wf.execute({ skipLogs: true });

      expect(result.diagnostics["tier_b_commit_cap"]).toEqual({
        status: DiagnosticStatus.PASS,
        message: "Tier B commit-cap not yet reached.",
      });
      expect(result.allPassed).toBe(true);
    });

    it("is skipped silently (no diagnostic key) when the db can't be opened -- already covered by db_found's own FAIL", async () => {
      vi.mocked(fs.stat).mockRejectedValue(new Error("not found"));
      docuviaFactory.register(TOKENS.DiagnosticRunnerGit, () => ({
        checkHealth: vi.fn().mockResolvedValue({}),
      }));
      docuviaFactory.register(TOKENS.GraphStoreOpener, () =>
        vi.fn().mockRejectedValue(new Error("ENOENT")),
      );

      const wf = new DoctorWorkflow("/test", logger);
      const result = await wf.execute({ skipLogs: true });

      expect(result.diagnostics["tier_b_commit_cap"]).toBeUndefined();
      expect(result.diagnostics["db_found"].status).toBe(DiagnosticStatus.FAIL);
    });
  });

  describe("Tier B Coverage Check (dogfooding-findings-fixes.md Phase 2, roadmap item 23)", () => {
    function registerPassingDbAndGitRunners() {
      vi.mocked(fs.stat).mockResolvedValue({} as any);
      docuviaFactory.register(TOKENS.DiagnosticRunnerDb, () => ({
        checkHealth: vi.fn().mockResolvedValue({}),
      }));
      docuviaFactory.register(TOKENS.DiagnosticRunnerGit, () => ({
        checkHealth: vi.fn().mockResolvedValue({}),
      }));
    }

    function makeMockStore(coverage: {
      totalFiles: number;
      processedFiles: number;
    }) {
      return {
        files: { getTierBCoverage: vi.fn().mockReturnValue(coverage) },
        close: vi.fn().mockResolvedValue(undefined),
      };
    }

    it("is skipped silently (no diagnostic key, no crash) when GraphStoreOpener isn't registered", async () => {
      registerPassingDbAndGitRunners();

      const wf = new DoctorWorkflow("/test", logger);
      const result = await wf.execute({ skipLogs: true });

      expect(result.diagnostics["tier_b_coverage"]).toBeUndefined();
    });

    it("is not evaluated at all when skipDb is set", async () => {
      const store = makeMockStore({ totalFiles: 100, processedFiles: 90 });
      const openStore = vi.fn().mockResolvedValue(store);
      docuviaFactory.register(TOKENS.GraphStoreOpener, () => openStore);

      const wf = new DoctorWorkflow("/test", logger);
      await wf.execute({ skipDb: true, skipLogs: true });

      expect(store.files.getTierBCoverage).not.toHaveBeenCalled();
    });

    it("reports PASS when coverage is at or above the threshold", async () => {
      registerPassingDbAndGitRunners();
      const store = makeMockStore({ totalFiles: 100, processedFiles: 90 });
      docuviaFactory.register(TOKENS.GraphStoreOpener, () =>
        vi.fn().mockResolvedValue(store),
      );

      const wf = new DoctorWorkflow("/test", logger);
      const result = await wf.execute({ skipLogs: true });

      expect(result.diagnostics["tier_b_coverage"].status).toBe(
        DiagnosticStatus.PASS,
      );
      expect(result.diagnostics["tier_b_coverage"].message).toContain("90/100");
      expect(result.allPassed).toBe(true);
      expect(store.close).toHaveBeenCalled();
    });

    it("reports FAIL with an actionable message/suggestion when coverage is below the threshold", async () => {
      registerPassingDbAndGitRunners();
      const store = makeMockStore({ totalFiles: 484, processedFiles: 74 });
      docuviaFactory.register(TOKENS.GraphStoreOpener, () =>
        vi.fn().mockResolvedValue(store),
      );

      const wf = new DoctorWorkflow("/test", logger);
      const result = await wf.execute({ skipLogs: true });

      expect(result.diagnostics["tier_b_coverage"].status).toBe(
        DiagnosticStatus.FAIL,
      );
      expect(result.diagnostics["tier_b_coverage"].message).toContain("74/484");
      expect(result.diagnostics["tier_b_coverage"].suggestion).toContain(
        "docuvia analyze --escalate-to-lsp --full",
      );
      expect(result.allPassed).toBe(false);
    });

    it("is skipped silently (no diagnostic key) when the db can't be opened -- already covered by db_found's own FAIL", async () => {
      vi.mocked(fs.stat).mockRejectedValue(new Error("not found"));
      docuviaFactory.register(TOKENS.DiagnosticRunnerGit, () => ({
        checkHealth: vi.fn().mockResolvedValue({}),
      }));
      docuviaFactory.register(TOKENS.GraphStoreOpener, () =>
        vi.fn().mockRejectedValue(new Error("ENOENT")),
      );

      const wf = new DoctorWorkflow("/test", logger);
      const result = await wf.execute({ skipLogs: true });

      expect(result.diagnostics["tier_b_coverage"]).toBeUndefined();
      expect(result.diagnostics["db_found"].status).toBe(DiagnosticStatus.FAIL);
    });
  });

  describe("Graph Empty Check (issue #57)", () => {
    function registerPassingDbAndGitRunners() {
      vi.mocked(fs.stat).mockResolvedValue({} as any);
      docuviaFactory.register(TOKENS.DiagnosticRunnerDb, () => ({
        checkHealth: vi.fn().mockResolvedValue({}),
      }));
      docuviaFactory.register(TOKENS.DiagnosticRunnerGit, () => ({
        checkHealth: vi.fn().mockResolvedValue({}),
      }));
    }

    function makeMockStore(
      project: { id: number } | undefined,
      l2Nodes: number,
    ) {
      return {
        projects: { getFirst: vi.fn().mockReturnValue(project) },
        graph: {
          count: vi.fn().mockReturnValue({ l2Nodes, l3Nodes: 0 }),
        },
        close: vi.fn().mockResolvedValue(undefined),
      };
    }

    it("is skipped silently (no diagnostic key, no crash) when GraphStoreOpener isn't registered", async () => {
      registerPassingDbAndGitRunners();

      const wf = new DoctorWorkflow("/test", logger);
      const result = await wf.execute({ skipLogs: true });

      expect(result.diagnostics["graph_empty"]).toBeUndefined();
    });

    it("is not evaluated at all when skipDb is set", async () => {
      const store = makeMockStore({ id: 1 }, 100);
      const openStore = vi.fn().mockResolvedValue(store);
      docuviaFactory.register(TOKENS.GraphStoreOpener, () => openStore);

      const wf = new DoctorWorkflow("/test", logger);
      await wf.execute({ skipDb: true, skipLogs: true });

      expect(openStore).not.toHaveBeenCalled();
    });

    it("reports PASS when a project row exists and the graph has L2 nodes", async () => {
      registerPassingDbAndGitRunners();
      const store = makeMockStore({ id: 1 }, 6280);
      docuviaFactory.register(TOKENS.GraphStoreOpener, () =>
        vi.fn().mockResolvedValue(store),
      );

      const wf = new DoctorWorkflow("/test", logger);
      const result = await wf.execute({ skipLogs: true });

      expect(result.diagnostics["graph_empty"]).toEqual({
        status: DiagnosticStatus.PASS,
        message: "Knowledge graph populated (6280 L2 node(s)).",
      });
      expect(result.allPassed).toBe(true);
      expect(store.close).toHaveBeenCalled();
    });

    it("reports FAIL with the run-docuvia-init suggestion when a project row exists but 0 L2 nodes (issue #57's exact repro)", async () => {
      registerPassingDbAndGitRunners();
      const store = makeMockStore({ id: 1 }, 0);
      docuviaFactory.register(TOKENS.GraphStoreOpener, () =>
        vi.fn().mockResolvedValue(store),
      );

      const wf = new DoctorWorkflow("/test", logger);
      const result = await wf.execute({ skipLogs: true });

      expect(result.diagnostics["graph_empty"].status).toBe(
        DiagnosticStatus.FAIL,
      );
      expect(result.diagnostics["graph_empty"].suggestion).toBe(
        DOCTOR_MESSAGES.GRAPH_EMPTY_SUGGESTION,
      );
      expect(result.allPassed).toBe(false);
    });

    it("reports FAIL when no project row exists at all -- same never-ingested state, no anchor to attach decisions to", async () => {
      registerPassingDbAndGitRunners();
      const store = makeMockStore(undefined, 0);
      docuviaFactory.register(TOKENS.GraphStoreOpener, () =>
        vi.fn().mockResolvedValue(store),
      );

      const wf = new DoctorWorkflow("/test", logger);
      const result = await wf.execute({ skipLogs: true });

      expect(result.diagnostics["graph_empty"].status).toBe(
        DiagnosticStatus.FAIL,
      );
      expect(result.diagnostics["graph_empty"].message).toContain(
        "graph is empty",
      );
      expect(result.allPassed).toBe(false);
    });

    it("is skipped silently (no diagnostic key) when the db can't be opened -- already covered by db_found's own FAIL", async () => {
      vi.mocked(fs.stat).mockRejectedValue(new Error("not found"));
      docuviaFactory.register(TOKENS.DiagnosticRunnerGit, () => ({
        checkHealth: vi.fn().mockResolvedValue({}),
      }));
      docuviaFactory.register(TOKENS.GraphStoreOpener, () =>
        vi.fn().mockRejectedValue(new Error("ENOENT")),
      );

      const wf = new DoctorWorkflow("/test", logger);
      const result = await wf.execute({ skipLogs: true });

      expect(result.diagnostics["graph_empty"]).toBeUndefined();
      expect(result.diagnostics["db_found"].status).toBe(DiagnosticStatus.FAIL);
    });
  });

  describe("Agent Hooks Check (workflows/doctor-execution-flow.md Presentation-layer asymmetry cleanup)", () => {
    it("reports PASS for both platforms when both hook files exist", async () => {
      vi.mocked(fs.stat).mockResolvedValue({} as any);

      const wf = new DoctorWorkflow("/test", logger);
      const result = await wf.execute({
        skipDb: true,
        skipGit: true,
        skipLogs: true,
      });

      expect(result.diagnostics["agent_hooks_claude"]).toEqual({
        status: DiagnosticStatus.PASS,
        message: "Claude hooks found.",
      });
      expect(result.diagnostics["agent_hooks_cursor"]).toEqual({
        status: DiagnosticStatus.PASS,
        message: "Cursor hooks found.",
      });
      expect(result.allPassed).toBe(true);
    });

    it("reports PASS (never FAIL) with a not-found message when a hook file is absent -- not selecting a platform at init is a legitimate state", async () => {
      vi.mocked(fs.stat).mockRejectedValue(new Error("ENOENT"));

      const wf = new DoctorWorkflow("/test", logger);
      const result = await wf.execute({
        skipDb: true,
        skipGit: true,
        skipLogs: true,
      });

      expect(result.diagnostics["agent_hooks_claude"]).toEqual({
        status: DiagnosticStatus.PASS,
        message: "Claude hooks not found (run `docuvia init` to install).",
      });
      expect(result.allPassed).toBe(true);
    });

    it("checks the expected repo-relative hook paths for each platform", async () => {
      vi.mocked(fs.stat).mockResolvedValue({} as any);

      const wf = new DoctorWorkflow("/test", logger);
      await wf.execute({ skipDb: true, skipGit: true, skipLogs: true });

      expect(fs.stat).toHaveBeenCalledWith(
        path.join("/test", ".claude", "hooks", "docuvia-hook.js"),
      );
      expect(fs.stat).toHaveBeenCalledWith(
        path.join("/test", ".cursor", "hooks", "docuvia-hook.cjs"),
      );
    });

    it("is not evaluated and never touches fs.stat when skipHooks is set", async () => {
      vi.mocked(fs.stat).mockResolvedValue({} as any);

      const wf = new DoctorWorkflow("/test", logger);
      const result = await wf.execute({
        skipDb: true,
        skipGit: true,
        skipLogs: true,
        skipHooks: true,
      });

      expect(result.diagnostics["agent_hooks_claude"]).toBeUndefined();
      expect(result.diagnostics["agent_hooks_cursor"]).toBeUndefined();
      expect(fs.stat).not.toHaveBeenCalled();
    });
  });

  describe("Git Hook Check (phase1-decision-integration.md §10d/§7c, T5/T6)", () => {
    beforeEach(() => {
      vi.mocked(probeDocuviaResolvable).mockReset();
    });

    it("reports PASS when no Docuvia post-commit hook is installed", async () => {
      const git = { readHookFile: vi.fn().mockResolvedValue(undefined) };
      docuviaFactory.register(TOKENS.GitProvider, () => git as any);
      docuviaFactory.register(TOKENS.DiagnosticRunnerGit, () => ({
        checkHealth: vi.fn().mockResolvedValue({}),
      }));

      const wf = new DoctorWorkflow("/test", logger);
      const result = await wf.execute({ skipDb: true, skipLogs: true });

      expect(result.diagnostics["git_hook"]).toEqual({
        status: DiagnosticStatus.PASS,
        message: "No Docuvia post-commit hook installed.",
      });
      expect(result.allPassed).toBe(true);
    });

    it("reports FAIL with the duplicate-block message and --fix suggestion when both markers are present", async () => {
      const hook =
        GitConstants.LEGACY_POST_COMMIT_HOOK_CONTENT +
        GitConstants.POST_COMMIT_HOOK_CONTENT;
      const git = { readHookFile: vi.fn().mockResolvedValue(hook) };
      docuviaFactory.register(TOKENS.GitProvider, () => git as any);

      const wf = new DoctorWorkflow("/test", logger);
      const result = await wf.execute({ skipDb: true, skipLogs: true });

      expect(result.diagnostics["git_hook"].status).toBe(DiagnosticStatus.FAIL);
      expect(result.diagnostics["git_hook"].message).toContain(
        "Duplicate hook blocks",
      );
      expect(result.diagnostics["git_hook"].suggestion).toContain(
        "doctor --fix",
      );
      expect(result.allPassed).toBe(false);
      expect(probeDocuviaResolvable).not.toHaveBeenCalled();
    });

    it("reports FAIL for a legacy-only hook (never upgraded)", async () => {
      const git = {
        readHookFile: vi
          .fn()
          .mockResolvedValue(GitConstants.LEGACY_POST_COMMIT_HOOK_CONTENT),
      };
      docuviaFactory.register(TOKENS.GitProvider, () => git as any);

      const wf = new DoctorWorkflow("/test", logger);
      const result = await wf.execute({ skipDb: true, skipLogs: true });

      expect(result.diagnostics["git_hook"].status).toBe(DiagnosticStatus.FAIL);
      expect(result.diagnostics["git_hook"].message).toContain(
        "legacy `docuvia snapshot`",
      );
      expect(result.diagnostics["git_hook"].suggestion).toContain(
        "docuvia init",
      );
    });

    it("reports FAIL for a current-shaped hook that predates the commit-l3-write flush step (issue #48)", async () => {
      const git = {
        readHookFile: vi
          .fn()
          .mockImplementation((_cwd: string, hookName: string) =>
            Promise.resolve(
              hookName === GitConstants.POST_COMMIT_HOOK_NAME
                ? GitConstants.PRE_FLUSH_L3_POST_COMMIT_HOOK_CONTENT
                : undefined,
            ),
          ),
      };
      docuviaFactory.register(TOKENS.GitProvider, () => git as any);

      const wf = new DoctorWorkflow("/test", logger);
      const result = await wf.execute({ skipDb: true, skipLogs: true });

      expect(result.diagnostics["git_hook"].status).toBe(DiagnosticStatus.FAIL);
      expect(result.diagnostics["git_hook"].message).toContain(
        "commit-l3-write flush step",
      );
      expect(result.diagnostics["git_hook"].suggestion).toContain(
        "docuvia init",
      );
      expect(result.allPassed).toBe(false);
      expect(probeDocuviaResolvable).not.toHaveBeenCalled();
    });

    it("reports PASS for a healthy hook when docuvia resolves", async () => {
      const git = {
        readHookFile: vi
          .fn()
          .mockResolvedValue(GitConstants.POST_COMMIT_HOOK_CONTENT),
        resolveHooksDir: vi.fn().mockResolvedValue("/test/.git/hooks"),
      };
      docuviaFactory.register(TOKENS.GitProvider, () => git as any);
      docuviaFactory.register(TOKENS.DiagnosticRunnerGit, () => ({
        checkHealth: vi.fn().mockResolvedValue({}),
      }));
      vi.mocked(probeDocuviaResolvable).mockResolvedValue(true);

      const wf = new DoctorWorkflow("/test", logger);
      const result = await wf.execute({ skipDb: true, skipLogs: true });

      expect(result.diagnostics["git_hook"]).toEqual({
        status: DiagnosticStatus.PASS,
        message: `Post-commit hook is installed and \`docuvia\` resolves (${path.join("/test/.git/hooks", "post-commit")}).`,
      });
      expect(result.allPassed).toBe(true);
    });

    it("reports FAIL for a healthy-shaped hook when docuvia is not resolvable", async () => {
      const git = {
        readHookFile: vi
          .fn()
          .mockResolvedValue(GitConstants.POST_COMMIT_HOOK_CONTENT),
      };
      docuviaFactory.register(TOKENS.GitProvider, () => git as any);
      vi.mocked(probeDocuviaResolvable).mockResolvedValue(false);

      const wf = new DoctorWorkflow("/test", logger);
      const result = await wf.execute({ skipDb: true, skipLogs: true });

      expect(result.diagnostics["git_hook"].status).toBe(DiagnosticStatus.FAIL);
      expect(result.diagnostics["git_hook"].message).toContain(
        "not resolvable",
      );
      expect(result.allPassed).toBe(false);
    });

    it("is skipped entirely when skipGit is set", async () => {
      const git = { readHookFile: vi.fn() };
      docuviaFactory.register(TOKENS.GitProvider, () => git as any);

      const wf = new DoctorWorkflow("/test", logger);
      const result = await wf.execute({
        skipDb: true,
        skipGit: true,
        skipLogs: true,
      });

      expect(git.readHookFile).not.toHaveBeenCalled();
      expect(result.diagnostics["git_hook"]).toBeUndefined();
    });

    describe("--fix (T6)", () => {
      it("does not call repairDuplicatePostCommitHook when fix is absent, even on a duplicate-block workspace", async () => {
        const hook =
          GitConstants.LEGACY_POST_COMMIT_HOOK_CONTENT +
          GitConstants.POST_COMMIT_HOOK_CONTENT;
        const git = { readHookFile: vi.fn().mockResolvedValue(hook) };
        const knowledgeGit = {
          repairDuplicatePostCommitHook: vi.fn(),
        };
        docuviaFactory.register(TOKENS.GitProvider, () => git as any);
        docuviaFactory.register(
          TOKENS.KnowledgeGitService,
          () => knowledgeGit as any,
        );

        const wf = new DoctorWorkflow("/test", logger);
        await wf.execute({ skipDb: true, skipLogs: true });

        expect(
          knowledgeGit.repairDuplicatePostCommitHook,
        ).not.toHaveBeenCalled();
      });

      it("calls repairDuplicatePostCommitHook and notes the repair when fix is true and the duplicate condition is present", async () => {
        const hook =
          GitConstants.LEGACY_POST_COMMIT_HOOK_CONTENT +
          GitConstants.POST_COMMIT_HOOK_CONTENT;
        const git = { readHookFile: vi.fn().mockResolvedValue(hook) };
        const knowledgeGit = {
          repairDuplicatePostCommitHook: vi
            .fn()
            .mockResolvedValue({ repaired: true }),
        };
        docuviaFactory.register(TOKENS.GitProvider, () => git as any);
        docuviaFactory.register(
          TOKENS.KnowledgeGitService,
          () => knowledgeGit as any,
        );

        const wf = new DoctorWorkflow("/test", logger);
        const result = await wf.execute({
          skipDb: true,
          skipLogs: true,
          fix: true,
        });

        expect(knowledgeGit.repairDuplicatePostCommitHook).toHaveBeenCalledWith(
          "/test",
        );
        expect(result.diagnostics["git_hook"].message).toContain("Repaired");
      });

      it("never calls repairDuplicatePostCommitHook when fix is true but the hook is healthy (not duplicated)", async () => {
        const git = {
          readHookFile: vi
            .fn()
            .mockResolvedValue(GitConstants.POST_COMMIT_HOOK_CONTENT),
          resolveHooksDir: vi.fn().mockResolvedValue("/test/.git/hooks"),
        };
        const knowledgeGit = {
          repairDuplicatePostCommitHook: vi.fn(),
        };
        docuviaFactory.register(TOKENS.GitProvider, () => git as any);
        docuviaFactory.register(
          TOKENS.KnowledgeGitService,
          () => knowledgeGit as any,
        );
        vi.mocked(probeDocuviaResolvable).mockResolvedValue(true);

        const wf = new DoctorWorkflow("/test", logger);
        await wf.execute({ skipDb: true, skipLogs: true, fix: true });

        expect(
          knowledgeGit.repairDuplicatePostCommitHook,
        ).not.toHaveBeenCalled();
      });
    });
  });

  describe("Pre-Push Hook Check (phase2-sync-knowledge-scheduling.md SKSCHED-005)", () => {
    it("reports PASS when no Docuvia pre-push hook is installed", async () => {
      const git = { readHookFile: vi.fn().mockResolvedValue(undefined) };
      docuviaFactory.register(TOKENS.GitProvider, () => git as any);
      docuviaFactory.register(TOKENS.DiagnosticRunnerGit, () => ({
        checkHealth: vi.fn().mockResolvedValue({}),
      }));

      const wf = new DoctorWorkflow("/test", logger);
      const result = await wf.execute({ skipDb: true, skipLogs: true });

      expect(result.diagnostics["pre_push_hook"]).toEqual({
        status: DiagnosticStatus.PASS,
        message: "No Docuvia pre-push hook installed.",
      });
      expect(result.allPassed).toBe(true);
    });

    it("reports FAIL for a pre-push hook installed before the sync-knowledge step was composed in", async () => {
      // Post-commit hook left uninstalled (undefined) -- isolates this assertion to the pre-push
      // check; the pre-push and post-commit marker strings overlap textually ("docuvia analyze"),
      // so a shared mock return value for both hookName args would falsely trip the post-commit
      // duplicate-block check too.
      const git = {
        readHookFile: vi
          .fn()
          .mockImplementation((_cwd: string, hookName: string) =>
            Promise.resolve(
              hookName === GitConstants.PRE_PUSH_HOOK_NAME
                ? GitConstants.LEGACY_PRE_PUSH_HOOK_CONTENT
                : undefined,
            ),
          ),
      };
      docuviaFactory.register(TOKENS.GitProvider, () => git as any);

      const wf = new DoctorWorkflow("/test", logger);
      const result = await wf.execute({ skipDb: true, skipLogs: true });

      expect(result.diagnostics["pre_push_hook"].status).toBe(
        DiagnosticStatus.FAIL,
      );
      expect(result.diagnostics["pre_push_hook"].message).toContain(
        "predates the `sync-knowledge` step",
      );
      expect(result.diagnostics["pre_push_hook"].suggestion).toContain(
        "docuvia init",
      );
      expect(result.allPassed).toBe(false);
    });

    it("reports FAIL for a pre-push hook that predates the `hooks check` gate (issue #48)", async () => {
      const git = {
        readHookFile: vi
          .fn()
          .mockImplementation((_cwd: string, hookName: string) =>
            Promise.resolve(
              hookName === GitConstants.PRE_PUSH_HOOK_NAME
                ? GitConstants.ENV_GATE_PRE_PUSH_HOOK_CONTENT
                : undefined,
            ),
          ),
      };
      docuviaFactory.register(TOKENS.GitProvider, () => git as any);

      const wf = new DoctorWorkflow("/test", logger);
      const result = await wf.execute({ skipDb: true, skipLogs: true });

      expect(result.diagnostics["pre_push_hook"].status).toBe(
        DiagnosticStatus.FAIL,
      );
      expect(result.diagnostics["pre_push_hook"].message).toContain(
        "`hooks check`",
      );
      expect(result.diagnostics["pre_push_hook"].suggestion).toContain(
        "docuvia init",
      );
      expect(result.allPassed).toBe(false);
    });

    it("reports FAIL for a sync-knowledge-era pre-push hook that predates the --fallback-ast env-gate (2026-07 C#/TS benchmark environment-detection follow-up)", async () => {
      const git = {
        readHookFile: vi
          .fn()
          .mockImplementation((_cwd: string, hookName: string) =>
            Promise.resolve(
              hookName === GitConstants.PRE_PUSH_HOOK_NAME
                ? GitConstants.SYNC_KNOWLEDGE_PRE_PUSH_HOOK_CONTENT
                : undefined,
            ),
          ),
      };
      docuviaFactory.register(TOKENS.GitProvider, () => git as any);

      const wf = new DoctorWorkflow("/test", logger);
      const result = await wf.execute({ skipDb: true, skipLogs: true });

      expect(result.diagnostics["pre_push_hook"].status).toBe(
        DiagnosticStatus.FAIL,
      );
      expect(result.diagnostics["pre_push_hook"].message).toContain(
        "predates the --fallback-ast env-gate flag",
      );
      expect(result.diagnostics["pre_push_hook"].suggestion).toContain(
        "docuvia init",
      );
      expect(result.allPassed).toBe(false);
    });

    it("reports PASS when the pre-push hook includes the sync-knowledge step and docuvia resolves", async () => {
      const git = {
        readHookFile: vi
          .fn()
          .mockImplementation((_cwd: string, hookName: string) =>
            Promise.resolve(
              hookName === GitConstants.PRE_PUSH_HOOK_NAME
                ? GitConstants.PRE_PUSH_HOOK_CONTENT
                : undefined,
            ),
          ),
        resolveHooksDir: vi.fn().mockResolvedValue("/test/.git/hooks"),
      };
      docuviaFactory.register(TOKENS.GitProvider, () => git as any);
      docuviaFactory.register(TOKENS.DiagnosticRunnerGit, () => ({
        checkHealth: vi.fn().mockResolvedValue({}),
      }));
      vi.mocked(probeDocuviaResolvable).mockResolvedValue(true);

      const wf = new DoctorWorkflow("/test", logger);
      const result = await wf.execute({ skipDb: true, skipLogs: true });

      expect(result.diagnostics["pre_push_hook"]).toEqual({
        status: DiagnosticStatus.PASS,
        message: `Pre-push hook is installed and includes the sync-knowledge step (${path.join("/test/.git/hooks", "pre-push")}).`,
      });
      expect(result.allPassed).toBe(true);
    });

    it("reports FAIL for a healthy-shaped pre-push hook when docuvia is not resolvable (regression: dogfooding Docuvia2 on itself found a hook that silently no-oped every push)", async () => {
      const git = {
        readHookFile: vi
          .fn()
          .mockImplementation((_cwd: string, hookName: string) =>
            Promise.resolve(
              hookName === GitConstants.PRE_PUSH_HOOK_NAME
                ? GitConstants.PRE_PUSH_HOOK_CONTENT
                : undefined,
            ),
          ),
      };
      docuviaFactory.register(TOKENS.GitProvider, () => git as any);
      vi.mocked(probeDocuviaResolvable).mockResolvedValue(false);

      const wf = new DoctorWorkflow("/test", logger);
      const result = await wf.execute({ skipDb: true, skipLogs: true });

      expect(result.diagnostics["pre_push_hook"].status).toBe(
        DiagnosticStatus.FAIL,
      );
      expect(result.diagnostics["pre_push_hook"].message).toContain(
        "not resolvable",
      );
      expect(result.allPassed).toBe(false);
    });

    it("is skipped entirely when skipGit is set", async () => {
      const git = { readHookFile: vi.fn() };
      docuviaFactory.register(TOKENS.GitProvider, () => git as any);

      const wf = new DoctorWorkflow("/test", logger);
      const result = await wf.execute({
        skipDb: true,
        skipGit: true,
        skipLogs: true,
      });

      expect(result.diagnostics["pre_push_hook"]).toBeUndefined();
    });
  });

  describe("LLM Reachability Check (phase1-decision-integration.md §10e bullet 3, T7)", () => {
    it("reports PASS 'not configured' when no llmBaseUrl is supplied", async () => {
      const wf = new DoctorWorkflow("/test", logger);
      const result = await wf.execute({
        skipDb: true,
        skipGit: true,
        skipLogs: true,
      });

      expect(result.diagnostics["llm_reachability"]).toEqual({
        status: DiagnosticStatus.PASS,
        message: expect.stringContaining("Not configured"),
      });
      expect(result.allPassed).toBe(true);
    });

    it("reports PASS 'reachable' when configured and checkAvailability resolves available:true", async () => {
      const llmClient = {
        initialize: vi.fn(),
        chatCompletion: vi.fn(),
        streamChatCompletion: vi.fn(),
        checkAvailability: vi.fn().mockResolvedValue({ available: true }),
      };
      docuviaFactory.register(TOKENS.LlmClient, () => () => llmClient as any);

      const wf = new DoctorWorkflow("/test", logger);
      const result = await wf.execute({
        skipDb: true,
        skipGit: true,
        skipLogs: true,
        llmBaseUrl: "http://127.0.0.1:8317",
      });

      expect(llmClient.initialize).toHaveBeenCalledWith({
        baseUrl: "http://127.0.0.1:8317",
        apiKey: undefined,
      });
      expect(result.diagnostics["llm_reachability"].status).toBe(
        DiagnosticStatus.PASS,
      );
      expect(result.allPassed).toBe(true);
    });

    it("reports FAIL when configured but unreachable -- the one real defect this check reports", async () => {
      const llmClient = {
        initialize: vi.fn(),
        chatCompletion: vi.fn(),
        streamChatCompletion: vi.fn(),
        checkAvailability: vi
          .fn()
          .mockResolvedValue({ available: false, reason: "ECONNREFUSED" }),
      };
      docuviaFactory.register(TOKENS.LlmClient, () => () => llmClient as any);

      const wf = new DoctorWorkflow("/test", logger);
      const result = await wf.execute({
        skipDb: true,
        skipGit: true,
        skipLogs: true,
        llmBaseUrl: "http://127.0.0.1:8317",
      });

      expect(result.diagnostics["llm_reachability"].status).toBe(
        DiagnosticStatus.FAIL,
      );
      expect(result.diagnostics["llm_reachability"].message).toContain(
        "ECONNREFUSED",
      );
      expect(result.allPassed).toBe(false);
    });

    it("skips the check entirely (no diagnostic key, checkAvailability never called) when skipLlm is set -- escape hatch for callers spawning several doctor processes at once (e.g. SQLite concurrency tests), where simultaneous real network probes can time out under contention", async () => {
      const llmClient = {
        initialize: vi.fn(),
        chatCompletion: vi.fn(),
        streamChatCompletion: vi.fn(),
        checkAvailability: vi
          .fn()
          .mockResolvedValue({ available: false, reason: "timeout" }),
      };
      docuviaFactory.register(TOKENS.LlmClient, () => () => llmClient as any);

      const wf = new DoctorWorkflow("/test", logger);
      const result = await wf.execute({
        skipDb: true,
        skipGit: true,
        skipLogs: true,
        skipLlm: true,
        llmBaseUrl: "http://127.0.0.1:8317",
      });

      expect(result.diagnostics["llm_reachability"]).toBeUndefined();
      expect(llmClient.checkAvailability).not.toHaveBeenCalled();
      expect(result.allPassed).toBe(true);
    });
  });

  describe("LSP Binary Check (phase1-decision-integration.md §10e bullet 4 / §7a-1, T8; multi-language-lsp-support plan, Finding A/G)", () => {
    it("reports PASS with the positive message, keyed by language id, when the registered provider reports available", async () => {
      const provider = {
        name: "typescript-language-server",
        checkAvailability: vi.fn().mockResolvedValue({ available: true }),
      };
      docuviaFactory.register(TOKENS.EdgeResolutionProviders, () => ({
        typescript: () => provider as any,
      }));

      const wf = new DoctorWorkflow("/test", logger);
      const result = await wf.execute({
        skipDb: true,
        skipGit: true,
        skipLogs: true,
      });

      expect(result.diagnostics["lsp_binary_typescript"]).toEqual({
        status: DiagnosticStatus.PASS,
        message: expect.stringContaining("LSP-precision edges available"),
      });
      expect(provider.checkAvailability).toHaveBeenCalledWith("/test");
    });

    it("regression: reports FAIL (not PASS) with the specific unavailable reason when the provider reports unavailable -- an unready LSP environment must fail doctor, not just inform, so a bad environment is caught before a wasted/inaccurate analyze --escalate-to-lsp run", async () => {
      const provider = {
        name: "typescript-language-server",
        checkAvailability: vi.fn().mockResolvedValue({
          available: false,
          reason: "node_modules not found",
        }),
      };
      docuviaFactory.register(TOKENS.EdgeResolutionProviders, () => ({
        typescript: () => provider as any,
      }));

      const wf = new DoctorWorkflow("/test", logger);
      const result = await wf.execute({
        skipDb: true,
        skipGit: true,
        skipLogs: true,
      });

      expect(result.diagnostics["lsp_binary_typescript"].status).toBe(
        DiagnosticStatus.FAIL,
      );
      expect(result.diagnostics["lsp_binary_typescript"].message).toContain(
        "node_modules not found",
      );
      expect(result.diagnostics["lsp_binary_typescript"].suggestion).toBe(
        DOCTOR_MESSAGES.LSP_BINARY_UNAVAILABLE_SUGGESTION,
      );
      expect(result.allPassed).toBe(false);
    });

    it("reports one diagnostic line per registered language when more than one provider is registered", async () => {
      const tsProvider = {
        name: "typescript-language-server",
        checkAvailability: vi.fn().mockResolvedValue({ available: true }),
      };
      const pyProvider = {
        name: "pyright",
        checkAvailability: vi
          .fn()
          .mockResolvedValue({ available: false, reason: "not installed" }),
      };
      docuviaFactory.register(TOKENS.EdgeResolutionProviders, () => ({
        typescript: () => tsProvider as any,
        python: () => pyProvider as any,
      }));

      const wf = new DoctorWorkflow("/test", logger);
      const result = await wf.execute({
        skipDb: true,
        skipGit: true,
        skipLogs: true,
      });

      expect(result.diagnostics["lsp_binary_typescript"].message).toContain(
        "LSP-precision edges available (typescript-language-server resolved)",
      );
      expect(result.diagnostics["lsp_binary_python"].message).toContain(
        "not installed",
      );
    });

    it("regression: doesn't fail (or even check) a registered language that isn't actually queued, so a TypeScript-only project never fails doctor over an unrelated language's missing LSP binary (Finding G scoping, shared with checkTierBGate)", async () => {
      const metaMap = new Map<string, string>();
      const store = {
        meta: {
          get: (key: string) => metaMap.get(key),
          set: (key: string, value: string) => {
            metaMap.set(key, value);
          },
        },
        close: vi.fn().mockResolvedValue(undefined),
      } as any;
      appendTierBQueueEntries(store, [{ file: "a.ts", commitSha: "sha1" }]);
      docuviaFactory.register(TOKENS.GraphStoreOpener, () =>
        vi.fn().mockResolvedValue(store),
      );

      const tsCheck = vi.fn().mockResolvedValue({ available: true });
      const pyCheck = vi.fn().mockResolvedValue({
        available: false,
        reason: "pyright not installed",
      });
      docuviaFactory.register(TOKENS.EdgeResolutionProviders, () => ({
        typescript: () =>
          ({
            name: "typescript-language-server",
            checkAvailability: tsCheck,
          }) as any,
        python: () => ({ name: "pyright", checkAvailability: pyCheck }) as any,
      }));

      const wf = new DoctorWorkflow("/test", logger);
      const result = await wf.execute({
        skipDb: true,
        skipGit: true,
        skipLogs: true,
      });

      expect(result.diagnostics["lsp_binary_typescript"].status).toBe(
        DiagnosticStatus.PASS,
      );
      expect(result.diagnostics["lsp_binary_python"]).toBeUndefined();
      expect(pyCheck).not.toHaveBeenCalled();
    });

    it("is skipped silently (no diagnostic key, no crash) when EdgeResolutionProviders isn't registered", async () => {
      const wf = new DoctorWorkflow("/test", logger);
      const result = await wf.execute({
        skipDb: true,
        skipGit: true,
        skipLogs: true,
      });

      expect(result.diagnostics["lsp_binary_typescript"]).toBeUndefined();
    });

    it("skips the check entirely (no diagnostic key, provider never called) when skipLsp is set -- escape hatch for fixtures that deliberately have no LSP environment (e.g. SQLite concurrency tests)", async () => {
      const tsCheck = vi.fn().mockResolvedValue({
        available: false,
        reason: "node_modules not found",
      });
      docuviaFactory.register(TOKENS.EdgeResolutionProviders, () => ({
        typescript: () =>
          ({
            name: "typescript-language-server",
            checkAvailability: tsCheck,
          }) as any,
      }));

      const wf = new DoctorWorkflow("/test", logger);
      const result = await wf.execute({
        skipDb: true,
        skipGit: true,
        skipLogs: true,
        skipLsp: true,
      });

      expect(result.diagnostics["lsp_binary_typescript"]).toBeUndefined();
      expect(tsCheck).not.toHaveBeenCalled();
      expect(result.allPassed).toBe(true);
    });
  });
});
