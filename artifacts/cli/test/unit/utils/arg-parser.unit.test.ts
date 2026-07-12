import { describe, it, expect } from "vitest";
import { ArgParser } from "../../../src/utils/arg-parser.js";

describe("ArgParser", () => {
  it("parses long flags with values via space", () => {
    const parser = new ArgParser(["--foo", "bar"]);
    expect(parser.hasFlag("--foo")).toBe(true);
    expect(parser.getFlagValue("--foo")).toBe("bar");
  });

  it("parses long flags with values via equals", () => {
    const parser = new ArgParser(["--foo=bar=baz"]);
    expect(parser.hasFlag("--foo")).toBe(true);
    expect(parser.getFlagValue("--foo")).toBe("bar=baz");
  });

  it("parses long boolean flags", () => {
    const parser = new ArgParser(["--foo"]);
    expect(parser.hasFlag("--foo")).toBe(true);
    expect(parser.getFlagValue("--foo")).toBeUndefined();
  });

  it("parses short flags", () => {
    const parser = new ArgParser(["-f"]);
    expect(parser.hasFlag("-f")).toBe(true);
    expect(parser.getFlagValue("-f")).toBeUndefined();
  });

  it("extracts positional arguments", () => {
    const parser = new ArgParser(["cmd", "pos1", "--foo", "pos2"]);
    expect(parser.getAllPositionals()).toEqual(["cmd", "pos1"]);
    expect(parser.getPositional(1)).toBe("pos1");
  });

  it("handles trailing equals syntax in hasFlag/getFlagValue", () => {
    const parser = new ArgParser(["--foo", "bar"]);
    expect(parser.hasFlag("--foo=")).toBe(true);
    expect(parser.getFlagValue("--foo=")).toBe("bar");
  });

  it("checkUnknownFlags throws on unknown", () => {
    const parser = new ArgParser(["--foo", "--bar"]);
    expect(() => parser.checkUnknownFlags(["--foo"])).toThrow(/Unknown option/);
  });

  it("checkUnknownFlags allows known flags", () => {
    const parser = new ArgParser(["--foo", "--bar=baz"]);
    expect(() => parser.checkUnknownFlags(["--foo", "--bar="])).not.toThrow();
  });
});
