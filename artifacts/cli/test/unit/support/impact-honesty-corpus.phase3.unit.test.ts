import { describe, expect, it } from "vitest";
import { parseAnalyzeDeltaSummary } from "../../support/impact-honesty-corpus.phase3.js";

describe("phase 3 analyze log parsing", () => {
  it("[happy] skips non-JSON log lines when finding the latest delta summary", () => {
    const summary = {
      event: "analyze.delta.summary",
      strictProofReproofStatus: "complete",
    };

    expect(
      parseAnalyzeDeltaSummary(
        ["starting analyze", JSON.stringify(summary), "finished"].join("\n"),
      ),
    ).toEqual(summary);
  });

  it("[invalid-input] ignores JSON lines that are not objects and returns the last summary", () => {
    const first = { event: "analyze.delta.summary", filesReparsed: 1 };
    const last = { event: "analyze.delta.summary", filesReparsed: 2 };

    expect(
      parseAnalyzeDeltaSummary(
        [
          "null",
          "[1,2]",
          '"analyze.delta.summary"',
          JSON.stringify(first),
          "42",
          JSON.stringify(last),
        ].join("\r\n"),
      ),
    ).toEqual(last);
  });

  it("[error-handling] returns undefined when no complete summary line exists", () => {
    expect(parseAnalyzeDeltaSummary("")).toBe(undefined);
    expect(
      parseAnalyzeDeltaSummary(
        [
          JSON.stringify({ event: "analyze.start" }),
          '{"event":"analyze.delta.summary","filesReparsed":',
        ].join("\n"),
      ),
    ).toBe(undefined);
  });
});
