import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import process from "process";
import { docuviaApi } from "@workspace/ui-core";
import { hooksCommand } from "../../../src/commands/hooks.js";
import { ui } from "../../../src/ui/wizard.js";

vi.mock("@workspace/ui-core", () => ({
  docuviaApi: { listHooks: vi.fn(), setHookEnabled: vi.fn() },
}));

vi.mock("../../../src/ui/wizard.js", () => ({
  ui: {
    header: vi.fn(),
    table: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
  },
}));

const mockListHooks = vi.mocked(docuviaApi.listHooks);
const mockSetHookEnabled = vi.mocked(docuviaApi.setHookEnabled);

describe("hooksCommand", () => {
  beforeEach(() => {
    mockListHooks.mockReset();
    mockSetHookEnabled.mockReset();
    vi.mocked(ui.header).mockReset();
    vi.mocked(ui.table).mockReset();
    vi.mocked(ui.success).mockReset();
    vi.mocked(ui.error).mockReset();
    process.exitCode = undefined;
  });

  afterEach(() => {
    vi.clearAllMocks();
    process.exitCode = undefined;
  });

  it("list: prints a hook name/status table", async () => {
    mockListHooks.mockResolvedValue({
      "context-injection": true,
      "commit-l3-write": false,
      "tier-b-c-prepush": true,
    });

    await hooksCommand("list", undefined, "/workspace");

    expect(ui.header).toHaveBeenCalled();
    expect(ui.table).toHaveBeenCalledWith(
      expect.anything(),
      expect.arrayContaining([
        ["context-injection", "enabled"],
        ["commit-l3-write", "disabled"],
        ["tier-b-c-prepush", "enabled"],
      ]),
    );
    expect(process.exitCode).toBeUndefined();
  });

  it("enable: calls docuviaApi.setHookEnabled and prints a confirmation", async () => {
    mockSetHookEnabled.mockResolvedValue({
      "context-injection": true,
      "commit-l3-write": true,
      "tier-b-c-prepush": true,
    });

    await hooksCommand("enable", "commit-l3-write", "/workspace");

    expect(mockSetHookEnabled).toHaveBeenCalled();
    expect(ui.success).toHaveBeenCalledWith(
      expect.stringContaining("commit-l3-write"),
    );
    expect(process.exitCode).toBeUndefined();
  });

  it("disable: calls docuviaApi.setHookEnabled and prints a confirmation", async () => {
    mockSetHookEnabled.mockResolvedValue({
      "context-injection": true,
      "commit-l3-write": false,
      "tier-b-c-prepush": true,
    });

    await hooksCommand("disable", "commit-l3-write", "/workspace");

    expect(mockSetHookEnabled).toHaveBeenCalled();
    expect(ui.success).toHaveBeenCalledWith(
      expect.stringContaining("commit-l3-write"),
    );
  });

  it("enable/disable: rejects an invalid hook name with a clear message, never calls docuviaApi", async () => {
    await hooksCommand("enable", "not-a-real-hook", "/workspace");

    expect(mockSetHookEnabled).not.toHaveBeenCalled();
    expect(ui.error).toHaveBeenCalledWith(
      expect.stringContaining("not-a-real-hook"),
    );
    expect(process.exitCode).toBe(1);
  });

  it("check: exits 0 when the named hook is enabled, no stdout", async () => {
    mockListHooks.mockResolvedValue({
      "context-injection": true,
      "commit-l3-write": true,
      "tier-b-c-prepush": true,
    });

    await hooksCommand("check", "commit-l3-write", "/workspace");

    expect(process.exitCode).toBe(0);
    expect(ui.header).not.toHaveBeenCalled();
    expect(ui.success).not.toHaveBeenCalled();
  });

  it("check: exits 1 when the named hook is disabled", async () => {
    mockListHooks.mockResolvedValue({
      "context-injection": true,
      "commit-l3-write": false,
      "tier-b-c-prepush": true,
    });

    await hooksCommand("check", "commit-l3-write", "/workspace");

    expect(process.exitCode).toBe(1);
  });

  it("check: exits 1 for an unknown hook name", async () => {
    await hooksCommand("check", "not-a-real-hook", "/workspace");

    expect(process.exitCode).toBe(1);
    expect(mockListHooks).not.toHaveBeenCalled();
  });

  it("unknown/missing subcommand: prints usage and exits 1", async () => {
    await hooksCommand(undefined, undefined, "/workspace");

    expect(ui.error).toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });
});
