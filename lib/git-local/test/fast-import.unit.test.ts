import { describe, expect, it } from "vitest";
import { FAST_IMPORT_EXIT_ERROR_MESSAGE } from "../src/fast-import.js";

describe("FAST_IMPORT_EXIT_ERROR_MESSAGE", () => {
  it("falls back to the recorded stdin write error when git produced no stderr (issue #186)", () => {
    const message = FAST_IMPORT_EXIT_ERROR_MESSAGE(
      1,
      "",
      new Error("write EPIPE"),
    );
    expect(message).toBe(
      "git fast-import exited with code 1: stdin write failed: write EPIPE",
    );
  });

  it("prefers git's stderr and still appends a distinct stdin write error when both exist (issue #186)", () => {
    const message = FAST_IMPORT_EXIT_ERROR_MESSAGE(
      128,
      "fatal: invalid path '.git/internal.md'",
      new Error("write EOF"),
    );
    expect(message).toBe(
      "git fast-import exited with code 128: fatal: invalid path '.git/internal.md'; stdin write failed: write EOF",
    );
  });

  it("keeps the historical shape when neither stderr nor a stdin error is available", () => {
    expect(FAST_IMPORT_EXIT_ERROR_MESSAGE(1, "")).toBe(
      "git fast-import exited with code 1",
    );
  });
});
