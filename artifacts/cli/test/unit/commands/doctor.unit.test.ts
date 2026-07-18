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

const ENV_BASE_URL = "AI_DOCUVIA_INTEGRATIONS_OPENAI_BASE_URL";
const ENV_API_KEY = "AI_DOCUVIA_INTEGRATIONS_OPENAI_API_KEY";

describe("doctorCommand", () => {
  let originalBaseUrl: string | undefined;
  let originalApiKey: string | undefined;

  beforeEach(() => {
    process.exitCode = undefined;
    vi.clearAllMocks();

    vi.mocked(fs.stat).mockResolvedValue({ size: 100 } as any);

    // Isolate every test in this file from whatever the real ambient environment happens to have
    // set for these vars (T7's env-var read-through would otherwise leak real values into
    // unrelated tests' exact-object assertions).
    originalBaseUrl = process.env[ENV_BASE_URL];
    originalApiKey = process.env[ENV_API_KEY];
    delete process.env[ENV_BASE_URL];
    delete process.env[ENV_API_KEY];
  });

  afterEach(() => {
    vi.clearAllMocks();
    if (originalBaseUrl === undefined) delete process.env[ENV_BASE_URL];
    else process.env[ENV_BASE_URL] = originalBaseUrl;
    if (originalApiKey === undefined) delete process.env[ENV_API_KEY];
    else process.env[ENV_API_KEY] = originalApiKey;
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
      { skipDb: false, skipGit: false, skipLogs: true, fix: false },
    );
    expect(fs.stat).not.toHaveBeenCalled();
    expect(ui.info).toHaveBeenCalledWith(
      expect.stringContaining("--skip-hooks"),
    );
    expect(ui.success).toHaveBeenCalledWith(
      expect.stringContaining("All diagnostics passed."),
    );
  });

  it("passes fix through to docuviaApi.doctor when --fix is set", async () => {
    vi.mocked(docuviaApi.doctor).mockResolvedValue({
      allPassed: true,
      diagnostics: {},
    });

    await doctorCommand(process.cwd(), { fix: true });

    expect(docuviaApi.doctor).toHaveBeenCalledWith(
      expect.any(String),
      expect.anything(),
      { skipDb: false, skipGit: false, skipLogs: false, fix: true },
    );
  });

  it("defaults fix to false when --fix is not given", async () => {
    vi.mocked(docuviaApi.doctor).mockResolvedValue({
      allPassed: true,
      diagnostics: {},
    });

    await doctorCommand(process.cwd());

    expect(docuviaApi.doctor).toHaveBeenCalledWith(
      expect.any(String),
      expect.anything(),
      { skipDb: false, skipGit: false, skipLogs: false, fix: false },
    );
  });

  describe("Tier C LLM env-var read-through (§10e bullet 3, T7)", () => {
    it("passes llmBaseUrl/llmApiKey through from process.env when set", async () => {
      process.env[ENV_BASE_URL] = "http://127.0.0.1:8317";
      process.env[ENV_API_KEY] = "secret-key";
      vi.mocked(docuviaApi.doctor).mockResolvedValue({
        allPassed: true,
        diagnostics: {},
      });

      await doctorCommand(process.cwd());

      expect(docuviaApi.doctor).toHaveBeenCalledWith(
        expect.any(String),
        expect.anything(),
        expect.objectContaining({
          llmBaseUrl: "http://127.0.0.1:8317",
          llmApiKey: "secret-key",
        }),
      );
    });

    it("passes llmBaseUrl/llmApiKey through as undefined when the env vars aren't set", async () => {
      delete process.env[ENV_BASE_URL];
      delete process.env[ENV_API_KEY];
      vi.mocked(docuviaApi.doctor).mockResolvedValue({
        allPassed: true,
        diagnostics: {},
      });

      await doctorCommand(process.cwd());

      expect(docuviaApi.doctor).toHaveBeenCalledWith(
        expect.any(String),
        expect.anything(),
        expect.objectContaining({
          llmBaseUrl: undefined,
          llmApiKey: undefined,
        }),
      );
    });
  });
});
