import { describe, it, expect, vi } from "vitest";
import { docuviaApi } from "@workspace/ui-core";

vi.mock("@workspace/ui-core", () => ({
  docuviaApi: { impact: vi.fn() },
}));

const mockImpact = vi.mocked(docuviaApi.impact);

describe("mock test", () => {
  it("should return riskNote", async () => {
    const { impact } = await import("@workspace/ui-core");
    vi.mocked(impact).mockResolvedValue({
      blastRadius: [],
      riskLevel: "UNKNOWN",
      epistemic: "lower-bound",
      riskNote: "test note",
    });

    const result = await impact("scope", {} as any);
    console.log("Result:", result);
    expect(result.riskNote).toBe("test note");
  });
});
