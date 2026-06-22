import { Parser, Language, Tree } from "web-tree-sitter";
import { LanguageRegistry } from "./language-registry.js";
import { LanguageProvider, DefaultProvider } from "./language-provider.js";

import { AstEvent } from "./sink.js";

export type WasmLoader = (wasmFileName: string) => Promise<Uint8Array | ArrayBuffer | string>;

export async function initParser(locateFile: (path: string) => string): Promise<void> {
  await Parser.init({ locateFile });
}

export async function* generateAst(
  fileContent: string | Uint8Array,
  filePath: string,
  ext: string,
  registry: LanguageRegistry,
  loadWasm: WasmLoader
): AsyncGenerator<AstEvent, void, undefined> {
  const provider = registry.getProviderForExtension(ext);
  if (!provider) {
    throw new Error(`No language provider found for extension: ${ext}`);
  }

  const wasmFileName = provider.wasm_file;
  let wasmBytesOrPath;
  try {
    wasmBytesOrPath = await loadWasm(wasmFileName);
  } catch (error) {
    console.warn(`Failed to load grammar WASM ${wasmFileName}:`, error);
    return;
  }

  // Handle both Uint8Array/ArrayBuffer and string paths
  const lang =
    typeof wasmBytesOrPath === "string"
      ? await Language.load(wasmBytesOrPath)
      : await Language.load(new Uint8Array(wasmBytesOrPath as any));

  const parser = new Parser();
  parser.setLanguage(lang);

  const tree = parser.parse(
    typeof fileContent === "string" ? fileContent : new TextDecoder("utf-8").decode(fileContent)
  );

  if (!tree) {
    parser.delete();
    throw new Error("Failed to parse file with tree-sitter");
  }

  try {
    // Initialize Query-based extraction if queries are configured
    if (provider instanceof DefaultProvider) {
      provider.initQueries(lang);
    }

    const scopeMap = new Map<string, string>();

    const importStatements = provider.extractImports(tree.rootNode);
    for (const stmt of importStatements) {
      const sourceNode = stmt.descendantsOfType("string").pop();
      if (!sourceNode) continue;
      const sourceText = sourceNode.text.replace(/['"]/g, "");

      const identifiers = stmt.descendantsOfType("identifier");
      for (const idNode of identifiers) {
        scopeMap.set(idNode.text, `${sourceText}::${idNode.text}`);
      }
    }

    const classDecls = provider.extractClasses(tree.rootNode);
    const functionDecls = provider.extractFunctions(tree.rootNode);
    const callExprs = provider.extractCalls(tree.rootNode);

    yield { type: "file", path: filePath };

    for (const cls of classDecls) {
      const nameNode = cls.childForFieldName("name") || cls.descendantsOfType("identifier")[0];
      if (nameNode) {
        yield { type: "class", name: nameNode.text };
      }
    }

    for (const fn of functionDecls) {
      const nameNode = fn.childForFieldName("name") || fn.descendantsOfType("identifier")[0];
      if (nameNode) {
        yield { type: "function", name: nameNode.text };
      }
    }

    // For extracting the file name cleanly:
    const baseName = filePath.split(/[/\\]/).pop() || "";

    for (const call of callExprs) {
      const functionNameNode =
        call.childForFieldName("function") || call.descendantsOfType("identifier")[0];
      if (functionNameNode) {
        const fnName = functionNameNode.text;
        const fqn = scopeMap.has(fnName) ? scopeMap.get(fnName) : `${baseName}::${fnName}`;
        yield { type: "call", name: fqn };
      }
    }
  } finally {
    tree.delete();
    parser.delete();
    if (provider.deleteQueries) {
      provider.deleteQueries();
    }
  }
}
