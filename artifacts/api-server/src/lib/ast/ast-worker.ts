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
    registry = await LanguageRegistry.load();
  }
}

async function loadLanguage(
  ext: string
): Promise<{ lang: Language | null; provider: LanguageProvider | undefined }> {
  if (!registry) {
    throw new Error("Language registry not initialized");
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
  status: "done" | "error";
  file?: string;
  reason?: string;
}

/**
 * Build a scope map from import statements with enhanced resolution.
 * Handles named imports, wildcard imports, default imports, and
 * language-specific patterns (Python from-import, Rust use-as, etc.)
 */
function buildScopeMap(importStatements: any[]): Map<string, string> {
  const scopeMap = new Map<string, string>();

  for (const stmt of importStatements) {
    const stmtType = stmt.type;

    // ── TypeScript / JavaScript ──────────────────────────────────────
    if (stmtType === "import_statement") {
      const sourceNode = stmt.descendantsOfType("string").pop();
      if (!sourceNode) continue;
      const sourceText = sourceNode.text.replace(/['"]/g, "");

      // namespace_import: `import * as X from 'source'`
      const namespaceImport = stmt.descendantsOfType("namespace_import")[0];
      if (namespaceImport) {
        const nsId = namespaceImport.descendantsOfType("identifier")[0];
        if (nsId) scopeMap.set(nsId.text, sourceText);
        continue;
      }

      // named_imports: `import { A, B as C } from 'source'`
      const namedImports = stmt.descendantsOfType("named_imports")[0];
      if (namedImports) {
        const specifiers = namedImports.descendantsOfType("import_specifier");
        for (const spec of specifiers) {
          const nameNode = spec.childForFieldName("name");
          const aliasNode = spec.childForFieldName("alias");
          if (nameNode) {
            const importedName = nameNode.text;
            const localName = aliasNode ? aliasNode.text : importedName;
            scopeMap.set(localName, `${sourceText}::${importedName}`);
          }
        }
        continue;
      }

      // Default import: `import Foo from 'source'`
      const defaultId = stmt.descendantsOfType("identifier")[0];
      if (defaultId) scopeMap.set(defaultId.text, sourceText);
      continue;
    }

    // ── Python ───────────────────────────────────────────────────────
    if (stmtType === "import_from_statement") {
      const moduleName = stmt.childForFieldName("module_name");
      if (!moduleName) continue;
      const sourceStr = moduleName.text;

      const wildcard = stmt.descendantsOfType("wildcard_import")[0];
      if (wildcard) continue;

      for (const child of stmt.namedChildren) {
        if (child.type === "aliased_import") {
          const nameNode = child.childForFieldName("name");
          const aliasNode = child.childForFieldName("alias");
          if (nameNode && aliasNode) {
            scopeMap.set(aliasNode.text, `${sourceStr}::${nameNode.text}`);
          }
        } else if (child.type === "dotted_name") {
          const ids = child.descendantsOfType("identifier");
          const lastId = ids[ids.length - 1];
          if (lastId) scopeMap.set(lastId.text, `${sourceStr}::${child.text}`);
        } else if (child.type === "identifier") {
          scopeMap.set(child.text, `${sourceStr}::${child.text}`);
        }
      }
      continue;
    }

    if (stmtType === "import_statement") {
      const aliased = stmt.descendantsOfType("aliased_import")[0];
      if (aliased) {
        const nameNode = aliased.childForFieldName("name");
        const aliasNode = aliased.childForFieldName("alias");
        if (nameNode && aliasNode) scopeMap.set(aliasNode.text, nameNode.text);
        continue;
      }
      const dottedNames = stmt.descendantsOfType("dotted_name");
      for (const dn of dottedNames) {
        const firstId = dn.descendantsOfType("identifier")[0];
        if (firstId) scopeMap.set(firstId.text, dn.text);
      }
      continue;
    }

    // ── Rust ─────────────────────────────────────────────────────────
    if (stmtType === "use_declaration") {
      const arg = stmt.childForFieldName("argument");
      if (!arg) continue;

      if (arg.type === "use_as_clause") {
        const pathNode = arg.childForFieldName("path");
        const aliasNode = arg.childForFieldName("alias");
        if (pathNode && aliasNode) scopeMap.set(aliasNode.text, pathNode.text);
        continue;
      }
      if (arg.type === "use_wildcard") continue;

      if (arg.type === "scoped_use_list") {
        const pathNode = arg.childForFieldName("path");
        const listNode = arg.childForFieldName("list");
        if (pathNode && listNode) {
          const prefix = pathNode.text;
          for (const child of listNode.namedChildren) {
            if (child.type === "identifier") {
              scopeMap.set(child.text, `${prefix}::${child.text}`);
            } else if (child.type === "scoped_identifier") {
              const lastPart = child.descendantsOfType("identifier").pop();
              if (lastPart) scopeMap.set(lastPart.text, `${prefix}::${child.text}`);
            }
          }
        }
        continue;
      }

      if (arg.type === "scoped_identifier" || arg.type === "identifier") {
        const ids = arg.descendantsOfType("identifier");
        const lastId = ids[ids.length - 1];
        if (lastId) scopeMap.set(lastId.text, arg.text);
        continue;
      }
      continue;
    }

    // ── Go ───────────────────────────────────────────────────────────
    if (stmtType === "import_declaration") {
      const specList = stmt.descendantsOfType("import_spec_list")[0];
      if (specList) {
        const specs = specList.descendantsOfType("import_spec");
        for (const spec of specs) {
          const pathNode = spec.childForFieldName("path");
          if (!pathNode) continue;
          const pkgPath = pathNode.text.replace(/['"]/g, "");
          const nameNode = spec.childForFieldName("name");
          if (nameNode) {
            if (nameNode.type === "dot" || nameNode.type === "blank_identifier") continue;
            scopeMap.set(nameNode.text, pkgPath);
          } else {
            const segments = pkgPath.split("/");
            scopeMap.set(segments[segments.length - 1], pkgPath);
          }
        }
      }
      continue;
    }

    // ── Java ─────────────────────────────────────────────────────────
    if (stmtType === "import_declaration") {
      const asterisk = stmt.descendantsOfType("asterisk")[0];
      if (asterisk) {
        const scopedIds = stmt.descendantsOfType("scoped_identifier");
        const lastScoped = scopedIds[scopedIds.length - 1];
        if (lastScoped) {
          const ids = lastScoped.descendantsOfType("identifier");
          const lastId = ids[ids.length - 1];
          if (lastId) scopeMap.set(lastId.text, lastScoped.text);
        }
        continue;
      }
      const scopedIds = stmt.descendantsOfType("scoped_identifier");
      if (scopedIds.length > 0) {
        const lastScoped = scopedIds[scopedIds.length - 1];
        const allIds = lastScoped.descendantsOfType("identifier");
        const lastId = allIds[allIds.length - 1];
        if (lastId) scopeMap.set(lastId.text, lastScoped.text);
      }
      continue;
    }

    // ── C / C++ ──────────────────────────────────────────────────────
    if (stmtType === "preproc_include") {
      const pathNode = stmt.childForFieldName("path");
      if (pathNode) {
        const includePath = pathNode.text.replace(/[<>"']/g, "");
        scopeMap.set(includePath, includePath);
      }
      continue;
    }

    if (stmtType === "using_declaration") {
      for (const child of stmt.namedChildren) {
        if (child.type === "qualified_identifier") {
          const ids = child.descendantsOfType("identifier");
          const lastId = ids[ids.length - 1];
          if (lastId) scopeMap.set(lastId.text, child.text);
        } else if (child.type === "identifier") {
          scopeMap.set(child.text, child.text);
        }
      }
      continue;
    }

    // ── Ruby ─────────────────────────────────────────────────────────
    if (stmtType === "call") {
      const methodNode = stmt.childForFieldName("method");
      if (methodNode) {
        const methodName = methodNode.text;
        if (
          methodName === "require" ||
          methodName === "require_relative" ||
          methodName === "load"
        ) {
          const args = stmt.childForFieldName("arguments");
          if (args) {
            const strNode =
              args.descendantsOfType("string_content")[0] || args.descendantsOfType("string")[0];
            if (strNode) {
              const libName = strNode.text.replace(/['"]/g, "");
              const shortName = libName.replace(/\.rb$/, "");
              scopeMap.set(shortName, libName);
            }
          }
        }
      }
      continue;
    }

    // ── PHP ──────────────────────────────────────────────────────────
    if (stmtType === "namespace_use_declaration") {
      const nameNode =
        stmt.descendantsOfType("qualified_name")[0] || stmt.descendantsOfType("name")[0];
      if (nameNode) {
        const fullName = nameNode.text;
        const parts = fullName.split("\\");
        scopeMap.set(parts[parts.length - 1], fullName);
      }
      continue;
    }

    if (
      stmtType === "include_expression" ||
      stmtType === "include_once_expression" ||
      stmtType === "require_expression" ||
      stmtType === "require_once_expression"
    ) {
      const strNode =
        stmt.descendantsOfType("string")[0] || stmt.descendantsOfType("string_content")[0];
      if (strNode) {
        const includePath = strNode.text.replace(/['"]/g, "");
        scopeMap.set(includePath, includePath);
      }
      continue;
    }

    // ── C# ───────────────────────────────────────────────────────────
    if (stmtType === "using_directive") {
      const nameNode =
        stmt.descendantsOfType("qualified_name")[0] || stmt.descendantsOfType("identifier")[0];
      if (nameNode) {
        const fullName = nameNode.text;
        const parts = fullName.split(".");
        scopeMap.set(parts[parts.length - 1], fullName);
      }
      continue;
    }

    // ── Fallback ─────────────────────────────────────────────────────
    const sourceNode = stmt.descendantsOfType("string").pop();
    if (!sourceNode) continue;
    const srcText = sourceNode.text.replace(/['"]/g, "");
    const identifiers = stmt.descendantsOfType("identifier");
    for (const idNode of identifiers) {
      if (!scopeMap.has(idNode.text)) {
        scopeMap.set(idNode.text, `${srcText}::${idNode.text}`);
      }
    }
  }

  return scopeMap;
}

/**
 * Classify a call expression as method call or function call.
 */
function classifyCall(callNode: any): {
  isMethodCall: boolean;
  methodName: string;
  objectName?: string;
} {
  const callType = callNode.type;

  // TypeScript / JavaScript
  if (callType === "call_expression") {
    const fnNode = callNode.childForFieldName("function");
    if (!fnNode) return { isMethodCall: false, methodName: "" };
    if (fnNode.type === "member_expression") {
      const propNode = fnNode.childForFieldName("property");
      const objNode = fnNode.childForFieldName("object");
      if (propNode)
        return { isMethodCall: true, methodName: propNode.text, objectName: objNode?.text };
    }
    return { isMethodCall: false, methodName: fnNode.text };
  }

  // Python
  if (callType === "call") {
    const fnNode = callNode.childForFieldName("function");
    if (!fnNode) return { isMethodCall: false, methodName: "" };
    if (fnNode.type === "attribute") {
      const attrNode = fnNode.childForFieldName("attribute");
      const objNode = fnNode.childForFieldName("object");
      if (attrNode)
        return { isMethodCall: true, methodName: attrNode.text, objectName: objNode?.text };
    }
    return { isMethodCall: false, methodName: fnNode.text };
  }

  // Rust
  if (callType === "call_expression") {
    const fnNode = callNode.childForFieldName("function");
    if (!fnNode) return { isMethodCall: false, methodName: "" };
    if (fnNode.type === "field_expression") {
      const fieldNode = fnNode.childForFieldName("field");
      const objNode = fnNode.childForFieldName("value");
      if (fieldNode)
        return { isMethodCall: true, methodName: fieldNode.text, objectName: objNode?.text };
    }
    return { isMethodCall: false, methodName: fnNode.text };
  }

  // Go
  if (callType === "call_expression") {
    const fnNode = callNode.childForFieldName("function");
    if (!fnNode) return { isMethodCall: false, methodName: "" };
    if (fnNode.type === "selector_expression") {
      const fieldNode = fnNode.childForFieldName("field");
      const objNode = fnNode.childForFieldName("value");
      if (fieldNode)
        return { isMethodCall: true, methodName: fieldNode.text, objectName: objNode?.text };
    }
    return { isMethodCall: false, methodName: fnNode.text };
  }

  // Java
  if (callType === "method_invocation") {
    const nameNode = callNode.childForFieldName("name");
    const objNode = callNode.childForFieldName("object");
    if (nameNode)
      return { isMethodCall: true, methodName: nameNode.text, objectName: objNode?.text };
  }

  // C / C++
  if (callType === "call_expression") {
    const fnNode = callNode.childForFieldName("function");
    if (!fnNode) return { isMethodCall: false, methodName: "" };
    if (fnNode.type === "field_expression") {
      const fieldNode = fnNode.childForFieldName("field");
      const objNode = fnNode.childForFieldName("value");
      if (fieldNode)
        return { isMethodCall: true, methodName: fieldNode.text, objectName: objNode?.text };
    }
    return { isMethodCall: false, methodName: fnNode.text };
  }

  // Ruby
  if (callType === "call" || callType === "command_call") {
    const methodNode = callNode.childForFieldName("method");
    if (methodNode) {
      const objNode = callNode.childForFieldName("receiver");
      if (objNode)
        return { isMethodCall: true, methodName: methodNode.text, objectName: objNode.text };
      return { isMethodCall: false, methodName: methodNode.text };
    }
  }

  // PHP
  if (callType === "member_call_expression") {
    const nameNode = callNode.childForFieldName("name");
    const objNode = callNode.childForFieldName("object");
    return { isMethodCall: true, methodName: nameNode?.text || "", objectName: objNode?.text };
  }
  if (callType === "scoped_call_expression") {
    const nameNode = callNode.childForFieldName("name");
    const classNode = callNode.childForFieldName("scope");
    return { isMethodCall: true, methodName: nameNode?.text || "", objectName: classNode?.text };
  }
  if (callType === "function_call_expression") {
    const nameNode = callNode.childForFieldName("name");
    return { isMethodCall: false, methodName: nameNode?.text || "" };
  }

  // C#
  if (callType === "invocation_expression") {
    const exprNode = callNode.childForFieldName("function") || callNode.namedChildren[0];
    if (exprNode?.type === "member_access_expression") {
      const nameNode = exprNode.childForFieldName("name");
      const objNode = exprNode.childForFieldName("expression");
      if (nameNode)
        return { isMethodCall: true, methodName: nameNode.text, objectName: objNode?.text };
    }
    if (exprNode) return { isMethodCall: false, methodName: exprNode.text };
  }
  if (callType === "object_creation_expression") {
    const typeNode = callNode.childForFieldName("type");
    return { isMethodCall: true, methodName: "new", objectName: typeNode?.text };
  }

  // Fallback
  const fnNode =
    callNode.childForFieldName("function") || callNode.descendantsOfType("identifier")[0];
  return { isMethodCall: false, methodName: fnNode?.text || "" };
}

// In Piscina, the default export is the worker function
export default async function parseAst(filePath: string): Promise<ParseResult> {
  await initParser();

  const fileContent = await fs.readFile(filePath, "utf-8");
  const ext = path.extname(filePath);
  const { lang, provider } = await loadLanguage(ext);

  const parser = new Parser();
  if (lang && provider) {
    parser.setLanguage(lang);
  } else {
    // If we can't load the language, we can't parse it with tree-sitter.
    // Return early or fallback. We'll return early for this implementation.
    return { status: "error", reason: `Language grammar not found for extension ${ext}` };
  }

  const tree = parser.parse(fileContent);
  if (!tree) {
    return { status: "error", reason: "Failed to parse file with tree-sitter" };
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
  skeleton.push(JSON.stringify({ type: "file", path: filePath }));

  // ── Emit import events for edge creation ──────────────────────────
  // Each import is emitted as a separate event with the resolved source path.
  // The pipeline uses these to create DEPENDS_ON links between L2 nodes.
  for (const [localName, resolvedSource] of scopeMap.entries()) {
    // Skip self-references and unresolved sources
    if (!resolvedSource || resolvedSource === filePath) continue;
    skeleton.push(
      JSON.stringify({
        type: "import",
        source: resolvedSource,
        localName,
      })
    );
  }

  for (const cls of classDecls) {
    const nameNode = cls.childForFieldName("name") || cls.descendantsOfType("identifier")[0];
    if (nameNode) {
      skeleton.push(JSON.stringify({ type: "class", name: nameNode.text }));
    }
  }

  for (const fn of functionDecls) {
    const nameNode = fn.childForFieldName("name") || fn.descendantsOfType("identifier")[0];
    if (nameNode) {
      skeleton.push(JSON.stringify({ type: "function", name: nameNode.text }));
    }
  }

  const baseName = path.basename(filePath);
  for (const call of callExprs) {
    const classification = classifyCall(call);
    if (!classification.methodName) continue;

    const fnName = classification.methodName;
    const fqn = scopeMap.has(fnName) ? scopeMap.get(fnName)! : `${baseName}::${fnName}`;

    if (classification.isMethodCall) {
      skeleton.push(
        JSON.stringify({
          type: "method_call",
          name: fqn,
          method: classification.methodName,
          object: classification.objectName,
        })
      );
    } else {
      skeleton.push(JSON.stringify({ type: "call", name: fqn }));
    }
  }

  const tempFileName = `ast-skeleton-${crypto.randomBytes(8).toString("hex")}.jsonl`;
  const tempFilePath = path.join(os.tmpdir(), tempFileName);

  await fs.writeFile(tempFilePath, skeleton.join("\n") + "\n", "utf-8");

  return { status: "done", file: tempFilePath };
}
