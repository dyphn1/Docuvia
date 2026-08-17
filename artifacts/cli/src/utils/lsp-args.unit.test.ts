import { describe, it, expect } from "vitest";
import { DocuviaError, ErrorCodes } from "@workspace/contracts";
import { parseLspArgs, splitShellWords } from "./lsp-args.js";

describe("splitShellWords()", () => {
  it("splits plain whitespace-separated tokens", () => {
    expect(splitShellWords("--foo --bar=1 -x")).toEqual([
      "--foo",
      "--bar=1",
      "-x",
    ]);
  });

  it("collapses runs of whitespace and drops leading/trailing spaces", () => {
    expect(splitShellWords("  --foo   --bar  ")).toEqual(["--foo", "--bar"]);
  });

  it("keeps a double-quoted token intact (the pre-fix split(' ') bug)", () => {
    expect(splitShellWords('--tsserver-path "C:\\Program Files\\x"')).toEqual([
      "--tsserver-path",
      "C:\\Program Files\\x",
    ]);
  });

  it("keeps a single-quoted token intact", () => {
    expect(splitShellWords("--flag 'a b c'")).toEqual(["--flag", "a b c"]);
  });

  it("honors backslash escapes outside quotes", () => {
    expect(splitShellWords("a\\ b c")).toEqual(["a b", "c"]);
  });

  it('honors \\" and \\\\ inside double quotes', () => {
    expect(splitShellWords('"say \\"hi\\"" "a\\\\b"')).toEqual([
      'say "hi"',
      "a\\b",
    ]);
  });

  it("mixes quote styles within one command line", () => {
    expect(splitShellWords("--a \"x y\" --b 'z w' --c v")).toEqual([
      "--a",
      "x y",
      "--b",
      "z w",
      "--c",
      "v",
    ]);
  });

  it("consumes an unterminated quote leniently to end-of-input", () => {
    expect(splitShellWords('--a "x y')).toEqual(["--a", "x y"]);
  });
});

describe("parseLspArgs()", () => {
  it("returns undefined for an absent value", () => {
    expect(parseLspArgs(undefined)).toBeUndefined();
  });

  it("returns undefined for a blank value (mirrors the pre-fix falsy contract)", () => {
    expect(parseLspArgs("")).toBeUndefined();
    expect(parseLspArgs("   ")).toBeUndefined();
  });

  it("falls back to POSIX-style word splitting for the space-separated form (backward compatible)", () => {
    expect(parseLspArgs("--foo --bar=1")).toEqual(["--foo", "--bar=1"]);
  });

  it("parses the JSON array form verbatim", () => {
    expect(
      parseLspArgs('["--tsserver-path", "C:\\\\Program Files\\\\x"]'),
    ).toEqual(["--tsserver-path", "C:\\Program Files\\x"]);
  });

  it("accepts an empty JSON array as an explicit empty override", () => {
    expect(parseLspArgs("[]")).toEqual([]);
  });

  it("throws INVALID_INPUT for a leading-[ value that is not valid JSON", () => {
    try {
      parseLspArgs('["--foo"');
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(DocuviaError);
      expect((err as DocuviaError).code).toBe(ErrorCodes.INVALID_INPUT);
    }
  });

  it("throws INVALID_INPUT for a JSON array containing non-string elements", () => {
    try {
      parseLspArgs('["--foo", 42]');
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(DocuviaError);
      expect((err as DocuviaError).code).toBe(ErrorCodes.INVALID_INPUT);
    }
  });
});
