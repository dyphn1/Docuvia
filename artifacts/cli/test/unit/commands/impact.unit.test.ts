import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { docuviaMemory } from "@workspace/contracts";
import { docuviaApi } from "@workspace/ui-core";
import { impactCommand } from "../../../src/commands/impact.js";
import { ui } from "../../../src/ui/wizard.js";

vi.mock("@workspace/ui-core", () => ({
  docuviaApi: { impact: vi.fn() },
}));

const spinnerSucceed = vi.fn();
const spinnerFail = vi.fn();
const spinnerWarn = vi.fn();

vi.mock("../../../src/ui/wizard.js", () => ({
  ui: {
    header: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    spinner: vi.fn(() => ({
      text: "",
      start: vi.fn().mockReturnThis(),
      succeed: spinnerSucceed,
      fail: spinnerFail,
      warn: spinnerWarn,
    })),
  },
}));

const mockImpact = vi.mocked(docuviaApi.impact);

describe("impactCommand", () => {
  beforeEach(() => {
    mockImpact.mockReset();
    spinnerSucceed.mockReset();
    spinnerFail.mockReset();
    spinnerWarn.mockReset();
    vi.mocked(ui.warn).mockReset();
    vi.mocked(ui.error).mockReset();
    process.exitCode = undefined;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("errors immediately without calling docuviaApi.impact() when target is empty", async () => {
    await impactCommand("");

    expect(mockImpact).not.toHaveBeenCalled();
    expect(ui.error).toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  it("prints the blast radius and risk level on success", async () => {
    mockImpact.mockResolvedValue({
      blastRadius: [{ name: "caller", type: "module" }],
      riskLevel: "MEDIUM",
    });

    await impactCommand("target");

    expect(mockImpact).toHaveBeenCalled();
    expect(spinnerSucceed).toHaveBeenCalled();
  });

  it("warns when no matching node is found (docuviaApi.impact() resolves null)", async () => {
    mockImpact.mockResolvedValue(null);

    await impactCommand("nope");

    expect(spinnerWarn).toHaveBeenCalled();
  });

  it("calls spinner.fail and deletes the memory scope when docuviaApi.impact() throws", async () => {
    mockImpact.mockRejectedValue(new Error("boom"));
    const deleteScopeSpy = vi.spyOn(docuviaMemory, "deleteScope");

    await impactCommand("target");

    expect(spinnerFail).toHaveBeenCalledWith(expect.stringContaining("boom"));
    expect(deleteScopeSpy).toHaveBeenCalledTimes(1);
    expect(process.exitCode).toBe(1);
  });
});
