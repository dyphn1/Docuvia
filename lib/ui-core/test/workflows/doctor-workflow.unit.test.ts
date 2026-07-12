import { describe, it, expect, vi, beforeEach } from "vitest";
import { DoctorWorkflow } from "../../src/workflows/doctor/doctor-workflow.js";
import {
  docuviaFactory,
  TOKENS,
  DiagnosticStatus,
  DocuviaError,
} from "@workspace/contracts";
import * as fs from "fs/promises";
import * as path from "path";

vi.mock("fs/promises");

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

  it("skips all checks when options are passed", async () => {
    const wf = new DoctorWorkflow("/test", logger);
    const result = await wf.execute({
      skipDb: true,
      skipGit: true,
      skipLogs: true,
    });
    expect(result.allPassed).toBe(true);
    expect(result.diagnostics).toEqual({});
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
        checkHealth: vi
          .fn()
          .mockResolvedValue({
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
        checkHealth: vi
          .fn()
          .mockResolvedValue({
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
        checkHealth: vi
          .fn()
          .mockResolvedValue({
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
});
