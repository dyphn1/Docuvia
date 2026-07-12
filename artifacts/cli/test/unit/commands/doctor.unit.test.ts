import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import process from "process";
import { ui } from "../../../src/ui/wizard.js";
import { doctorCommand } from "../../../src/commands/doctor.js";
import { docuviaApi } from "@workspace/ui-core";
import * as fs from "fs/promises";

vi.mock("fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs/promises")>();
  return {
    ...actual,
    stat: vi.fn(),
  };
});

vi.mock("../../../src/ui/wizard.js", () => ({
  ui: {
    header: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("@workspace/ui-core", () => ({
  docuviaApi: {
    doctor: vi.fn(),
  },
}));

describe("doctorCommand", () => {
  beforeEach(() => {
    process.exitCode = undefined;
    vi.clearAllMocks();

    vi.mocked(fs.stat).mockResolvedValue({ size: 100 } as any);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("should run diagnostics and succeed when all checks pass", async () => {
    vi.mocked(docuviaApi.doctor).mockResolvedValue({
      allPassed: true,
      diagnostics: {
        sqlite_integrity: { status: "pass", message: "DB pass" },
        git_reachability: { status: "pass", message: "Git pass" },
        logs: { status: "pass", message: "Logs pass" },
      },
    });

    await doctorCommand(process.cwd());

    expect(docuviaApi.doctor).toHaveBeenCalled();
    expect(ui.success).toHaveBeenCalledWith("[sqlite_integrity] DB pass");
    expect(ui.success).toHaveBeenCalledWith("[git_reachability] Git pass");
    expect(ui.success).toHaveBeenCalledWith("[logs] Logs pass");
    expect(ui.success).toHaveBeenCalledWith(
      expect.stringContaining("All diagnostics passed."),
    );
    expect(process.exitCode).toBeUndefined();
  });

  it("should fail when docuviaApi.doctor returns failures", async () => {
    vi.mocked(docuviaApi.doctor).mockResolvedValue({
      allPassed: false,
      diagnostics: {
        sqlite_integrity: { status: "pass", message: "DB pass" },
        git_reachability: {
          status: "fail",
          message: "Git timeout",
          suggestion: "Check DNS",
        },
        logs: { status: "pass", message: "Logs pass" },
      },
    });

    await doctorCommand(process.cwd());

    expect(ui.error).toHaveBeenCalledWith("[git_reachability] Git timeout");
    expect(ui.info).toHaveBeenCalledWith("    💡 Fix: Check DNS");
    expect(ui.error).toHaveBeenCalledWith(
      expect.stringContaining("Some diagnostics failed."),
    );
    expect(process.exitCode).toBe(1);
  });

  it("should catch and report thrown errors from docuviaApi", async () => {
    vi.mocked(docuviaApi.doctor).mockRejectedValue(
      new Error("Workflow crashed"),
    );

    await doctorCommand(process.cwd());

    expect(ui.error).toHaveBeenCalledWith(
      expect.stringContaining("Doctor failed: Workflow crashed"),
    );
    expect(process.exitCode).toBe(1);
  });

  it("skips the Hooks check and passes skipLogs to API when skipHooks and skipLogs are set", async () => {
    vi.mocked(docuviaApi.doctor).mockResolvedValue({
      allPassed: true,
      diagnostics: {},
    });

    await doctorCommand(process.cwd(), { skipHooks: true, skipLogs: true });

    expect(docuviaApi.doctor).toHaveBeenCalledWith(
      expect.any(String),
      expect.anything(),
      { skipDb: false, skipGit: false, skipLogs: true },
    );
    expect(fs.stat).not.toHaveBeenCalled();
    expect(ui.info).toHaveBeenCalledWith(
      expect.stringContaining("--skip-hooks"),
    );
    expect(ui.success).toHaveBeenCalledWith(
      expect.stringContaining("All diagnostics passed."),
    );
  });
});
