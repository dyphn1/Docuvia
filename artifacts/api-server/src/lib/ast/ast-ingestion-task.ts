import { ENCODING_HEX, ENCODING_BASE64, HASH_ALGO_SHA256, HASH_ALGO_MD5 } from "@workspace/core";
import { ENCODING_UTF_8, UTF8_ENCODING } from "@workspace/core";
import { buildScopeMap, classifyCall, NAMESPACE_DELIMITER } from "./ast-helpers.js";
import { AST_INGESTION_DEFAULTS } from "../../constants/index.js";
import {
  AST_NODE_TYPES,
  AST_FIELD_NAMES,
  AST_EVENTS,
  AST_STATUS,
  AST_MESSAGES,
} from "@workspace/core";
import { loadDefaultRegistry } from "@workspace/plugins-ast";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { Parser, Language } from "web-tree-sitter";

import { createRequire } from "node:module";
import { LanguageRegistry } from "@workspace/ast-core";
import { LanguageProvider, DefaultProvider } from "@workspace/ast-core";

const require = createRequire(import.meta.url);

let parserInitialized = false;
let registry: LanguageRegistry | null = null;
let sharedParser: Parser | null = null;

const languageCache = new Map<string, Language>();

async function initParser() {
  if (!parserInitialized) {
    const wasmPath = path.join(
      path.dirname(require.resolve("web-tree-sitter")),
      "web-tree-sitter.wasm"
    );
    await Parser.init({ locateFile: () => wasmPath });
    parserInitialized = true;
  }
  if (!registry) {
    // Assuming the root is two levels up from artifacts/api-server, or process.cwd() is ok
    registry = await loadDefaultRegistry();
  }
}

/**
 * Gets or initializes the shared Parser instance to avoid native/WASM re-instantiation.
 */
function getSharedParser(): Parser {
  if (!sharedParser) {
    sharedParser = new Parser();
  }
  return sharedParser;
}

async function loadLanguage(
  ext: string
): Promise<{ lang: Language | null; provider: LanguageProvider | undefined }> {
  if (!registry) {
    throw new Error(AST_MESSAGES.REGISTRY_UNINITIALIZED);
  }

  const provider = registry.getProviderForExtension(ext);
  if (!provider) {
    return { lang: null, provider: undefined };
  }

  const wasmFileName = provider.wasm_file;

  if (languageCache.has(wasmFileName)) {
    return { lang: languageCache.get(wasmFileName)!, provider };
  }

  try {
    // Attempt to load the grammar from the current working directory's wasm folder or fallback to root
    let wasmPath = path.resolve(process.cwd(), wasmFileName);

    // Check if it exists, otherwise fallback to tree-sitter-wasms or tree-sitter-typescript
    try {
      await fs.access(wasmPath);
    } catch {
      try {
        const wasmsPkgPath = require.resolve("tree-sitter-wasms/package.json");
        wasmPath = path.join(path.dirname(wasmsPkgPath), "out", wasmFileName);
      } catch (err) {
        // Fallback to individual language packages if tree-sitter-wasms is missing or fails
        try {
          const pkgName = wasmFileName.replace(".wasm", ""); // e.g. tree-sitter-typescript.wasm -> tree-sitter-typescript
          const langPkgPath = require.resolve(`${pkgName}/package.json`);
          wasmPath = path.join(path.dirname(langPkgPath), wasmFileName);
        } catch (innerErr) {
          // Ignore and let Language.load fail
        }
      }
    }

    const lang = await Language.load(wasmPath);
    languageCache.set(wasmFileName, lang);
    return { lang, provider };
  } catch (error) {
    // Gracefully fail if wasm is not present yet
    console.warn(`Failed to load grammar WASM ${wasmFileName}:`, error);
    return { lang: null, provider };
  }
}

export interface ParseResult {
  status: typeof AST_STATUS.DONE | typeof AST_STATUS.ERROR;
  file?: string;
  reason?: string;
}

/**
 * Writes the extracted skeleton array into a temporary JSONL file.
 */
async function writeSkeletonToJsonl(skeleton: string[], prefix: string): Promise<string> {
  const tempFileName = `${prefix}${crypto.randomBytes(8).toString(ENCODING_HEX)}${AST_INGESTION_DEFAULTS.TEMP_FILE_EXT_JSONL}`;
  const tempFilePath = path.join(os.tmpdir(), tempFileName);
  await fs.writeFile(tempFilePath, skeleton.join("\n") + "\n", ENCODING_UTF_8);
  return tempFilePath;
}

/**
 * Tries to parse the file using OpenAPI/Swagger spec parsing.
 * Returns the temp file path if parsing succeeds, otherwise null.
 */
