import { describe, it, expect, vi, beforeEach } from "vitest";
import { GitDiagnosticRunner } from "../src/diagnostic-runner.js";
import { DiagnosticStatus } from "@workspace/contracts";
import * as child_process from "child_process";

vi.mock("child_process", () => {
  return {
    exec: vi.fn(),
  };
});

describe("GitDiagnosticRunner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns PASS when git ls-remote succeeds", async () => {
    vi.mocked(child_process.exec).mockImplementation(((
      cmd: string,
      opts: any,
      cb: any,
    ) => {
      cb(null, { stdout: "some branches", stderr: "" });
    }) as any);

    const runner = new GitDiagnosticRunner();
    const result = await runner.checkHealth("/test");
    expect(result["git_network"].status).toBe(DiagnosticStatus.PASS);
  });

  it("throws DocuviaError for timeout (err.killed)", async () => {
    vi.mocked(child_process.exec).mockImplementation(((
      cmd: string,
      opts: any,
      cb: any,
    ) => {
      const err = new Error("timeout") as any;
      err.killed = true;
      cb(err);
    }) as any);

    const runner = new GitDiagnosticRunner();
    await expect(runner.checkHealth("/test")).rejects.toThrow(
      /Git remote reachability check failed/,
    );
  });

  it("throws DocuviaError for general git error", async () => {
    vi.mocked(child_process.exec).mockImplementation(((
      cmd: string,
      opts: any,
      cb: any,
    ) => {
      cb(new Error("fatal: not a git repo"));
    }) as any);

    const runner = new GitDiagnosticRunner();
    await expect(runner.checkHealth("/test")).rejects.toThrow(
      /Git remote reachability check failed/,
    );
  });
});
