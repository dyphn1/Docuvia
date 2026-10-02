import { beforeAll, describe, expect, it } from "vitest";
import { Language, Parser, type Tree } from "web-tree-sitter";
import { DefaultProvider, typescriptConfig } from "@workspace/ast-core";
import { resolveWasmPath } from "./resolve-wasm-path.js";
import { extractTierAIndexedDeclarations } from "./tier-a-declaration-index.js";

const FIXTURES = [
  {
    file: "src/identity.ts",
    source:
      "interface Identity { installId: string }\nexport function installId() {}",
    nodeKey: "src/identity.ts#installId",
    expectedText: "function installId() {}",
  },
  {
    file: "src/count.ts",
    source:
      "function describe() { const count = 4; }\nexport function count() {}",
    nodeKey: "src/count.ts#count",
    expectedText: "function count() {}",
  },
  {
    file: "src/yellow.ts",
    source: 'const palette = { yellow: true };\nexport const yellow = "gold";',
    nodeKey: "src/yellow.ts#yellow",
    expectedText: 'yellow = "gold"',
  },
  {
    file: "src/conflict-policy.ts",
    source: [
      "const policy = { verbose: true, error: false, log: true, warn: true, debug: false };",
      "export function verbose() {}",
      "export function error() {}",
      "export function log() {}",
      "export function warn() {}",
      "export function debug() {}",
    ].join("\n"),
    nodeKey: "src/conflict-policy.ts#verbose",
    expectedText: "function verbose() {}",
  },
  {
    file: "src/serve.ts",
    source: "const options = { close: true };\nexport function close() {}",
    nodeKey: "src/serve.ts#close",
    expectedText: "function close() {}",
  },
  {
    file: "src/overloads.ts",
    source: [
      "export function parse(value: string): string;",
      "export function parse(value: number): number;",
      "export function parse(value: string | number) { return value; }",
    ].join("\n"),
    nodeKey: "src/overloads.ts#parse",
    expectedText: "function parse(value: string | number) { return value; }",
  },
  {
    file: "src/parse-array-pipe.ts",
    source: [
      "class ParseArrayPipe {",
      "  constructor() { consume({ transform: true }); }",
      "  transform(value: unknown) { return value; }",
      "}",
    ].join("\n"),
    nodeKey: "src/parse-array-pipe.ts#ParseArrayPipe.transform",
    expectedText: "transform(value: unknown) { return value; }",
  },
  {
    file: "src/callback.ts",
    source: [
      'describe("queue", () => {',
      "  const flush = () => {};",
      "  class CallbackService { run() {} }",
      "  const adapter = { run(value: string) { return value; } };",
      "});",
    ].join("\n"),
    nodeKey: "src/callback.ts#flush",
    expectedText: "() => {}",
  },
] as const;

describe("Tier A TypeScript declaration index", () => {
  let parser: Parser;
  let provider: DefaultProvider;

  beforeAll(async () => {
    await Parser.init();
    const { wasmPath, attemptedPaths } = resolveWasmPath(
      typescriptConfig.wasm_file,
    );
    const language = await Language.load(wasmPath);
    parser = new Parser();
    parser.setLanguage(language);
    provider = new DefaultProvider(typescriptConfig);
    provider.initQueries?.(language);
    if (!wasmPath)
      throw new Error(
        `TypeScript grammar not found: ${attemptedPaths.join(", ")}`,
      );
  });

  it.each(FIXTURES)(
    "[happy] uses Tier A's exact node key for $file",
    ({ file, source, nodeKey, expectedText }) => {
      const tree = parser.parse(source);
      expect(tree).not.toBeNull();
      if (!tree) return;
      const declarations = extractTierAIndexedDeclarations(
        file,
        tree,
        provider,
      );
      tree.delete();

      const declaration = declarations.find(
        (candidate) => candidate.nodeKey === nodeKey,
      );
      expect(declaration).toBeDefined();
      expect(declaration?.sourceText).toContain(expectedText);
    },
  );

  it.each(["verbose", "error", "log", "warn", "debug"])(
    "keeps the exported conflict-policy %s function ahead of its object property",
    (name) => {
      const source = [
        "const policy = { verbose: true, error: false, log: true, warn: true, debug: false };",
        ...["verbose", "error", "log", "warn", "debug"].map(
          (functionName) => `export function ${functionName}() {}`,
        ),
      ].join("\n");
      const tree = parser.parse(source);
      expect(tree).not.toBeNull();
      if (!tree) return;
      const declarations = extractTierAIndexedDeclarations(
        "src/conflict-policy.ts",
        tree,
        provider,
      );
      tree.delete();

      const declaration = declarations.find(
        (candidate) => candidate.nodeKey === `src/conflict-policy.ts#${name}`,
      );
      expect(declaration?.sourceText).toContain(`function ${name}() {}`);
    },
  );

  it("assigns the exact @L identity to a callback object method and keeps callback classes qualified", () => {
    const source = [
      'describe("adapter", () => {',
      "  const first = {",
      "    run() {},",
      "  };",
      "  const adapter = {",
      "    run(value: string) { return value; },",
      "  };",
      "  class CallbackService {",
      "    run(value: number) { return value; }",
      "  }",
      "});",
    ].join("\n");
    const tree = parser.parse(source);
    expect(tree).not.toBeNull();
    if (!tree) return;
    const declarations = extractTierAIndexedDeclarations(
      "src/callback-members.ts",
      tree,
      provider,
    );
    tree.delete();

    expect(
      declarations.find(
        (declaration) =>
          declaration.nodeKey === "src/callback-members.ts#run@L5",
      )?.sourceText,
    ).toContain("run(value: string)");
    expect(
      declarations.find(
        (declaration) =>
          declaration.nodeKey === "src/callback-members.ts#CallbackService.run",
      )?.sourceText,
    ).toContain("run(value: number)");
  });

  it("uses the decorated Tier A method's own @L node key", () => {
    const source = [
      "class Logger {",
      "  warn() {}",
      "  @Trace()",
      "  warn(message: string) {}",
      "}",
    ].join("\n");
    const tree = parser.parse(source);
    expect(tree).not.toBeNull();
    if (!tree) return;
    const declarations = extractTierAIndexedDeclarations(
      "src/logger.ts",
      tree,
      provider,
    );
    tree.delete();

    expect(
      declarations.find(
        (declaration) => declaration.nodeKey === "src/logger.ts#Logger.warn@L3",
      )?.sourceText,
    ).toContain("warn(message: string)");
  });

  it("[invalid-input] [error-handling] returns no declarations for malformed TypeScript", () => {
    const tree = parser.parse("export const =;");
    if (tree === null) throw new Error("Tree-sitter returned no parse tree.");

    expect(tree.rootNode.hasError).toBe(true);
    expect(
      extractTierAIndexedDeclarations("src/malformed.ts", tree, provider),
    ).toEqual([]);
    tree.delete();
  });
});
