import { describe, it, expect, vi, beforeEach } from "vitest";
import { DoctorWorkflow } from "../../src/workflows/doctor/doctor-workflow.js";
import {
  docuviaFactory,
  TOKENS,
  DiagnosticStatus,
  DocuviaError,
} from "@workspace/contracts";
import {
  GitConstants,
  L3DecisionSources,
  ANALYZE_LOG_FILE_NAME,
  DOCUVIA_DIR_NAME,
  DOCUVIA_LOGS_DIR_NAME,
} from "@workspace/contracts";
import * as fs from "fs/promises";
import * as path from "path";
import { probeDocuviaResolvable } from "../../src/workflows/doctor/git-hook-resolvability.js";
import { DOCTOR_MESSAGES } from "../../src/workflows/doctor/doctor-messages.js";
import { appendTierBQueueEntries } from "../../src/workflows/analyze/tier-b-queue.js";
import { TierCCandidateKinds } from "../../src/workflows/analyze/tier-c-queue.js";
import { ANALYZE_EVENTS } from "../../src/workflows/analyze/analyze-messages.js";

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
          "Not configured -- Tier C is inactive (AI_DOCUVIA_INTEGRATIONS_OPENAI_BASE_URL or AI_DOCUVIA_MODEL not set).",
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

  describe("Post-Commit Ingestion Check (issue #58)", () => {
    function registerPassingDbAndGitRunners() {
      vi.mocked(fs.stat).mockResolvedValue({} as any);
      docuviaFactory.register(TOKENS.DiagnosticRunnerDb, () => ({
        checkHealth: vi.fn().mockResolvedValue({}),
      }));
      docuviaFactory.register(TOKENS.DiagnosticRunnerGit, () => ({
        checkHealth: vi.fn().mockResolvedValue({}),
      }));
    }

    function registerGit(headSha: string | undefined) {
      docuviaFactory.register(
        TOKENS.GitProvider,
        () => ({ getHeadSha: vi.fn().mockResolvedValue(headSha) }) as any,
      );
    }

    function makeMockStore(meta: Record<string, string>) {
      return {
        projects: { getFirst: vi.fn().mockReturnValue({ id: 1 }) },
        graph: {
          count: vi.fn().mockReturnValue({ l2Nodes: 1, l3Nodes: 0 }),
        },
        meta: {
          get: vi.fn((key: string) => meta[key]),
          set: vi.fn(),
        },
        close: vi.fn().mockResolvedValue(undefined),
      };
    }

    it("is skipped silently (no diagnostic key, no crash) when GraphStoreOpener isn't registered", async () => {
      registerPassingDbAndGitRunners();

      const wf = new DoctorWorkflow("/test", logger);
      const result = await wf.execute({ skipLogs: true });

      expect(result.diagnostics["post_commit_ingestion"]).toBeUndefined();
    });

    it("is skipped silently (no diagnostic key, no crash) when GitProvider isn't registered", async () => {
      registerPassingDbAndGitRunners();
      const store = makeMockStore({});
      docuviaFactory.register(TOKENS.GraphStoreOpener, () =>
        vi.fn().mockResolvedValue(store),
      );

      const wf = new DoctorWorkflow("/test", logger);
      const result = await wf.execute({ skipLogs: true });

      expect(result.diagnostics["post_commit_ingestion"]).toBeUndefined();
    });

    it("is not evaluated at all when skipDb is set", async () => {
      const store = makeMockStore({});
      const openStore = vi.fn().mockResolvedValue(store);
      docuviaFactory.register(TOKENS.GraphStoreOpener, () => openStore);
      registerGit("aaa111");

      const wf = new DoctorWorkflow("/test", logger);
      await wf.execute({ skipDb: true, skipLogs: true });

      expect(openStore).not.toHaveBeenCalled();
    });

    it("reports PASS when lastIngestedSourceSha equals HEAD (graph fully up to date)", async () => {
      registerPassingDbAndGitRunners();
      const store = makeMockStore({
        [GitConstants.META_KEY_LAST_INGESTED_SOURCE_SHA]: "aaa111aaa111",
      });
      docuviaFactory.register(TOKENS.GraphStoreOpener, () =>
        vi.fn().mockResolvedValue(store),
      );
      registerGit("aaa111aaa111");

      const wf = new DoctorWorkflow("/test", logger);
      const result = await wf.execute({ skipLogs: true });

      expect(result.diagnostics["post_commit_ingestion"]).toEqual({
        status: DiagnosticStatus.PASS,
        message:
          "Knowledge graph is up to date with HEAD (Tier C queue: 0 pending).",
      });
      expect(result.allPassed).toBe(true);
      expect(store.close).toHaveBeenCalled();
    });

    it("reports PASS with a note when behind HEAD but analyze.log shows recent activity (in-flight post-commit run)", async () => {
      registerPassingDbAndGitRunners();
      const store = makeMockStore({
        [GitConstants.META_KEY_LAST_INGESTED_SOURCE_SHA]: "bbb222bbb222",
      });
      docuviaFactory.register(TOKENS.GraphStoreOpener, () =>
        vi.fn().mockResolvedValue(store),
      );
      registerGit("aaa111aaa111");
      vi.mocked(fs.readFile).mockResolvedValue(
        JSON.stringify({
          ts: new Date().toISOString(),
          event: "analyze.delta.summary",
        }) + "\n",
      );

      const wf = new DoctorWorkflow("/test", logger);
      const result = await wf.execute({ skipLogs: true });

      expect(result.diagnostics["post_commit_ingestion"].status).toBe(
        DiagnosticStatus.PASS,
      );
      expect(result.diagnostics["post_commit_ingestion"].message).toContain(
        "recently",
      );
      expect(result.allPassed).toBe(true);
    });

    it("reports FAIL when behind HEAD and no analyze.log exists -- issue #58's exact repro (stale sha, no delta activity)", async () => {
      registerPassingDbAndGitRunners();
      const store = makeMockStore({
        [GitConstants.META_KEY_LAST_INGESTED_SOURCE_SHA]: "bbb222bbb222",
      });
      docuviaFactory.register(TOKENS.GraphStoreOpener, () =>
        vi.fn().mockResolvedValue(store),
      );
      registerGit("aaa111aaa111");
      vi.mocked(fs.readFile).mockRejectedValue(new Error("ENOENT"));

      const wf = new DoctorWorkflow("/test", logger);
      const result = await wf.execute({ skipLogs: true });

      expect(result.diagnostics["post_commit_ingestion"].status).toBe(
        DiagnosticStatus.FAIL,
      );
      expect(result.diagnostics["post_commit_ingestion"].message).toContain(
        "post-commit hook",
      );
      expect(result.diagnostics["post_commit_ingestion"].suggestion).toContain(
        "docuvia analyze",
      );
      expect(result.allPassed).toBe(false);
    });

    it("reports FAIL when behind HEAD and analyze.log's newest activity is older than the grace window", async () => {
      registerPassingDbAndGitRunners();
      const store = makeMockStore({
        [GitConstants.META_KEY_LAST_INGESTED_SOURCE_SHA]: "bbb222bbb222",
      });
      docuviaFactory.register(TOKENS.GraphStoreOpener, () =>
        vi.fn().mockResolvedValue(store),
      );
      registerGit("aaa111aaa111");
      vi.mocked(fs.readFile).mockResolvedValue(
        JSON.stringify({
          ts: new Date(Date.now() - 3_600_000).toISOString(),
          event: "analyze.delta.summary",
        }) + "\n",
      );

      const wf = new DoctorWorkflow("/test", logger);
      const result = await wf.execute({ skipLogs: true });

      expect(result.diagnostics["post_commit_ingestion"].status).toBe(
        DiagnosticStatus.FAIL,
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
      registerGit("aaa111aaa111");

      const wf = new DoctorWorkflow("/test", logger);
      const result = await wf.execute({ skipLogs: true });

      expect(result.diagnostics["post_commit_ingestion"]).toBeUndefined();
    });

    it("is skipped silently on an unborn/headless HEAD (no commit to compare against)", async () => {
      registerPassingDbAndGitRunners();
      const store = makeMockStore({});
      docuviaFactory.register(TOKENS.GraphStoreOpener, () =>
        vi.fn().mockResolvedValue(store),
      );
      registerGit(undefined);

      const wf = new DoctorWorkflow("/test", logger);
      const result = await wf.execute({ skipLogs: true });

      expect(result.diagnostics["post_commit_ingestion"]).toBeUndefined();
      expect(result.allPassed).toBe(true);
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

    it("reports PASS 'reachable' when configured and checkBridgeReachability resolves available:true (issue #134 -- probes the same /v1/chat/completions route Tier C's drain dials, not a bare-baseUrl GET)", async () => {
      const llmClient = {
        initialize: vi.fn(),
        chatCompletion: vi.fn(),
        streamChatCompletion: vi.fn(),
        checkBridgeReachability: vi.fn().mockResolvedValue({ available: true }),
      };
      docuviaFactory.register(TOKENS.LlmClient, () => () => llmClient as any);

      const wf = new DoctorWorkflow("/test", logger);
      const result = await wf.execute({
        skipDb: true,
        skipGit: true,
        skipLogs: true,
        llmBaseUrl: "http://127.0.0.1:8317",
        llmModel: "gpt-4o-mini",
      });

      expect(llmClient.initialize).toHaveBeenCalledWith({
        baseUrl: "http://127.0.0.1:8317",
        apiKey: undefined,
      });
      expect(llmClient.checkBridgeReachability).toHaveBeenCalledWith(
        "gpt-4o-mini",
      );
      expect(result.diagnostics["llm_reachability"].status).toBe(
        DiagnosticStatus.PASS,
      );
      expect(result.allPassed).toBe(true);
    });

    it("reports PASS 'not configured' when a baseUrl is supplied but no model is (the bridge probe needs a model to dial the completions route)", async () => {
      const llmClient = {
        initialize: vi.fn(),
        chatCompletion: vi.fn(),
        streamChatCompletion: vi.fn(),
        checkBridgeReachability: vi.fn(),
      };
      docuviaFactory.register(TOKENS.LlmClient, () => () => llmClient as any);

      const wf = new DoctorWorkflow("/test", logger);
      const result = await wf.execute({
        skipDb: true,
        skipGit: true,
        skipLogs: true,
        llmBaseUrl: "http://127.0.0.1:8317",
      });

      expect(llmClient.checkBridgeReachability).not.toHaveBeenCalled();
      expect(result.diagnostics["llm_reachability"]).toEqual({
        status: DiagnosticStatus.PASS,
        message: expect.stringContaining("Not configured"),
      });
      expect(result.allPassed).toBe(true);
    });

    it("reports FAIL when configured but the bridge rejects the probe -- the one real defect this check reports (issue #134's live repro)", async () => {
      const llmClient = {
        initialize: vi.fn(),
        chatCompletion: vi.fn(),
        streamChatCompletion: vi.fn(),
        checkBridgeReachability: vi
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
        llmModel: "gpt-4o-mini",
      });

      expect(result.diagnostics["llm_reachability"].status).toBe(
        DiagnosticStatus.FAIL,
      );
      expect(result.diagnostics["llm_reachability"].message).toContain(
        "ECONNREFUSED",
      );
      expect(result.diagnostics["llm_reachability"].suggestion).toBe(
        DOCTOR_MESSAGES.LLM_UNREACHABLE_SUGGESTION,
      );
      expect(result.allPassed).toBe(false);
    });

    it("skips the check entirely (no diagnostic key, checkBridgeReachability never called) when skipLlm is set -- escape hatch for callers spawning several doctor processes at once (e.g. SQLite concurrency tests), where simultaneous real network probes can time out under contention", async () => {
      const llmClient = {
        initialize: vi.fn(),
        chatCompletion: vi.fn(),
        streamChatCompletion: vi.fn(),
        checkBridgeReachability: vi
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
        llmModel: "gpt-4o-mini",
      });

      expect(result.diagnostics["llm_reachability"]).toBeUndefined();
      expect(llmClient.checkBridgeReachability).not.toHaveBeenCalled();
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

  describe("Tier C Queue Check (issue #134 -- the stuck-queue half llm_reachability can't see)", () => {
    function registerPassingDbRunners() {
      vi.mocked(fs.stat).mockResolvedValue({} as any);
      docuviaFactory.register(TOKENS.DiagnosticRunnerDb, () => ({
        checkHealth: vi.fn().mockResolvedValue({}),
      }));
    }

    function makeMockStore(queue: unknown[]) {
      const metaMap = new Map<string, string>();
      if (queue.length > 0) {
        metaMap.set(GitConstants.META_KEY_TIER_C_QUEUE, JSON.stringify(queue));
      }
      return {
        projects: { getFirst: vi.fn().mockReturnValue({ id: 1 }) },
        graph: {
          count: vi.fn().mockReturnValue({ l2Nodes: 1, l3Nodes: 0 }),
          getSemanticCoverage: vi.fn().mockReturnValue({
            totalNodes: 1,
            describedNodes: 1,
          }),
        },
        files: {
          getTierBCoverage: vi.fn().mockReturnValue({
            totalFiles: 1,
            processedFiles: 1,
          }),
        },
        l3: { getAllExportable: vi.fn().mockReturnValue([]) },
        meta: {
          get: vi.fn((key: string) => metaMap.get(key)),
          set: vi.fn((key: string, value: string) => {
            metaMap.set(key, value);
          }),
        },
        close: vi.fn().mockResolvedValue(undefined),
      };
    }

    function registerStore(queue: unknown[]) {
      const store = makeMockStore(queue);
      docuviaFactory.register(TOKENS.GraphStoreOpener, () =>
        vi.fn().mockResolvedValue(store),
      );
      return store;
    }

    it("is skipped silently (no diagnostic key, no crash) when GraphStoreOpener isn't registered", async () => {
      registerPassingDbRunners();

      const wf = new DoctorWorkflow("/test", logger);
      const result = await wf.execute({ skipGit: true, skipLogs: true });

      expect(result.diagnostics["tier_c_queue"]).toBeUndefined();
    });

    it("is not evaluated at all when skipDb is set", async () => {
      const openStore = vi.fn();
      docuviaFactory.register(TOKENS.GraphStoreOpener, () => openStore);

      const wf = new DoctorWorkflow("/test", logger);
      await wf.execute({ skipDb: true, skipGit: true, skipLogs: true });

      expect(openStore).not.toHaveBeenCalled();
    });

    it("reports PASS when the queue is empty", async () => {
      registerPassingDbRunners();
      registerStore([]);

      const wf = new DoctorWorkflow("/test", logger);
      const result = await wf.execute({ skipGit: true, skipLogs: true });

      expect(result.diagnostics["tier_c_queue"]).toEqual({
        status: DiagnosticStatus.PASS,
        message: "Tier C queue: 0 pending, last drain processed 0 item(s).",
      });
      expect(result.allPassed).toBe(true);
    });

    it("reports FAIL (never drained) when the queue is non-empty but analyze.log has no tierC.summary -- a queue that has sat forever with zero evidence of a drain", async () => {
      registerPassingDbRunners();
      registerStore([
        {
          kind: TierCCandidateKinds.COMMIT_MESSAGE,
          target: "sha1",
          commitSha: "sha1",
        },
      ]);
      vi.mocked(fs.readFile).mockRejectedValue(new Error("ENOENT"));

      const wf = new DoctorWorkflow("/test", logger);
      const result = await wf.execute({ skipGit: true, skipLogs: true });

      expect(result.diagnostics["tier_c_queue"].status).toBe(
        DiagnosticStatus.FAIL,
      );
      expect(result.diagnostics["tier_c_queue"].message).toContain(
        "no drain has ever completed",
      );
      expect(result.allPassed).toBe(false);
    });

    it("reports FAIL (stuck) when the queue is non-empty and the last drain processed 0, surfacing the item_failed reason -- issue #134's exact `bridge-unreachable` repro", async () => {
      registerPassingDbRunners();
      registerStore([
        {
          kind: TierCCandidateKinds.COMMIT_MESSAGE,
          target: "sha1",
          commitSha: "sha1",
        },
      ]);
      vi.mocked(fs.readFile).mockResolvedValue(
        JSON.stringify({
          event: ANALYZE_EVENTS.TIER_C_ITEM_FAILED,
          reason: "bridge-unreachable",
        }) +
          "\n" +
          JSON.stringify({
            event: ANALYZE_EVENTS.TIER_C_SUMMARY,
            processed: 0,
            persisted: 0,
          }) +
          "\n",
      );

      const wf = new DoctorWorkflow("/test", logger);
      const result = await wf.execute({ skipGit: true, skipLogs: true });

      expect(result.diagnostics["tier_c_queue"].status).toBe(
        DiagnosticStatus.FAIL,
      );
      expect(result.diagnostics["tier_c_queue"].message).toContain(
        "bridge-unreachable",
      );
      expect(result.diagnostics["tier_c_queue"].message).toContain("1 pending");
      expect(result.allPassed).toBe(false);
    });

    it("reports PASS when the queue is non-empty and the last drain actually processed items", async () => {
      registerPassingDbRunners();
      registerStore([
        {
          kind: TierCCandidateKinds.COMMIT_MESSAGE,
          target: "sha1",
          commitSha: "sha1",
        },
      ]);
      vi.mocked(fs.readFile).mockResolvedValue(
        JSON.stringify({
          event: ANALYZE_EVENTS.TIER_C_SUMMARY,
          processed: 5,
          persisted: 5,
        }) + "\n",
      );

      const wf = new DoctorWorkflow("/test", logger);
      const result = await wf.execute({ skipGit: true, skipLogs: true });

      expect(result.diagnostics["tier_c_queue"].status).toBe(
        DiagnosticStatus.PASS,
      );
      expect(result.diagnostics["tier_c_queue"].message).toContain("5 item(s)");
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

      expect(result.diagnostics["tier_c_queue"]).toBeUndefined();
      expect(result.diagnostics["db_found"].status).toBe(DiagnosticStatus.FAIL);
    });
  });

  describe("L2 Semantic Coverage Check (issue #135 -- the semantically-empty graph graph_empty can't see)", () => {
    function registerPassingDbRunners() {
      vi.mocked(fs.stat).mockResolvedValue({} as any);
      docuviaFactory.register(TOKENS.DiagnosticRunnerDb, () => ({
        checkHealth: vi.fn().mockResolvedValue({}),
      }));
    }

    function makeMockStore(coverage: {
      totalNodes: number;
      describedNodes: number;
    }) {
      return {
        projects: { getFirst: vi.fn().mockReturnValue({ id: 1 }) },
        graph: {
          count: vi.fn().mockReturnValue({ l2Nodes: 1, l3Nodes: 0 }),
          getSemanticCoverage: vi.fn().mockReturnValue(coverage),
        },
        files: {
          getTierBCoverage: vi.fn().mockReturnValue({
            totalFiles: 1,
            processedFiles: 1,
          }),
        },
        l3: { getAllExportable: vi.fn().mockReturnValue([]) },
        meta: {
          get: vi.fn().mockReturnValue(undefined),
          set: vi.fn(),
        },
        close: vi.fn().mockResolvedValue(undefined),
      };
    }

    function registerStore(coverage: {
      totalNodes: number;
      describedNodes: number;
    }) {
      const store = makeMockStore(coverage);
      docuviaFactory.register(TOKENS.GraphStoreOpener, () =>
        vi.fn().mockResolvedValue(store),
      );
      return store;
    }

    it("is skipped silently (no diagnostic key, no crash) when GraphStoreOpener isn't registered", async () => {
      registerPassingDbRunners();

      const wf = new DoctorWorkflow("/test", logger);
      const result = await wf.execute({ skipGit: true, skipLogs: true });

      expect(result.diagnostics["l2_semantic_coverage"]).toBeUndefined();
    });

    it("is not evaluated at all when skipDb is set", async () => {
      const openStore = vi.fn();
      docuviaFactory.register(TOKENS.GraphStoreOpener, () => openStore);

      const wf = new DoctorWorkflow("/test", logger);
      await wf.execute({ skipDb: true, skipGit: true, skipLogs: true });

      expect(openStore).not.toHaveBeenCalled();
    });

    it("reports PASS with the coverage counts when coverage is at or above the threshold", async () => {
      registerPassingDbRunners();
      const store = registerStore({ totalNodes: 1000, describedNodes: 200 });

      const wf = new DoctorWorkflow("/test", logger);
      const result = await wf.execute({ skipGit: true, skipLogs: true });

      expect(result.diagnostics["l2_semantic_coverage"]).toEqual({
        status: DiagnosticStatus.PASS,
        message: "L2 semantic coverage: 200/1000 node(s) carry a description.",
      });
      expect(result.allPassed).toBe(true);
      expect(store.close).toHaveBeenCalled();
    });

    it("reports FAIL with an actionable suggestion when coverage is below the threshold AND Tier C is configured -- issue #135's 0/6285 live state", async () => {
      registerPassingDbRunners();
      registerStore({ totalNodes: 6285, describedNodes: 0 });

      const wf = new DoctorWorkflow("/test", logger);
      const result = await wf.execute({
        skipGit: true,
        skipLogs: true,
        llmBaseUrl: "http://127.0.0.1:8317",
      });

      expect(result.diagnostics["l2_semantic_coverage"].status).toBe(
        DiagnosticStatus.FAIL,
      );
      expect(result.diagnostics["l2_semantic_coverage"].message).toContain(
        "0/6285",
      );
      expect(result.diagnostics["l2_semantic_coverage"].suggestion).toBe(
        DOCTOR_MESSAGES.L2_SEMANTIC_COVERAGE_LOW_SUGGESTION,
      );
      expect(result.allPassed).toBe(false);
    });

    it("reports a visible PASS for low coverage when Tier C is NOT configured -- structural-only is a legitimate state (descriptions can't be written without an LLM bridge), never a permanent red", async () => {
      registerPassingDbRunners();
      registerStore({ totalNodes: 6285, describedNodes: 0 });

      const wf = new DoctorWorkflow("/test", logger);
      const result = await wf.execute({ skipGit: true, skipLogs: true });

      expect(result.diagnostics["l2_semantic_coverage"]).toEqual({
        status: DiagnosticStatus.PASS,
        message:
          "L2 semantic coverage: 0/6285 node(s) carry a description (structural-only graph -- Tier C LLM enrichment is not configured, so descriptions cannot be written yet).",
      });
      expect(result.allPassed).toBe(true);
    });

    it("reports PASS for an empty graph (totalNodes 0 is treated as full coverage, not a semantic defect -- graph_empty owns the empty-graph verdict)", async () => {
      registerPassingDbRunners();
      registerStore({ totalNodes: 0, describedNodes: 0 });

      const wf = new DoctorWorkflow("/test", logger);
      const result = await wf.execute({ skipGit: true, skipLogs: true });

      expect(result.diagnostics["l2_semantic_coverage"].status).toBe(
        DiagnosticStatus.PASS,
      );
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

      expect(result.diagnostics["l2_semantic_coverage"]).toBeUndefined();
      expect(result.diagnostics["db_found"].status).toBe(DiagnosticStatus.FAIL);
    });
  });

  describe("Worktree Divergence Check (issue #137 -- per-worktree knowledge-graph fragmentation)", () => {
    function registerPassingGitRunners() {
      vi.mocked(fs.stat).mockRejectedValue(new Error("ENOENT"));
      docuviaFactory.register(TOKENS.DiagnosticRunnerGit, () => ({
        checkHealth: vi.fn().mockResolvedValue({}),
      }));
    }

    function registerGit(worktrees: { path: string; branch?: string }[]) {
      docuviaFactory.register(
        TOKENS.GitProvider,
        () => ({ listWorktrees: vi.fn().mockResolvedValue(worktrees) }) as any,
      );
    }

    it("is skipped silently (no diagnostic key, no crash) when GitProvider isn't registered", async () => {
      registerPassingGitRunners();

      const wf = new DoctorWorkflow("/test", logger);
      const result = await wf.execute({ skipDb: true, skipLogs: true });

      expect(result.diagnostics["worktree_divergence"]).toBeUndefined();
    });

    it("is not evaluated at all when skipGit is set", async () => {
      const git = { listWorktrees: vi.fn() };
      docuviaFactory.register(TOKENS.GitProvider, () => git as any);

      const wf = new DoctorWorkflow("/test", logger);
      await wf.execute({ skipDb: true, skipGit: true, skipLogs: true });

      expect(git.listWorktrees).not.toHaveBeenCalled();
    });

    it("reports PASS when this workspace is the only worktree", async () => {
      registerPassingGitRunners();
      registerGit([{ path: "/test" }]);

      const wf = new DoctorWorkflow("/test", logger);
      const result = await wf.execute({ skipDb: true, skipLogs: true });

      expect(result.diagnostics["worktree_divergence"]).toEqual({
        status: DiagnosticStatus.PASS,
        message:
          "1 worktree(s) total; no sibling worktree carries its own .docuvia graph.",
      });
      expect(result.allPassed).toBe(true);
    });

    it("reports PASS when a sibling worktree exists but carries no local.db -- one shared graph, the healthy state", async () => {
      registerPassingGitRunners();
      registerGit([{ path: "/test" }, { path: "/test/worktree-b" }]);
      vi.mocked(fs.stat).mockImplementation((p) => {
        const pStr = String(p);
        if (pStr.includes(".docuvia") && pStr.includes("local.db")) {
          return Promise.reject(new Error("ENOENT"));
        }
        return Promise.reject(new Error("ENOENT"));
      });

      const wf = new DoctorWorkflow("/test", logger);
      const result = await wf.execute({ skipDb: true, skipLogs: true });

      expect(fs.stat).toHaveBeenCalledWith(
        path.join("/test/worktree-b", ".docuvia", "local.db"),
      );
      expect(result.diagnostics["worktree_divergence"].status).toBe(
        DiagnosticStatus.PASS,
      );
      expect(result.allPassed).toBe(true);
    });

    it("reports FAIL listing the sibling paths when a sibling worktree carries its own local.db", async () => {
      registerPassingGitRunners();
      registerGit([
        { path: "/test" },
        { path: "/test/worktree-b", branch: "feat/b" },
      ]);
      vi.mocked(fs.stat).mockImplementation((p) => {
        const pStr = String(p);
        if (pStr.includes("worktree-b") && pStr.endsWith("local.db")) {
          return Promise.resolve({} as any);
        }
        return Promise.reject(new Error("ENOENT"));
      });

      const wf = new DoctorWorkflow("/test", logger);
      const result = await wf.execute({ skipDb: true, skipLogs: true });

      expect(result.diagnostics["worktree_divergence"].status).toBe(
        DiagnosticStatus.FAIL,
      );
      expect(result.diagnostics["worktree_divergence"].message).toContain(
        "/test/worktree-b",
      );
      expect(result.diagnostics["worktree_divergence"].suggestion).toBe(
        DOCTOR_MESSAGES.WORKTREE_DIVERGENCE_SUGGESTION,
      );
      expect(result.allPassed).toBe(false);
    });
  });

  describe("Agent-Authored Adoption Check (issue #139 -- docuvia-first workflow adoption, always PASS/informational)", () => {
    function registerPassingDbAndGitRunners() {
      vi.mocked(fs.stat).mockResolvedValue({} as any);
      docuviaFactory.register(TOKENS.DiagnosticRunnerDb, () => ({
        checkHealth: vi.fn().mockResolvedValue({}),
      }));
      docuviaFactory.register(TOKENS.DiagnosticRunnerGit, () => ({
        checkHealth: vi.fn().mockResolvedValue({}),
      }));
    }

    function registerGit(headSha: string, changedFiles: { file: string }[]) {
      docuviaFactory.register(
        TOKENS.GitProvider,
        () =>
          ({
            getHeadSha: vi.fn().mockResolvedValue(headSha),
            getChangedFilesSince: vi.fn().mockResolvedValue(changedFiles),
          }) as any,
      );
    }

    function makeMockStore(
      meta: Record<string, string>,
      agentAuthoredL3: number,
    ) {
      return {
        projects: { getFirst: vi.fn().mockReturnValue({ id: 1 }) },
        graph: {
          count: vi.fn().mockReturnValue({ l2Nodes: 1, l3Nodes: 0 }),
          getSemanticCoverage: vi.fn().mockReturnValue({
            totalNodes: 1,
            describedNodes: 1,
          }),
        },
        files: {
          getTierBCoverage: vi.fn().mockReturnValue({
            totalFiles: 1,
            processedFiles: 1,
          }),
        },
        l3: {
          getAllExportable: vi.fn().mockReturnValue(
            Array.from({ length: agentAuthoredL3 }, () => ({
              source: L3DecisionSources.AGENT_AUTHORED,
            })),
          ),
        },
        meta: {
          get: vi.fn((key: string) => meta[key]),
          set: vi.fn(),
        },
        close: vi.fn().mockResolvedValue(undefined),
      };
    }

    function registerStore(
      meta: Record<string, string>,
      agentAuthoredL3: number,
    ) {
      const store = makeMockStore(meta, agentAuthoredL3);
      docuviaFactory.register(TOKENS.GraphStoreOpener, () =>
        vi.fn().mockResolvedValue(store),
      );
      return store;
    }

    /** Routes analyze.log reads to a fresh tierC.summary line (so the in-flight post-commit check
     *  and the tier_c_queue check stay PASS) and pending-l3-decisions.json reads to the given
     *  decisions. Everything else (analyze.log absent) rejects. */
    function mockFsReads(decisions: unknown[]) {
      vi.mocked(fs.readFile).mockImplementation((p) => {
        const pStr = String(p);
        if (pStr.endsWith(ANALYZE_LOG_FILE_NAME)) {
          return Promise.resolve(
            JSON.stringify({
              ts: new Date().toISOString(),
              event: ANALYZE_EVENTS.TIER_C_SUMMARY,
              processed: 3,
              persisted: 3,
            }) + "\n",
          );
        }
        if (pStr.includes("pending-l3-decisions.json")) {
          return Promise.resolve(JSON.stringify({ decisions }) + "\n");
        }
        return Promise.reject(new Error("ENOENT"));
      });
    }

    it("is skipped silently (no diagnostic key, no crash) when GraphStoreOpener isn't registered", async () => {
      registerPassingDbAndGitRunners();

      const wf = new DoctorWorkflow("/test", logger);
      const result = await wf.execute({ skipLogs: true });

      expect(result.diagnostics["agent_authored_adoption"]).toBeUndefined();
    });

    it("is skipped silently when GitProvider isn't registered", async () => {
      registerPassingDbAndGitRunners();
      registerStore({}, 0);

      const wf = new DoctorWorkflow("/test", logger);
      const result = await wf.execute({ skipLogs: true });

      expect(result.diagnostics["agent_authored_adoption"]).toBeUndefined();
    });

    it("is not evaluated at all when skipDb or skipGit is set", async () => {
      const openStore = vi.fn();
      docuviaFactory.register(TOKENS.GraphStoreOpener, () => openStore);
      const git = { getHeadSha: vi.fn(), getChangedFilesSince: vi.fn() };
      docuviaFactory.register(TOKENS.GitProvider, () => git as any);

      const wf = new DoctorWorkflow("/test", logger);
      await wf.execute({ skipDb: true, skipLogs: true });

      expect(openStore).not.toHaveBeenCalled();
      expect(git.getChangedFilesSince).not.toHaveBeenCalled();
    });

    it("reports PASS (skipped) when nothing changed since the last ingestion -- no recently-changed files to evaluate", async () => {
      registerPassingDbAndGitRunners();
      const store = registerStore(
        { [GitConstants.META_KEY_LAST_INGESTED_SOURCE_SHA]: "aaa111" },
        0,
      );
      registerGit("aaa111", []);

      const wf = new DoctorWorkflow("/test", logger);
      const result = await wf.execute({ skipLogs: true });

      expect(result.diagnostics["agent_authored_adoption"]).toEqual({
        status: DiagnosticStatus.PASS,
        message:
          "No recently-changed files to evaluate for agent-authored staging.",
      });
      expect(result.allPassed).toBe(true);
      expect(store.close).toHaveBeenCalled();
    });

    it("reports PASS with the adoption numbers when changed files carry staged decisions and agent-authored L3 rows exist in the graph", async () => {
      registerPassingDbAndGitRunners();
      registerStore(
        { [GitConstants.META_KEY_LAST_INGESTED_SOURCE_SHA]: "aaa111" },
        4,
      );
      registerGit("bbb222", [{ file: "src/a.ts" }]);
      mockFsReads([
        {
          filePath: "src/a.ts",
          title: "a decision",
          content: "content",
          nodeType: "decision",
          confidence: 0.9,
          stagedAt: "now",
        },
      ]);

      const wf = new DoctorWorkflow("/test", logger);
      const result = await wf.execute({ skipLogs: true });

      expect(result.diagnostics["agent_authored_adoption"]).toEqual({
        status: DiagnosticStatus.PASS,
        message:
          "Agent-authored decisions: 4 flushed in graph, 1 staged pending flush; 0 of 1 recently-changed file(s) carry no staged decision.",
      });
      expect(result.allPassed).toBe(true);
    });

    it("reports PASS but makes a near-zero-adoption state visible -- changed files with no staged decisions and no agent-authored L3 rows ever", async () => {
      registerPassingDbAndGitRunners();
      registerStore(
        { [GitConstants.META_KEY_LAST_INGESTED_SOURCE_SHA]: "aaa111" },
        0,
      );
      registerGit("bbb222", [{ file: "src/a.ts" }, { file: "src/b.ts" }]);
      mockFsReads([]);

      const wf = new DoctorWorkflow("/test", logger);
      const result = await wf.execute({ skipLogs: true });

      expect(result.diagnostics["agent_authored_adoption"].status).toBe(
        DiagnosticStatus.PASS,
      );
      expect(result.diagnostics["agent_authored_adoption"].message).toContain(
        "0 flushed in graph",
      );
      expect(result.diagnostics["agent_authored_adoption"].message).toContain(
        "2 of 2 recently-changed file(s) carry no staged decision",
      );
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

      expect(result.diagnostics["agent_authored_adoption"]).toBeUndefined();
      expect(result.diagnostics["db_found"].status).toBe(DiagnosticStatus.FAIL);
    });
  });
});
