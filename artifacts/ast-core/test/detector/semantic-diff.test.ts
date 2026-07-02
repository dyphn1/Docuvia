import fs from "fs";
import path from "path";
import { describe, it, expect, beforeAll } from "vitest";
import { Parser, Language } from "web-tree-sitter";
import { SemanticDiffDetector, PruningLevel } from "../../src/detector/semantic-diff.js";

describe("SemanticDiffDetector", () => {
  let parser: Parser;
  let language: Language;

  beforeAll(async () => {
    await Parser.init();

    const wasmPath = path.resolve(
      process.cwd(),
      "../../node_modules/.pnpm/tree-sitter-typescript@0.23.2/node_modules/tree-sitter-typescript/tree-sitter-typescript.wasm"
    );
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
    const results = detector.analyze(oldSource, newSource, [{ startRow: 2, endRow: 3 }]);

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
    const results = detector.analyze(oldSource, newSource, [{ startRow: 1, endRow: 1 }]);

    expect(results).toHaveLength(1);
    expect(results[0].pruningLevel).toBe(PruningLevel.CONTRACT_CHANGED);
  });
});
