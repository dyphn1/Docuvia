import { describe, it, expect } from "vitest";
import { parseSourceTrailer } from "./git-trailers.js";
import { GitConstants } from "../constants/git-constants.js";

describe("parseSourceTrailer()", () => {
  it("extracts the source sha from a Docuvia-Source trailer line", () => {
    const message = `Snapshot [abc1234]\n\n${GitConstants.SOURCE_COMMIT_TRAILER_KEY}: 0123456789abcdef0123456789abcdef01234567`;
    expect(parseSourceTrailer(message)).toBe(
      "0123456789abcdef0123456789abcdef01234567",
    );
  });

  it("trims surrounding whitespace on the trailer value", () => {
    const message = `${GitConstants.SOURCE_COMMIT_TRAILER_KEY}:   abcdef  `;
    expect(parseSourceTrailer(message)).toBe("abcdef");
  });

  it("returns undefined when the trailer is absent", () => {
    expect(parseSourceTrailer("Snapshot [unknown]")).toBeUndefined();
  });

  it("ignores non-trailer lines", () => {
    const message = `Some other trailer: abc\n\n${GitConstants.SOURCE_COMMIT_TRAILER_KEY}: deadbeef`;
    expect(parseSourceTrailer(message)).toBe("deadbeef");
  });
});
