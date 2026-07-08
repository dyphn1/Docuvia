import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { syncCommand } from "../../../src/commands/sync.js";
import { ui } from "../../../src/ui/wizard.js";
import process from "process";
import { DI_TOKENS, container } from "@workspace/core";

const mockSync = vi.fn();
container.register(DI_TOKENS.SyncService, { sync: mockSync });

vi.mock("../../../src/ui/wizard.js", () => ({
  ui: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    askInput: vi.fn(),
    spinner: vi.fn(() => ({
      start: vi.fn().mockReturnThis(),
      succeed: vi.fn(),
      fail: vi.fn(),
    })),
  },
}));

vi.mock("readline", () => ({
  createInterface: vi.fn().mockReturnValue({
    on: vi.fn((event, cb) => {
      if (event === "line") cb("test-sha");
      if (event === "close") cb();
    }),
  }),
}));

describe("syncCommand", () => {
  let exitSpy: any;
  let envBackup: any;

  beforeEach(() => {
    exitSpy = vi.spyOn(process, "exit").mockImplementation(((code: number) => {
      throw new Error(`Exit ${code}`);
    }) as any);
    envBackup = { ...process.env };
    process.env.DOCUVIA_API_URL = "http://test";
    process.env.MCP_PAT = "test-token";
    mockSync.mockReset();
    Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });
  });

  afterEach(() => {
    process.env = envBackup;
    vi.clearAllMocks();
  });

  it("should fail if no project id and not TTY", async () => {
    await expect(syncCommand({})).rejects.toThrow("Exit 1");
    expect(ui.error).toHaveBeenCalledWith(expect.stringContaining("Missing required argument"));
  });

  it("should skip if env vars missing", async () => {
    delete process.env.DOCUVIA_API_URL;
    await syncCommand({ projectId: "test-id" });
    expect(ui.warn).toHaveBeenCalledWith(expect.stringContaining("missing in the environment"));
    expect(mockSync).not.toHaveBeenCalled();
  });

  it("should use provided projectId", async () => {
    mockSync.mockResolvedValue(undefined);
    await syncCommand({ projectId: "test-id" });
    expect(mockSync).toHaveBeenCalledWith("test-id", "test-sha");
  });
});
