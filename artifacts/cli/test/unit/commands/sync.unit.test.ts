import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import process from "process";
import { docuviaMemory } from "@workspace/contracts";
import { docuviaApi } from "@workspace/ui-core";
import { syncCommand } from "../../../src/commands/sync.js";
import { ui } from "../../../src/ui/wizard.js";

vi.mock("@workspace/ui-core", () => ({
  docuviaApi: { sync: vi.fn() },
}));

const spinnerSucceed = vi.fn();
const spinnerFail = vi.fn();

vi.mock("../../../src/ui/wizard.js", () => ({
  ui: {
    header: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    askInput: vi.fn(),
    spinner: vi.fn(() => ({
      text: "",
      start: vi.fn().mockReturnThis(),
      succeed: spinnerSucceed,
      fail: spinnerFail,
    })),
  },
}));

const mockSync = vi.mocked(docuviaApi.sync);

describe("syncCommand", () => {
  let exitSpy: any;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    exitSpy = vi.spyOn(process, "exit").mockImplementation(((code: number) => {
      throw new Error(`Exit ${code}`);
    }) as any);
    mockSync.mockReset();
    spinnerSucceed.mockReset();
    spinnerFail.mockReset();
    process.exitCode = undefined;
    process.env.DOCUVIA_API_URL = "https://api.example.com";
    process.env.MCP_PAT = "test-pat";
    Object.defineProperty(process.stdin, "isTTY", {
      value: false,
      configurable: true,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
  });

  it("warns and no-ops without calling docuviaApi.sync when DOCUVIA_API_URL/MCP_PAT are absent", async () => {
    delete process.env.DOCUVIA_API_URL;
    delete process.env.MCP_PAT;

    await syncCommand({ projectId: "1" });

    expect(mockSync).not.toHaveBeenCalled();
    expect(ui.warn).toHaveBeenCalled();
  });

  it("exits 1 without calling docuviaApi.sync when no projectId is given and stdin is not a TTY", async () => {
    await expect(syncCommand({})).rejects.toThrow("Exit 1");

    expect(mockSync).not.toHaveBeenCalled();
  });

  it("calls docuviaApi.sync with workspaceRoot/apiUrl/pat/projectId/commitSha scoped in memory, and cleans up the scope afterwards", async () => {
    mockSync.mockImplementation(async (scopeId) => {
      expect(docuviaMemory.get(scopeId, "workspaceRoot")).toEqual(
        expect.any(String),
      );
      expect(docuviaMemory.get(scopeId, "apiUrl")).toBe(
        "https://api.example.com",
      );
      expect(docuviaMemory.get(scopeId, "pat")).toBe("test-pat");
      expect(docuviaMemory.get(scopeId, "projectId")).toBe("42");
      expect(docuviaMemory.get(scopeId, "commitSha")).toBe("abc123");
      return {
        synced: 2,
        skipped: 0,
        message: "Synced 2 decision(s), 0 module(s) skipped.",
      };
    });
    const deleteScopeSpy = vi.spyOn(docuviaMemory, "deleteScope");

    await syncCommand({ projectId: "42", commitSha: "abc123" });

    expect(mockSync).toHaveBeenCalled();
    expect(spinnerSucceed).toHaveBeenCalledWith(
      expect.stringContaining("Synced 2"),
    );
    expect(deleteScopeSpy).toHaveBeenCalledTimes(1);
  });

  it("prompts for a project id via ui.askInput when omitted and --interactive was passed", async () => {
    // Still needs a real TTY here so the commitSha piped-stdin read (a separate, unrelated
    // concern -- see sync.ts's NOTE) doesn't try to read from this test's stdin and hang.
    Object.defineProperty(process.stdin, "isTTY", {
      value: true,
      configurable: true,
    });
    vi.mocked(ui.askInput).mockResolvedValue("77");
    mockSync.mockResolvedValue({
      synced: 0,
      skipped: 0,
      message: "Nothing to sync",
    });

    await syncCommand({}, undefined, true);

    expect(ui.askInput).toHaveBeenCalled();
    expect(mockSync).toHaveBeenCalled();
  });

  it("exits 1 without prompting when no projectId is given and --interactive was not passed, even on a TTY", async () => {
    Object.defineProperty(process.stdin, "isTTY", {
      value: true,
      configurable: true,
    });

    await expect(syncCommand({})).rejects.toThrow("Exit 1");

    expect(ui.askInput).not.toHaveBeenCalled();
    expect(mockSync).not.toHaveBeenCalled();
  });

  it("sets process.exitCode = 1 (not process.exit) and calls spinner.fail when docuviaApi.sync() throws", async () => {
    mockSync.mockRejectedValue(new Error("network down"));

    await syncCommand({ projectId: "1", commitSha: "abc" });

    expect(spinnerFail).toHaveBeenCalledWith(
      expect.stringContaining("network down"),
    );
    expect(process.exitCode).toBe(1);
    expect(exitSpy).not.toHaveBeenCalled();
  });
});
