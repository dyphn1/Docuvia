import { describe, it, expect } from "vitest";
import { parseSourceTrailer } from "./git-trailers.js";
import { GitConstants } from "../constants/git-conventions.js";

describe("parseSourceTrailer()", () => {
  it("extracts the source sha from a Docuvia-Source trailer line", () => {
    const message = `Snapshot [abc1234]\n\n${GitConstants.SOURCE_COMMIT_TRAILER_KEY}: 0123456789abcdef0123456789abcdef01234567`;
    expect(parseSourceTrailer(message)).toBe(
      "0123456789abcdef0123456789abcdef01234567",
    );
  });

  it("trims surrounding whitespace on the trailer value", () => {
    const message = `Some subject\n\n  ${GitConstants.SOURCE_COMMIT_TRAILER_KEY}:  abcdef  \nand a trailing line`;
    expect(parseSourceTrailer(message)).toBe("abcdef");
  });

  it("returns undefined when the trailer is absent", () => {
    expect(parseSourceTrailer("Snapshot [unknown]")).toBe(undefined);
    expect(parseSourceTrailer("Docuvia-Other: abcdef\n")).toBe(undefined);
  });

  it("returns undefined for an empty message", () => {
    expect(parseSourceTrailer("")).toBe(undefined);
  });

  it("ignores non-trailer lines", () => {
    const message = `Some other trailer: abc\n\n${GitConstants.SOURCE_COMMIT_TRAILER_KEY}: deadbeef`;
    expect(parseSourceTrailer(message)).toBe("deadbeef");
  });
});
