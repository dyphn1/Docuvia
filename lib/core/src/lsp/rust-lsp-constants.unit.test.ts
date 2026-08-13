import { describe, it, expect } from "vitest";
import { normalizeRustSymbolName } from "./rust-lsp-constants.js";

describe("normalizeRustSymbolName()", () => {
  it("strips a leading 'impl ' from an impl-block parent's name to yield Tier A's bare struct name", () => {
    expect(normalizeRustSymbolName("impl HaystackBuilder")).toBe(
      "HaystackBuilder",
    );
  });

  it("strips 'impl ' for a generic impl parent too", () => {
    expect(normalizeRustSymbolName("impl Wrapper")).toBe("Wrapper");
  });

  it("leaves a plain method/function name untouched", () => {
    expect(normalizeRustSymbolName("build")).toBe("build");
    expect(normalizeRustSymbolName("new")).toBe("new");
  });

  it("leaves a struct name untouched", () => {
    expect(normalizeRustSymbolName("HaystackBuilder")).toBe("HaystackBuilder");
  });

  it("does not strip a name merely containing 'impl' elsewhere (defensive)", () => {
    expect(normalizeRustSymbolName("implementationDetail")).toBe(
      "implementationDetail",
    );
  });
});
