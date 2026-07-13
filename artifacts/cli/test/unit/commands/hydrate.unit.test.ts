import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import process from "process";
import { docuviaMemory } from "@workspace/contracts";
import { docuviaApi } from "@workspace/ui-core";
import { hydrateCommand } from "../../../src/commands/hydrate.js";

vi.mock("@workspace/ui-core", () => ({
  docuviaApi: { hydrate: vi.fn() },
}));

const spinnerSucceed = vi.fn();
const spinnerFail = vi.fn();
const spinnerWarn = vi.fn();

vi.mock("../../../src/ui/wizard.js", () => ({
  ui: {
    spinner: vi.fn(() => ({
      text: "",
      start: vi.fn().mockReturnThis(),
      succeed: spinnerSucceed,
      fail: spinnerFail,
      warn: spinnerWarn,
    })),
  },
}));

const mockHydrate = vi.mocked(docuviaApi.hydrate);

describe("hydrateCommand", () => {
  let exitSpy: any;

  beforeEach(() => {
    exitSpy = vi.spyOn(process, "exit").mockImplementation(((code: number) => {
      throw new Error(`Exit ${code}`);
    }) as any);
    mockHydrate.mockReset();
    spinnerSucceed.mockReset();
    spinnerFail.mockReset();
    spinnerWarn.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("reports node/edge counts on success", async () => {
    mockHydrate.mockResolvedValue({
      hydrated: true,
      knowledgeSha: "abc1234",
      nodesLoaded: 3,
      edgesLoaded: 2,
      edgesDropped: 0,
    });

    await hydrateCommand();

    expect(mockHydrate).toHaveBeenCalled();
    expect(spinnerSucceed).toHaveBeenCalledWith(
      expect.stringContaining("3 nodes"),
    );
    expect(spinnerSucceed).toHaveBeenCalledWith(
      expect.stringContaining("2 edges"),
    );
  });

  it("mentions dropped dangling edges when any were dropped", async () => {
    mockHydrate.mockResolvedValue({
      hydrated: true,
      knowledgeSha: "abc1234",
      nodesLoaded: 3,
      edgesLoaded: 2,
      edgesDropped: 1,
    });

    await hydrateCommand();

    expect(spinnerSucceed).toHaveBeenCalledWith(
      expect.stringContaining("1 dangling edge"),
    );
  });

  it("warns instead of succeeding when there's nothing to hydrate from yet", async () => {
    mockHydrate.mockResolvedValue({
      hydrated: false,
      nodesLoaded: 0,
      edgesLoaded: 0,
      edgesDropped: 0,
    });

    await hydrateCommand();

    expect(spinnerWarn).toHaveBeenCalled();
    expect(spinnerSucceed).not.toHaveBeenCalled();
  });

  it("calls spinner.fail and still deletes the memory scope when docuviaApi.hydrate() throws", async () => {
    mockHydrate.mockRejectedValue(
      new Error('Local database not found. Please run "docuvia init".'),
    );
    const deleteScopeSpy = vi.spyOn(docuviaMemory, "deleteScope");

    await expect(hydrateCommand()).rejects.toThrow("Exit 1");

    expect(spinnerFail).toHaveBeenCalledWith(
      expect.stringContaining("docuvia init"),
    );
    expect(deleteScopeSpy).toHaveBeenCalledTimes(1);
  });
});