async function tryParseOpenApiBridge(
  filePath: string,
  ext: string,
  fileContent: string
): Promise<string | null> {
  try {
    const { isOpenApiFile, parseOpenApiSpec } = await import("@workspace/ast-core");
    if (isOpenApiFile(fileContent, ext)) {
      const format =
        ext === AST_INGESTION_DEFAULTS.EXTENSION_JSON
          ? AST_INGESTION_DEFAULTS.OPENAPI_FORMAT_JSON
          : AST_INGESTION_DEFAULTS.OPENAPI_FORMAT_YAML;
      const result = await parseOpenApiSpec(fileContent, filePath, format);
      if (result.events.length > 0) {
        const skeleton = result.events.map((e) => JSON.stringify(e));
        return await writeSkeletonToJsonl(skeleton, AST_INGESTION_DEFAULTS.TEMP_FILE_PREFIX_BRIDGE);
      }
    }
  } catch (bridgeErr: any) {
    // Bridge failed — log and fall through to tree-sitter path
    console.warn(`Bridge provider failed for ${filePath}:`, bridgeErr.message);
  }
  return null;
}

export async function processAstFile(filePath: string): Promise<ParseResult> {
  await initParser();

  const fileContent = await fs.readFile(filePath, ENCODING_UTF_8);
  const ext = path.extname(filePath);

  // ── Bridge Provider: OpenAPI/Swagger specs ──────────────────────
  // If the file is an API contract, emit api_contract events instead of
  // tree-sitter AST events. This enables cross-language edge detection
  // between API definitions and their consumers.
  const openApiFilePath = await tryParseOpenApiBridge(filePath, ext, fileContent);
  if (openApiFilePath) {
    return { status: AST_STATUS.DONE, file: openApiFilePath };
  }

  const { lang, provider } = await loadLanguage(ext);

  if (!lang || !provider) {
    // If we can't load the language, we can't parse it with tree-sitter.
    // Return early or fallback. We'll return early for this implementation.
    return { status: AST_STATUS.ERROR, reason: `${AST_MESSAGES.GRAMMAR_NOT_FOUND} ${ext}` };
  }

  const parser = getSharedParser();
  parser.setLanguage(lang);

  const tree = parser.parse(fileContent);
  if (!tree) {
    return { status: AST_STATUS.ERROR, reason: AST_MESSAGES.PARSE_FAILED };
  }

  // Initialize Query-based extraction if queries are configured
  if (provider instanceof DefaultProvider) {
    provider.initQueries(lang);
  }

  const importStatements = provider.extractImports(tree.rootNode);
  const scopeMap = buildScopeMap(importStatements);

  const classDecls = provider.extractClasses(tree.rootNode);
  const functionDecls = provider.extractFunctions(tree.rootNode);
  const callExprs = provider.extractCalls(tree.rootNode);

  const skeleton: string[] = [];
  skeleton.push(JSON.stringify({ type: AST_EVENTS.FILE, path: filePath }));

  // ── Emit import events for edge creation ──────────────────────────
  // Each import is emitted as a separate event with the resolved source path.
  // The pipeline uses these to create DEPENDS_ON links between L2 nodes.
  for (const [localName, resolvedSource] of scopeMap.entries()) {
    // Skip self-references and unresolved sources
    if (!resolvedSource || resolvedSource === filePath) continue;
    skeleton.push(
      JSON.stringify({
        type: AST_EVENTS.IMPORT,
        source: resolvedSource,
        localName,
      })
    );
  }

  for (const cls of classDecls) {
    const nameNode =
      cls.childForFieldName(AST_FIELD_NAMES.NAME) ||
      cls.descendantsOfType(AST_NODE_TYPES.IDENTIFIER)[0];
    if (nameNode) {
      skeleton.push(JSON.stringify({ type: AST_EVENTS.CLASS, name: nameNode.text }));
    }
  }

  for (const fn of functionDecls) {
    const nameNode =
      fn.childForFieldName(AST_FIELD_NAMES.NAME) ||
      fn.descendantsOfType(AST_NODE_TYPES.IDENTIFIER)[0];
    if (nameNode) {
      skeleton.push(JSON.stringify({ type: AST_EVENTS.FUNCTION, name: nameNode.text }));
    }
  }

  const baseName = path.basename(filePath);
  for (const call of callExprs) {
    const classification = classifyCall(call);
    if (!classification.methodName) continue;

    const fnName = classification.methodName;
    const fqn = scopeMap.has(fnName)
      ? scopeMap.get(fnName)!
      : `${baseName}${NAMESPACE_DELIMITER}${fnName}`;

    if (classification.isMethodCall) {
      skeleton.push(
        JSON.stringify({
          type: AST_EVENTS.METHOD_CALL,
          name: fqn,
          method: classification.methodName,
          object: classification.objectName,
        })
      );
    } else {
      skeleton.push(JSON.stringify({ type: AST_EVENTS.CALL, name: fqn }));
    }
  }

  const tempFilePath = await writeSkeletonToJsonl(
    skeleton,
    AST_INGESTION_DEFAULTS.TEMP_FILE_PREFIX_SKELETON
  );
  return { status: AST_STATUS.DONE, file: tempFilePath };
}
