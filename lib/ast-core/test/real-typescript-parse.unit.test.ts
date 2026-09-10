import { describe, it, expect, beforeAll } from "vitest";
import { Parser, Language, type Node } from "web-tree-sitter";
import * as path from "node:path";
import * as fs from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

/** Minimal copy of the plugins-ast wasm resolver (ast-core must not import plugins-ast). */
function resolveWasmPath(wasmFile: string): string {
  const docuviaRoot = path.resolve(__dirname, "../../../");
  try {
    const packagePath = require.resolve("tree-sitter-wasms/package.json", {
      paths: [__dirname, docuviaRoot],
    });
    const wasmPath = path.join(path.dirname(packagePath), "out", wasmFile);
    if (fs.existsSync(wasmPath)) return wasmPath;
  } catch {
    // fall through
  }
  throw new Error(`${wasmFile} not found under ${docuviaRoot}`);
}

function countByType(root: Node, type: string): Node[] {
  return root.descendantsOfType(type);
}

/**
 * Real tree-sitter parse (no mocks) asserting output *content*, not just shape
 * (issue #233): node-type distribution plus concrete names for a known snippet.
 */
describe("real TypeScript parse output content (issue #233)", () => {
  let rootNode: Node;

  beforeAll(async () => {
    await Parser.init();
    const lang = await Language.load(
      resolveWasmPath("tree-sitter-typescript.wasm"),
    );
    const parser = new Parser();
    parser.setLanguage(lang);
    const tree = parser.parse("function foo() { bar(); }\n");
    if (!tree) throw new Error("Failed to parse fixture snippet");
    rootNode = tree.rootNode;
  });

  it("produces a program root with one function_declaration named foo", () => {
    expect(rootNode.type).toBe("program");
    const fns = countByType(rootNode, "function_declaration");
    expect(fns).toHaveLength(1);
    expect(fns[0]?.childForFieldName("name")?.text).toBe("foo");
  });

  it("captures the bar() call_expression with its concrete callee name", () => {
    const calls = countByType(rootNode, "call_expression");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.childForFieldName("function")?.text).toBe("bar");
  });
});
