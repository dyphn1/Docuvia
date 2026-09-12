import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { beforeAll, describe, expect, it } from "vitest";
import { Language, Parser, type Node } from "web-tree-sitter";
import { DefaultProvider, type LanguageConfig } from "@workspace/ast-core";
import { cConfig, csharpConfig } from "../src/languages/index.js";

// TDD-SOURCE: lib/contracts/src/interfaces/ast.interfaces.ts
// TDD-SOURCE: issue #371 Phase 3 / issue #380

const require = createRequire(import.meta.url);

function resolveWasmPath(wasmFile: string): string {
  const docuviaRoot = path.resolve(__dirname, "../../../../");
  try {
    const packagePath = require.resolve("tree-sitter-wasms/package.json", {
      paths: [__dirname, docuviaRoot],
    });
    const candidate = path.join(path.dirname(packagePath), "out", wasmFile);
    if (fs.existsSync(candidate)) return candidate;
  } catch {
    // Fall through to workspace candidates.
  }

  const candidates = [
    path.resolve(docuviaRoot, `node_modules/tree-sitter-wasms/out/${wasmFile}`),
    path.resolve(
      __dirname,
      `../../../node_modules/tree-sitter-wasms/out/${wasmFile}`,
    ),
  ];
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) {
    throw new Error(`${wasmFile} not found. Tried: ${candidates.join(", ")}`);
  }
  return found;
}

function resolveCallableName(node: Node): string {
  const name = node.childForFieldName("name");
  if (name) return name.text;

  const declarator = node.childForFieldName("declarator");
  if (declarator) return resolveCallableName(declarator);

  if (
    node.type === "identifier" ||
    node.type === "field_identifier" ||
    node.type === "type_identifier"
  ) {
    return node.text;
  }

  return node.text;
}

interface Fixture {
  name: string;
  config: LanguageConfig;
  source: string;
  expectedFunctions: string[];
  expectedClasses: string[];
  expectedImportText: string;
  malformed: string;
}

const fixtures: Fixture[] = [
  {
    name: "C",
    config: cConfig,
    source: `
#include <stdio.h>
struct Calculator { int value; };
int add(int a, int b) { return a + b; }
int main(void) { printf("%d", add(1, 2)); return 0; }
`,
    expectedFunctions: ["add", "main"],
    expectedClasses: ["Calculator"],
    expectedImportText: "stdio.h",
    malformed: "int broken(",
  },
  {
    name: "C#",
    config: csharpConfig,
    source: `
using System;
public class Calculator {
  public int Add(int a, int b) { return a + b; }
  public void Run() { Console.WriteLine(Add(1, 2)); }
}
`,
    expectedFunctions: ["Add", "Run"],
    expectedClasses: ["Calculator"],
    expectedImportText: "System",
    malformed: "public class Broken { public void Run(",
  },
];

async function extract(config: LanguageConfig, source: string) {
  const language = await Language.load(resolveWasmPath(config.wasm_file));
  const parser = new Parser();
  parser.setLanguage(language);
  const tree = parser.parse(source);
  if (!tree) throw new Error(`Failed to parse ${config.wasm_file}`);

  const provider = new DefaultProvider(config);
  provider.initQueries(language);
  try {
    return {
      functions: provider.extractFunctions(tree.rootNode).map(resolveCallableName),
      classes: provider
        .extractClasses(tree.rootNode)
        .map((node) => node.childForFieldName("name")?.text ?? node.text),
      imports: provider.extractImports(tree.rootNode).map((node) => node.text),
      queryFailures: provider.drainQueryCompileFailures(),
    };
  } finally {
    provider.deleteQueries();
    tree.delete();
    parser.delete();
  }
}

describe("Phase 3 language extraction hardening", () => {
  beforeAll(async () => {
    await Parser.init();
  });

  for (const fixture of fixtures) {
    it(`extracts complete ${fixture.name} fixture data with real grammar WASM`, async () => {
      const result = await extract(fixture.config, fixture.source);

      expect(result.queryFailures).toEqual([]);
      for (const name of fixture.expectedFunctions) {
        expect(result.functions).toContain(name);
      }
      for (const name of fixture.expectedClasses) {
        expect(result.classes).toContain(name);
      }
      expect(
        result.imports.some((value) => value.includes(fixture.expectedImportText)),
      ).toBe(true);
    });

    it(`${fixture.name} malformed source remains bounded and deterministic across reruns`, async () => {
      const first = await extract(fixture.config, fixture.malformed);
      const second = await extract(fixture.config, fixture.malformed);

      expect(second).toEqual(first);
      expect(first.queryFailures).toEqual([]);
      expect(Array.isArray(first.functions)).toBe(true);
      expect(Array.isArray(first.classes)).toBe(true);
      expect(Array.isArray(first.imports)).toBe(true);
    });
  }
});
