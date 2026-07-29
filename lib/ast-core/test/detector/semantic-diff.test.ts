import fs from "fs";
import path from "path";
import { describe, it, expect, beforeAll } from "vitest";
import { Parser, Language } from "web-tree-sitter";
import {
  SemanticDiffDetector,
  PruningLevel,
} from "../../src/detector/semantic-diff.js";

import { createRequire } from "module";

const require = createRequire(import.meta.url);

describe("SemanticDiffDetector", () => {
  let parser: Parser;
  let language: Language;

  beforeAll(async () => {
    await Parser.init();

    let wasmPath = "";
    try {
      wasmPath =
        require.resolve("tree-sitter-wasms/out/tree-sitter-typescript.wasm");
    } catch {
      wasmPath = path.resolve(
        __dirname,
        "../../../node_modules/tree-sitter-wasms/out/tree-sitter-typescript.wasm",
      );
    }
    const wasmBytes = fs.readFileSync(wasmPath);
    language = await Language.load(new Uint8Array(wasmBytes));

    parser = new Parser();
    parser.setLanguage(language);
  });

  it("should classify INTERNAL_LOGIC for body changes in a function", () => {
    const oldSource = `
      function calculateSum(a: number, b: number): number {
        return a + b;
      }
    `;
    const newSource = `
      function calculateSum(a: number, b: number): number {
        const sum = a + b;
        return sum;
      }
    `;

    const detector = new SemanticDiffDetector(parser, language);
    const results = detector.analyze(oldSource, newSource, [
      { startRow: 2, endRow: 3 },
    ]);

    expect(results).toHaveLength(1);
    expect(results[0].nodeType).toBe("function_declaration");
    expect(results[0].pruningLevel).toBe(PruningLevel.INTERNAL_LOGIC);
  });

  it("should classify CONTRACT_CHANGED for parameter changes", () => {
    const oldSource = `
      export function calculateSum(a: number, b: number): number {
        return a + b;
      }
    `;
    const newSource = `
      export function calculateSum(a: number, b: number, c: number = 0): number {
        return a + b + c;
      }
    `;

    const detector = new SemanticDiffDetector(parser, language);
    const results = detector.analyze(oldSource, newSource, [
      { startRow: 1, endRow: 1 },
    ]);

    expect(results).toHaveLength(1);
    expect(results[0].pruningLevel).toBe(PruningLevel.CONTRACT_CHANGED);
  });

  // 2026-07-29 regression: a hunk range spanning a leading blank line/doc comment before a new
  // function's declaration used to be silently dropped -- `getSmallestContainingNode` requires a
  // single AST child to fully contain the *whole* range, but a comment + declaration are separate
  // top-level siblings, so no child qualified and the search bubbled all the way to the untyped
  // `program` root, where `findSemanticBoundary` dead-ended. See semantic-diff.ts's
  // `resolveSpanningBoundaries`.
  it("should classify CONTRACT_CHANGED for a new documented function (range spans blank line + doc comment + declaration)", () => {
    const oldSource = `export function existing(): void {}\n`;
    const newSource =
      `export function existing(): void {}\n` +
      `\n` +
      `/**\n` +
      ` * A brand-new documented function.\n` +
      ` */\n` +
      `export function newlyAdded(value: number): number {\n` +
      `  return value + 1;\n` +
      `}\n`;

    const detector = new SemanticDiffDetector(parser, language);
    // Rows 1-7 (0-indexed): blank line, 3-line doc comment, 3-line function -- the exact shape a
    // `git diff --unified=0` hunk produces for a newly-appended documented function.
    const results = detector.analyze(oldSource, newSource, [
      { startRow: 1, endRow: 7 },
    ]);

    expect(results).toHaveLength(1);
    expect(results[0].nodeId).toBe("newlyAdded");
    expect(results[0].pruningLevel).toBe(PruningLevel.CONTRACT_CHANGED);
  });

  // Same failure mode for a brand-new file: the whole-file range spans the leading doc comment
  // and the function it documents, both direct children of `program`.
  it("should classify CONTRACT_CHANGED for a brand-new file whose only content is a documented function", () => {
    const oldSource = "";
    const newSource =
      `/**\n` +
      ` * Docuvia benchmark probe.\n` +
      ` */\n` +
      `export function docuviaBenchmarkProbe(value: string): string {\n` +
      `  return \`probe:\${value}\`;\n` +
      `}\n`;

    const detector = new SemanticDiffDetector(parser, language);
    const results = detector.analyze(oldSource, newSource, [
      { startRow: 0, endRow: 5 },
    ]);

    expect(results).toHaveLength(1);
    expect(results[0].nodeId).toBe("docuviaBenchmarkProbe");
    expect(results[0].pruningLevel).toBe(PruningLevel.CONTRACT_CHANGED);
  });

  // Guards against the fallback over-firing: a range spanning two statements *inside* the same
  // function body must still bubble up to the enclosing function (existing behavior), not
  // decompose into the individual inner statements -- an inner `const`/`let` would otherwise
  // spuriously match `LEXICAL_DECLARATION` in `SEMANTIC_TYPES` and report itself as a new,
  // unrelated CONTRACT_CHANGED symbol.
  it("should still attribute a multi-statement body change to the enclosing function, not its inner statements", () => {
    const oldSource = `
      function calculateSum(a: number, b: number): number {
        return a + b;
      }
    `;
    const newSource = `
      function calculateSum(a: number, b: number): number {
        const sum = a + b;
        return sum;
      }
    `;

    const detector = new SemanticDiffDetector(parser, language);
    const results = detector.analyze(oldSource, newSource, [
      { startRow: 2, endRow: 3 },
    ]);

    expect(results).toHaveLength(1);
    expect(results[0].nodeType).toBe("function_declaration");
    expect(results[0].pruningLevel).toBe(PruningLevel.INTERNAL_LOGIC);
  });
});
