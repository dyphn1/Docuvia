import { describe, it, expect } from "vitest";
import { aggregateCallResolution } from "./call-resolution.js";

describe("aggregateCallResolution", () => {
  it("returns a zeroed aggregate for an empty map", () => {
    expect(aggregateCallResolution({})).toEqual({
      total: 0,
      resolved: 0,
      selfDiscarded: 0,
      unresolved: 0,
      unresolvable: 0,
    });
  });

  it("sums every counter across files, defaulting absent unresolvable to 0 (pre-#192 producers)", () => {
    expect(
      aggregateCallResolution({
        "a.ts": { total: 3, resolved: 1, selfDiscarded: 1, unresolved: 1 },
        "b.ts": {
          total: 2,
          resolved: 2,
          selfDiscarded: 0,
          unresolved: 0,
          unresolvable: 4,
        },
      }),
    ).toEqual({
      total: 5,
      resolved: 3,
      selfDiscarded: 1,
      unresolved: 1,
      unresolvable: 4,
    });
  });
});
