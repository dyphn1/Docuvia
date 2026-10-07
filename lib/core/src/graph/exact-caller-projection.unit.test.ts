import { describe, expect, it } from "vitest";
import type { ParsedAstFileResult } from "@workspace/contracts";
import {
  exactCallerNodeForCall,
  type FunctionNodeReference,
} from "./call-resolution-graph-projection.js";

type ParsedCall = NonNullable<ParsedAstFileResult["data"]["calls"]>[number];

const result = { file: "src/caller.ts" } as ParsedAstFileResult;

function call(startLine: number, sourceFunction = "legacy-hint"): ParsedCall {
  return { startLine, sourceFunction } as ParsedCall;
}

function functionNode(
  nodeKey: string,
  startLine: number,
  endLine: number,
  name = nodeKey,
): FunctionNodeReference {
  return {
    nodeKey,
    name,
    startLine,
    endLine,
    declarationTargetKeys: [],
  };
}

describe("exact caller projection", () => {
  it("[happy] selects a callback arrow as the innermost caller over the legacy hint", () => {
    const caller = functionNode("src/caller.ts#outer", 1, 12, "outer");
    const callback = functionNode(
      "src/caller.ts#anonymous@L4",
      4,
      8,
      "anonymous",
    );

    expect(
      exactCallerNodeForCall(result, call(6, "outer"), [caller, callback])
        ?.nodeKey,
    ).toBe(callback.nodeKey);
  });

  it("[happy] selects the narrowest nested function span", () => {
    const outer = functionNode("src/caller.ts#outer", 1, 20);
    const nested = functionNode("src/caller.ts#nested", 5, 14);
    const innermost = functionNode("src/caller.ts#inner", 8, 10);

    expect(
      exactCallerNodeForCall(result, call(9), [outer, nested, innermost])
        ?.nodeKey,
    ).toBe(innermost.nodeKey);
  });

  it("[invalid-input] uses the file node for top-level and class-field initializer calls", () => {
    expect(exactCallerNodeForCall(result, call(1), [])?.nodeKey).toBe(
      result.file,
    );
    expect(
      exactCallerNodeForCall(result, call(30), [
        functionNode("src/caller.ts#method", 4, 12, "method"),
      ])?.nodeKey,
    ).toBe(result.file);
  });

  it("[error-handling] uses the file node when innermost spans tie or coordinates are invalid", () => {
    const tied = [
      functionNode("src/caller.ts#first", 2, 9),
      functionNode("src/caller.ts#second", 2, 9),
    ];

    expect(exactCallerNodeForCall(result, call(5), tied)?.nodeKey).toBe(
      result.file,
    );
    expect(
      exactCallerNodeForCall(result, call(Number.NaN), tied)?.nodeKey,
    ).toBe(result.file);
  });
});
