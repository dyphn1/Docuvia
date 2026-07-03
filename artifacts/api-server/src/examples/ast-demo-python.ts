import { loadDefaultRegistry } from "@workspace/plugins-ast";
/**
 * AST Parsing Demo — Python
 *
 * Demonstrates tree-sitter Python grammar loading and extraction of:
 * - imports (import_statement, import_from_statement)
 * - classes (class_definition)
 * - functions (function_definition)
 * - calls (call)
 *
 * Run with: node --loader ts-node/esm artifacts/api-server/src/examples/ast-demo-python.ts
 * Or after build: node dist/examples/ast-demo-python.mjs
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { Parser, Language } from "web-tree-sitter";
import { LanguageRegistry } from "@workspace/ast-core";
import { DefaultProvider } from "@workspace/ast-core";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Sample Python source ──────────────────────────────────────────────
const samplePython = `
import os
import sys
from pathlib import Path
from typing import List, Optional, Dict

class DataProcessor:
    """Process data files with configurable pipeline."""

    def __init__(self, config: Dict[str, str]) -> None:
        self.config = config
        self._cache: Dict[str, str] = {}

    def process(self, filepath: str) -> Optional[str]:
        p = Path(filepath)
        if not p.exists():
            return None
        data = p.read_text()
        return self._transform(data)

    def _transform(self, data: str) -> str:
        return data.upper()

class Pipeline:
    def __init__(self) -> None:
        self.processors: List[DataProcessor] = []

    def add(self, processor: DataProcessor) -> None:
        self.processors.append(processor)

    def run(self, filepath: str) -> List[str]:
        results = []
        for proc in self.processors:
            result = proc.process(filepath)
            if result:
                results.append(result)
        return results

def main() -> None:
    processor = DataProcessor({"key": "value"})
    pipeline = Pipeline()
    pipeline.add(processor)
    results = pipeline.run("example.txt")
    for r in results:
        print(r)

if __name__ == "__main__":
    main()
`;

async function main() {
  // 1. Initialize the parser
  const wasmPath = path.join(__dirname, "../../node_modules/web-tree-sitter/web-tree-sitter.wasm");
  await Parser.init({ locateFile: () => wasmPath });

  // 2. Load the language registry
  const registry = await loadDefaultRegistry();
  const provider = registry.getProviderForExtension(".py");

  if (!provider) {
    console.error("ERROR: No provider found for .py extension");
    process.exit(1);
  }

  console.log(`Provider loaded: wasm_file=${provider.wasm_file}`);

  // 3. Load the Python grammar WASM
  const wasmsDir = path.join(__dirname, "../../node_modules/tree-sitter-wasms/out");
  const wasmFile = path.join(wasmsDir, "tree-sitter-python.wasm");
  const lang = await Language.load(wasmFile);

  // 4. Parse the sample source
  const parser = new Parser();
  parser.setLanguage(lang);
  const tree = parser.parse(samplePython);

  if (!tree) {
    console.error("ERROR: Failed to parse Python source");
    process.exit(1);
  }

  // 5. Initialize query-based extraction
  if (provider instanceof DefaultProvider) {
    provider.initQueries(lang);
  }

  // 6. Extract AST nodes
  const rootNode = tree.rootNode;

  const classes = provider.extractClasses(rootNode);
  const functions = provider.extractFunctions(rootNode);
  const imports = provider.extractImports(rootNode);
  const calls = provider.extractCalls(rootNode);

  // 7. Report results
  console.log("\n=== Python AST Parsing Results ===\n");

  console.log(`Imports (${imports.length}):`);
  for (const imp of imports) {
    console.log(`  - ${imp.text.split("\n")[0]}`);
  }

  console.log(`\nClasses (${classes.length}):`);
  for (const cls of classes) {
    const nameNode = cls.childForFieldName("name") || cls.descendantsOfType("identifier")[0];
    console.log(`  - ${nameNode?.text ?? "<anonymous>"}`);
  }

  console.log(`\nFunctions (${functions.length}):`);
  for (const fn of functions) {
    const nameNode = fn.childForFieldName("name") || fn.descendantsOfType("identifier")[0];
    console.log(`  - ${nameNode?.text ?? "<anonymous>"}`);
  }

  console.log(`\nCalls (${calls.length}):`);
  for (const call of calls) {
    const fnNode = call.childForFieldName("function") || call.descendantsOfType("identifier")[0];
    console.log(`  - ${fnNode?.text ?? "<unknown>"}`);
  }

  // 8. Validate expectations
  const expectedClasses = ["DataProcessor", "Pipeline"];
  const expectedFunctions = ["__init__", "process", "_transform", "__init__", "add", "run", "main"];
  const expectedImports = 4; // import os, import sys, from pathlib..., from typing...

  let passed = true;

  if (classes.length < expectedClasses.length) {
    console.error(
      `\nFAIL: Expected at least ${expectedClasses.length} classes, got ${classes.length}`
    );
    passed = false;
  }

  if (functions.length < expectedFunctions.length) {
    console.error(
      `\nFAIL: Expected at least ${expectedFunctions.length} functions, got ${functions.length}`
    );
    passed = false;
  }

  if (imports.length < expectedImports) {
    console.error(`\nFAIL: Expected at least ${expectedImports} imports, got ${imports.length}`);
    passed = false;
  }

  if (calls.length === 0) {
    console.error("\nFAIL: Expected at least 1 call, got 0");
    passed = false;
  }

  if (passed) {
    console.log("\n✅ All Python AST parsing checks passed!");
  } else {
    console.log("\n❌ Some checks failed.");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
