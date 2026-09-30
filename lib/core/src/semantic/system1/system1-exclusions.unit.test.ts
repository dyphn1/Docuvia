import { describe, expect, it } from "vitest";
import {
  createSystem1ExclusionRecord,
  serializeSystem1Exclusions,
} from "./system1-exclusions.js";

describe("System-1 exclusion records", () => {
  it("records and serializes every excluded sample deterministically", () => {
    const records = [
      createSystem1ExclusionRecord(
        "owner/repo@revision::src/z.ts:3:4",
        "test",
        "call-expression-not-found",
      ),
      createSystem1ExclusionRecord(
        "owner/repo@revision::src/a.ts:1:2",
        "train",
        "invalid-call-site-id",
      ),
    ];

    expect(
      JSON.parse(serializeSystem1Exclusions(records).split("\n")[0]),
    ).toMatchObject({
      sampleId: "owner/repo@revision::src/a.ts:1:2",
      requestId: expect.stringMatching(/^system1:[0-9a-f]{24}$/),
      split: "train",
      reason: "invalid-call-site-id",
    });
    expect(serializeSystem1Exclusions(records)).toBe(
      serializeSystem1Exclusions([...records].reverse()),
    );
  });
});
