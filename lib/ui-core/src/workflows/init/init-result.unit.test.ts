import { describe, it, expect } from "vitest";
import { buildInitResult } from "./init-result.js";

describe("buildInitResult", () => {
  it("returns the plain success message when nothing failed or was skipped", () => {
    const result = buildInitResult({
      filesRequested: 3,
      filesParsed: 3,
      filesFailed: 0,
      failures: [],
      filesSkippedOversized: 0,
    });

    expect(result.success).toBe(true);
    expect(result.partialFailure).toBe(false);
    expect(result.message).toBe("Project initialized successfully");
  });

  it("prefers the partial-failure message over the oversized-skip message when both occurred", () => {
    const result = buildInitResult({
      filesRequested: 10,
      filesParsed: 7,
      filesFailed: 2,
      failures: [{ file: "src/broken.ts", hash: "h", error: "boom" }],
      filesSkippedOversized: 1,
    });

    expect(result.partialFailure).toBe(true);
    expect(result.message).toContain("2");
    expect(result.message).not.toContain("oversized");
  });

  it("uses the oversized-skip success message when only files were skipped, none failed", () => {
    const result = buildInitResult({
      filesRequested: 5,
      filesParsed: 5,
      filesFailed: 0,
      failures: [],
      filesSkippedOversized: 2,
    });

    expect(result.partialFailure).toBe(false);
    expect(result.message).toContain("2");
    expect(result.message).not.toBe("Project initialized successfully");
  });

  it("reproduces the audit scenario: 13 of 50 files failed", () => {
    const failures = Array.from({ length: 13 }, (_, i) => ({
      file: `src/file-${i}.ts`,
      hash: `hash-${i}`,
      error: "Worker exited with code 1",
    }));

    const result = buildInitResult({
      filesRequested: 50,
      filesParsed: 37,
      filesFailed: 13,
      failures,
      filesSkippedOversized: 0,
    });

    expect(result.success).toBe(true);
    expect(result.partialFailure).toBe(true);
    expect(result.filesParsed + result.filesFailed).toBe(result.filesRequested);
    expect(result.message).toBe(
      "Project initialized — 13 of 50 files failed to parse (see .docuvia/logs/init.log)",
    );
  });
});
