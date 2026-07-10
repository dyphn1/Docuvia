import { Parser, Language } from "web-tree-sitter";
import { LanguageRegistry } from "./language-registry.js";
import { DefaultProvider } from "./language-provider.js";
import { AstEvent } from "./sink.js";
import { AstTraverser } from "./core/ast-traverser.js";
import { EdgeComputer } from "./core/edge-computer.js";

export type WasmLoader = (wasmFileName: string) => Promise<Uint8Array | ArrayBuffer | string>;

export interface ParsedFile {
  filePath: string;
  events: AstEvent[];
}

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

  const textContent =
    typeof fileContent === "string" ? fileContent : new TextDecoder("utf-8").decode(fileContent);

  const tree = parser.parse(textContent);

  if (!tree) {
    parser.delete();
    throw new Error("Failed to parse file with tree-sitter");
  }

  try {
    // Initialize Query-based extraction if queries are configured
    if (provider instanceof DefaultProvider) {
      provider.initQueries(lang);
    }

    const traverser = new AstTraverser(provider, tree.rootNode);
    const edgeComputer = new EdgeComputer(traverser.getImports(), textContent, filePath);

    yield { type: "file", path: filePath };
    yield* traverser.extractClasses();
    yield* traverser.extractFunctions();
    yield* edgeComputer.computeCallEdges(traverser.getCalls());
  } finally {
    tree.delete();
    parser.delete();
    if (provider.deleteQueries) {
      provider.deleteQueries();
    }
  }
}
