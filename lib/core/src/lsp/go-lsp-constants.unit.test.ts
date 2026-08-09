import { describe, it, expect } from "vitest";
import { normalizeGoSymbolName } from "./go-lsp-constants.js";

describe("normalizeGoSymbolName()", () => {
  it("rewrites a value-receiver method name '(A).Handle' to 'A.Handle' (Tier A's key shape)", () => {
    expect(normalizeGoSymbolName("(A).Handle")).toBe("A.Handle");
  });

  it("rewrites a pointer-receiver method name '(*B).Visit' to 'B.Visit' -- the '*' stripped, matching Resolve's pointer_type unwrap", () => {
    expect(normalizeGoSymbolName("(*B).Visit")).toBe("B.Visit");
  });

  it("rewrites a nested-pointer receiver '(*pkg.Type).M' to 'pkg.Type.M'", () => {
    expect(normalizeGoSymbolName("(*pkg.Type).M")).toBe("pkg.Type.M");
  });

  it("leaves non-method names (plain functions, structs) untouched", () => {
    expect(normalizeGoSymbolName("Foo")).toBe("Foo");
    expect(normalizeGoSymbolName("NewB")).toBe("NewB");
  });

  it("leaves a method name with no receiver marker untouched (defensive)", () => {
    expect(normalizeGoSymbolName("Handle")).toBe("Handle");
  });
});
