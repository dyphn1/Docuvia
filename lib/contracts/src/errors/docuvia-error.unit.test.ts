import { describe, it, expect } from "vitest";
import { DocuviaError } from "./docuvia-error.js";
import { ErrorCodes } from "./error-codes.js";

describe("DocuviaError", () => {
  it("carries the given code, message, and cause", () => {
    const cause = new Error("native failure");
    const err = new DocuviaError(ErrorCodes.GIT_COMMAND_FAILED, "git failed", cause);

    expect(err.code).toBe(ErrorCodes.GIT_COMMAND_FAILED);
    expect(err.message).toBe("git failed");
    expect(err.cause).toBe(cause);
    expect(err.name).toBe("DocuviaError");
    expect(err).toBeInstanceOf(Error);
  });

  describe(".wrap()", () => {
    it("wraps a native Error, prefixing the message and preserving it as cause", () => {
      const native = new Error("ENOENT: file not found");
      const wrapped = DocuviaError.wrap(ErrorCodes.FS_READ_FAILED, "Failed to read file", native);

      expect(wrapped).toBeInstanceOf(DocuviaError);
      expect(wrapped.code).toBe(ErrorCodes.FS_READ_FAILED);
      expect(wrapped.message).toBe("Failed to read file: ENOENT: file not found");
      expect(wrapped.cause).toBe(native);
    });

    it("wraps a non-Error thrown value by stringifying it", () => {
      const wrapped = DocuviaError.wrap(ErrorCodes.DB_QUERY_FAILED, "Query failed", "boom");
      expect(wrapped.message).toBe("Query failed: boom");
    });

    it("passes an already-DocuviaError straight through unchanged (no double-wrapping)", () => {
      const original = new DocuviaError(ErrorCodes.GIT_NOT_A_REPOSITORY, "not a repo");
      const wrapped = DocuviaError.wrap(ErrorCodes.GIT_COMMAND_FAILED, "unrelated context", original);

      expect(wrapped).toBe(original);
      expect(wrapped.code).toBe(ErrorCodes.GIT_NOT_A_REPOSITORY);
    });
  });
});
