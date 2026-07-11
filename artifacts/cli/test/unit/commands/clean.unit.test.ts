import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import process from "process";
import { docuviaMemory } from "@workspace/contracts";
import { docuviaApi } from "@workspace/ui-core";
import { cleanCommand } from "../../../src/commands/clean.js";
import { ui } from "../../../src/ui/wizard.js";

vi.mock("@workspace/ui-core", () => ({
  docuviaApi: { clean: vi.fn() },
}));

const spinnerSucceed = vi.fn();
const spinnerFail = vi.fn();

vi.mock("../../../src/ui/wizard.js", () => ({
  ui: {
    header: vi.fn(),
    warn: vi.fn(),
    askConfirm: vi.fn(),
    spinner: vi.fn(() => ({
      text: "",
      start: vi.fn().mockReturnThis(),
      succeed: spinnerSucceed,
      fail: spinnerFail,
    })),
  },
}));

const mockClean = vi.mocked(docuviaApi.clean);

describe("cleanCommand", () => {
  let exitSpy: any;

  beforeEach(() => {
    exitSpy = vi.spyOn(process, "exit").mockImplementation(((code: number) => {
      throw new Error(`Exit ${code}`);
    }) as any);
    mockClean.mockReset();
    spinnerSucceed.mockReset();
    spinnerFail.mockReset();
    Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("cleans non-interactively via docuviaApi.clean, scoping memory to a fresh UUID and cleaning it up afterwards", async () => {
    mockClean.mockImplementation(async (scopeId) => {
      expect(docuviaMemory.get(scopeId, "workspaceRoot")).toEqual(expect.any(String));
      return { deleted: true, message: "Cleaned .docuvia/local.db database." };
    });
    const deleteScopeSpy = vi.spyOn(docuviaMemory, "deleteScope");

    await cleanCommand();

    expect(mockClean).toHaveBeenCalled();
    expect(spinnerSucceed).toHaveBeenCalledWith(expect.stringContaining("Cleaned"));
    expect(deleteScopeSpy).toHaveBeenCalledTimes(1);
  });

  it("aborts without calling docuviaApi.clean when not confirmed in TTY", async () => {
    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
    vi.mocked(ui.askConfirm).mockResolvedValue(false);

    await expect(cleanCommand()).rejects.toThrow("Exit 0");

    expect(mockClean).not.toHaveBeenCalled();
  });

  it("calls spinner.fail and still deletes the memory scope when docuviaApi.clean() throws", async () => {
    mockClean.mockRejectedValue(new Error("boom"));
    const deleteScopeSpy = vi.spyOn(docuviaMemory, "deleteScope");

    await expect(cleanCommand()).rejects.toThrow("Exit 1");

    expect(spinnerFail).toHaveBeenCalledWith(expect.stringContaining("boom"));
    expect(deleteScopeSpy).toHaveBeenCalledTimes(1);
  });
});
