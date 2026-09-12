import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { beforeAll, describe, expect, it } from "vitest";
import { Language, Parser, type Node } from "web-tree-sitter";
import { parseOpenApiSpec } from "../src/bridge-provider.js";
import { parseImportDescriptors } from "../src/core/edge-computer.js";
import {
  PruningLevel,
  SemanticDiffDetector,
} from "../src/detector/semantic-diff.js";
import { LanguageRegistry } from "../src/language-registry.js";

// TDD-SOURCE: lib/contracts/src/interfaces/ast.interfaces.ts
// TDD-SOURCE: issue #371 Phase 3 / issue #380

const require = createRequire(import.meta.url);

function unknownNode(): Node {
  return {
    type: "comment",
    text: "// nothing to resolve",
    descendantsOfType: () => [],
    childForFieldName: () => undefined,
    namedChildren: [],
  } as unknown as Node;
}

describe("Phase 3 AST-core quality hardening", () => {
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

  it("language registry produces identical validated configuration across repeated identical loads", () => {
    const toml = `
[languages.typescript]
extensions = [".ts", ".tsx"]
wasm_file = "tree-sitter-typescript.wasm"
imports = ["import_statement"]
classes = ["class_declaration"]
functions = ["function_declaration"]
calls = ["call_expression"]
`;

    const first = LanguageRegistry.loadFromString(toml);
    const second = LanguageRegistry.loadFromString(toml);

    expect(second.getConfig()).toEqual(first.getConfig());
    expect(first.getProviderForExtension(".ts")).toBeDefined();
    expect(second.getProviderForExtension(".tsx")).toBeDefined();
  });

  it("semantic diff returns an empty result for empty and fully out-of-range changes", () => {
    const source =
      "export function stable(value: number): number { return value; }\n";
    const detector = new SemanticDiffDetector(parser, language);

    expect(detector.analyze(source, source, [])).toEqual([]);
    expect(
      detector.analyze(source, source, [{ startRow: 100, endRow: 110 }]),
    ).toEqual([]);
  });

  it("semantic diff is deterministic across repeated identical analysis", () => {
    const oldSource =
      "export function total(a: number, b: number): number { return a + b; }\n";
    const newSource =
      "export function total(a: number, b: number, c = 0): number { return a + b + c; }\n";
    const range = [{ startRow: 0, endRow: 0 }];

    const first = new SemanticDiffDetector(parser, language).analyze(
      oldSource,
      newSource,
      range,
    );
    const second = new SemanticDiffDetector(parser, language).analyze(
      oldSource,
      newSource,
      range,
    );

    expect(second).toEqual(first);
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({
      nodeId: "total",
      pruningLevel: PruningLevel.CONTRACT_CHANGED,
    });
  });

  it("bridge extraction is deterministic for identical OpenAPI input", async () => {
    const source = JSON.stringify({
      openapi: "3.0.0",
      info: { title: "Phase 3 API" },
      paths: {
        "/health": {
          get: { operationId: "health" },
        },
      },
    });

    const first = await parseOpenApiSpec(source, "openapi.json", "json");
    const second = await parseOpenApiSpec(source, "openapi.json", "json");

    expect(second).toEqual(first);
    expect(first.endpointCount).toBe(1);
  });

  it("AST-derived import extraction handles empty and unknown nodes without inventing edges", () => {
    const firstEmpty = parseImportDescriptors([]);
    const secondEmpty = parseImportDescriptors([]);
    const unknown = parseImportDescriptors([unknownNode()]);

    expect(firstEmpty).toEqual([]);
    expect(secondEmpty).toEqual(firstEmpty);
    expect(unknown).toEqual([]);
  });
});
