import { Parser, Language } from "web-tree-sitter";
import { UTF8_ENCODING } from "@workspace/contracts";
import { LanguageRegistry } from "./language-registry.js";
import { DefaultProvider } from "./language-provider.js";
import { AstEvent } from "./sink.js";
import { AstTraverser } from "./core/ast-traverser.js";
import { EdgeComputer } from "./core/edge-computer.js";
import { AstEventType } from "./constants/ast-event-constants.js";

const ParserErrorMessages = {
  NO_LANGUAGE_PROVIDER: (ext: string) =>
    `No language provider found for extension: ${ext}`,
  WASM_LOAD_FAILED: (wasmFileName: string, msg: string) =>
    `Failed to load grammar WASM ${wasmFileName}: ${msg}`,
  PARSE_FAILED: "Failed to parse file with tree-sitter",
} as const;

function toUint8Array(input: unknown): Uint8Array {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  throw new TypeError(
    `Expected Uint8Array or ArrayBuffer from WASM loader, got ${typeof input}`,
  );
}

export type WasmLoader = (
  wasmFileName: string,
) => Promise<Uint8Array | ArrayBuffer | string>;

export interface ParsedFile {
  filePath: string;
  events: AstEvent[];
}

export async function initParser(
  locateFile: (path: string) => string,
): Promise<void> {
  await Parser.init({ locateFile });
}

export async function* generateAst(
  fileContent: string | Uint8Array,
  filePath: string,
  ext: string,
  registry: LanguageRegistry,
  loadWasm: WasmLoader,
): AsyncGenerator<AstEvent, void, undefined> {
  const provider = registry.getProviderForExtension(ext);
  if (!provider) {
    throw new Error(ParserErrorMessages.NO_LANGUAGE_PROVIDER(ext));
  }

  const wasmFileName = provider.wasm_file;
  let wasmBytesOrPath;
  try {
    wasmBytesOrPath = await loadWasm(wasmFileName);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    throw new Error(ParserErrorMessages.WASM_LOAD_FAILED(wasmFileName, msg));
  }

  // Handle both Uint8Array/ArrayBuffer and string paths
  const lang =
    typeof wasmBytesOrPath === "string"
      ? await Language.load(wasmBytesOrPath)
      : await Language.load(toUint8Array(wasmBytesOrPath));

  const parser = new Parser();
  parser.setLanguage(lang);

  const textContent =
    typeof fileContent === "string"
      ? fileContent
      : new TextDecoder(UTF8_ENCODING).decode(fileContent);

  const tree = parser.parse(textContent);

  if (!tree) {
    parser.delete();
    throw new Error(ParserErrorMessages.PARSE_FAILED);
  }

  try {
    // Initialize Query-based extraction if queries are configured
    if (provider instanceof DefaultProvider) {
      provider.initQueries(lang);
    }

    const traverser = new AstTraverser(provider, tree.rootNode);
    const edgeComputer = new EdgeComputer(
      traverser.getImports(),
      textContent,
      filePath,
    );

    yield { type: AstEventType.FILE, path: filePath };
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
