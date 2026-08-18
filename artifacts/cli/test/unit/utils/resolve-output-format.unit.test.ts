import { describe, it, expect } from "vitest";
import { resolveOutputFormat } from "../../../src/utils/resolve-output-format.js";

describe("resolveOutputFormat()", () => {
  it("returns undefined when --format is absent (each command falls back to its human default)", () => {
    expect(resolveOutputFormat(undefined)).toBeUndefined();
  });

  it.each(["human", "prompt", "json"] as const)(
    "passes through the known --format value '%s'",
    (raw) => {
      expect(resolveOutputFormat(raw)).toBe(raw);
    },
  );

  it("throws on an unknown --format value instead of silently degrading to human", () => {
    expect(() => resolveOutputFormat("jsno")).toThrow(
      "Unknown --format value: jsno",
    );
    expect(() => resolveOutputFormat("jsno")).toThrow(
      "Available formats: human, prompt, json",
    );
  });
});
