import { describe, expect, it } from "vitest";
import { equalStringMaps } from "../../scripts/semantic-corpus/parity-utils.mts";

describe("whole-source parity map comparison", () => {
  it("[happy][state-diff] compares identical entries regardless of insertion order", () => {
    const baseline = new Map([
      ["site-a", "hypothesis-a"],
      ["site-b", "hypothesis-b"],
    ]);
    const working = new Map([
      ["site-b", "hypothesis-b"],
      ["site-a", "hypothesis-a"],
    ]);

    expect(equalStringMaps(baseline, working)).toBe(true);
  });

  it("[invalid-input] detects different keys and values exactly", () => {
    const baseline = new Map([
      ["site-a", "hypothesis-a"],
      ["site-b", "hypothesis-b"],
    ]);

    expect(
      equalStringMaps(
        baseline,
        new Map([
          ["site-a", "hypothesis-a"],
          ["site-c", "hypothesis-b"],
        ]),
      ),
    ).toBe(false);
    expect(
      equalStringMaps(
        baseline,
        new Map([
          ["site-a", "hypothesis-changed"],
          ["site-b", "hypothesis-b"],
        ]),
      ),
    ).toBe(false);
  });

  it("[error-handling] treats empty maps as equal and size mismatches as unequal", () => {
    expect(equalStringMaps(new Map(), new Map())).toBe(true);
    expect(equalStringMaps(new Map([["site-a", "value"]]), new Map())).toBe(
      false,
    );
  });
});
