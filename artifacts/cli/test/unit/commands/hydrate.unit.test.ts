import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import process from "process";
import { docuviaMemory } from "@workspace/contracts";
import { docuviaApi } from "@workspace/ui-core";
import { hydrateCommand } from "../../../src/commands/hydrate.js";
import { ui } from "../../../src/ui/wizard.js";

vi.mock("@workspace/ui-core", () => ({
  docuviaApi: { hydrate: vi.fn() },
}));

const spinnerSucceed = vi.fn();
const spinnerFail = vi.fn();
const spinnerWarn = vi.fn();

vi.mock("../../../src/ui/wizard.js", () => ({
  ui: {
    header: vi.fn(),
    info: vi.fn(),
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
    process.exitCode = undefined;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("reports node/edge counts as separate info lines on success", async () => {
    mockHydrate.mockResolvedValue({
      hydrated: true,
      knowledgeSha: "abc1234",
      nodesLoaded: 3,
      edgesLoaded: 2,
      edgesDropped: 0,
    });

    await hydrateCommand();

    expect(mockHydrate).toHaveBeenCalled();
    expect(ui.header).toHaveBeenCalled();
    expect(spinnerSucceed).toHaveBeenCalled();
    expect(ui.info).toHaveBeenCalledWith(
      expect.stringContaining("Nodes loaded: 3"),
    );
    expect(ui.info).toHaveBeenCalledWith(
      expect.stringContaining("Edges loaded: 2"),
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

    expect(ui.info).toHaveBeenCalledWith(
      expect.stringContaining("Dangling edges dropped: 1"),
    );
  });

  it("does not print a dangling-edges line when none were dropped", async () => {
    mockHydrate.mockResolvedValue({
      hydrated: true,
      knowledgeSha: "abc1234",
      nodesLoaded: 3,
      edgesLoaded: 2,
      edgesDropped: 0,
    });

    await hydrateCommand();

    expect(ui.info).not.toHaveBeenCalledWith(
      expect.stringContaining("Dangling edges dropped"),
    );
  });

  it("updates spinner.text as the workflow logger emits info events", async () => {
    // Closes docs/cli-test-analysis/hydrate.md #1 — the logger.onLog -> spinner.text wiring
    // (hydrate.ts) was previously never exercised by a test.
    mockHydrate.mockImplementation(async (_scopeId, logger) => {
      logger.info("Scanning workspace files...");
      return {
        hydrated: true,
        knowledgeSha: "abc1234",
        nodesLoaded: 3,
        edgesLoaded: 2,
        edgesDropped: 0,
      };
    });

    await hydrateCommand();

    const spinnerInstance = vi.mocked(ui.spinner).mock.results[0].value;
    expect(spinnerInstance.text).toBe("Scanning workspace files...");
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

    await hydrateCommand();

    expect(spinnerFail).toHaveBeenCalledWith(
      expect.stringContaining("docuvia init"),
    );
    // Regression guard: process.exit() terminates the process before a pending `finally` runs,
    // which would silently skip docuviaMemory.deleteScope() — see docs/cli-test-analysis/
    // README.md's "Bugs found during verification" #1. Must use process.exitCode instead.
    expect(exitSpy).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
    expect(deleteScopeSpy).toHaveBeenCalledTimes(1);
  });
});
