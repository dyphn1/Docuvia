import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { syncCommand } from "../../../src/commands/sync.js";
import { ui } from "../../../src/ui/wizard.js";
import { SyncService } from "@workspace/core";
import process from "process";

vi.mock("../../../src/ui/wizard.js", () => ({
  ui: {
    info: vi.fn(),
    success: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    header: vi.fn(),
    spinner: vi.fn(() => ({
      start: vi.fn().mockReturnThis(),
      succeed: vi.fn(),
      fail: vi.fn(),
    })),
    askInput: vi.fn(),
    askSelect: vi.fn(),
    askConfirm: vi.fn(),
  },
}));

vi.mock("@workspace/core", () => {
  return {
    SyncService: vi.fn().mockImplementation(() => ({
      sync: vi.fn().mockResolvedValue(undefined),
    })),
  };
});

describe("syncCommand", () => {
  let originalEnv: NodeJS.ProcessEnv;
  let exitSpy: any;

  beforeEach(() => {
    originalEnv = { ...process.env };
    process.env.DOCUVIA_API_URL = "http://localhost:8080";
    process.env.MCP_PAT = "dummy";

    // @ts-ignore
    process.stdin.isTTY = true;

    exitSpy = vi.spyOn(process, "exit").mockImplementation(((code) => {
      throw new Error(`Exit ${code}`);
    }) as any);
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.clearAllMocks();
  });

  it("should prompt for projectId if missing and in TTY", async () => {
    vi.mocked(ui.askInput).mockResolvedValueOnce("test-proj");

    await syncCommand({});

    expect(ui.askInput).toHaveBeenCalledWith("Enter the Docuvia Project ID to sync with:");
    expect(SyncService).toHaveBeenCalled();
  });

  it("should exit if no projectId provided in non-TTY", async () => {
    // @ts-ignore
    process.stdin.isTTY = false;

    await expect(syncCommand({})).rejects.toThrow("Exit 1");

    expect(ui.error).toHaveBeenCalledWith("Missing required argument: <project_id>");
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(SyncService).not.toHaveBeenCalled();
  });

  it("should use provided projectId", async () => {
    await syncCommand({ projectId: "provided-proj" });

    expect(ui.askInput).not.toHaveBeenCalled();
    expect(SyncService).toHaveBeenCalled();
  });

  it("should exit if prompted projectId is empty", async () => {
    vi.mocked(ui.askInput).mockResolvedValueOnce("");
    await expect(syncCommand({})).rejects.toThrow("Exit 1");
    expect(ui.error).toHaveBeenCalledWith("Project ID is required.");
  });

  it("should warn and return if environment variables are missing", async () => {
    delete process.env.DOCUVIA_API_URL;
    await syncCommand({ projectId: "test-proj" });
    expect(ui.warn).toHaveBeenCalledWith(
      "DOCUVIA_API_URL or MCP_PAT is missing in the environment."
    );
    expect(SyncService).not.toHaveBeenCalled();
  });

  it("should handle sync failure", async () => {
    vi.mocked(SyncService).mockImplementationOnce(
      () =>
        ({
          sync: vi.fn().mockRejectedValue(new Error("Network Error")),
        }) as any
    );
    await expect(syncCommand({ projectId: "test-proj" })).rejects.toThrow("Exit 1");
  });
});
