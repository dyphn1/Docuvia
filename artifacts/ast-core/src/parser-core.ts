import { Parser, Language, Tree, Node } from "web-tree-sitter";
import { LanguageRegistry } from "./language-registry.js";
import { LanguageProvider, DefaultProvider } from "./language-provider.js";

import { AstEvent } from "./sink.js";

export type WasmLoader = (wasmFileName: string) => Promise<Uint8Array | ArrayBuffer | string>;

export async function initParser(locateFile: (path: string) => string): Promise<void> {
  await Parser.init({ locateFile });
}

/**
 * Build a scope map from import statements.
 *
 * Handles the following patterns across languages:
 *   - `import { A as B }`       → maps B → source::A  (named import with alias)
 *   - `import { A }`            → maps A → source::A  (named import)
 *   - `import * as X`           → maps X → source      (namespace import)
 *   - `import Foo from 'bar'`   → maps Foo → bar       (default import)
 *   - `from x import y`         → maps y → x::y        (Python from-import)
 *   - `from x import y as z`    → maps z → x::y        (Python aliased from-import)
 *   - `use foo::bar as baz`     → maps baz → foo::bar  (Rust use-as)
 *   - `use foo::*`              → wildcard, no mapping
 *   - `import "pkg"` (Go)       → maps pkg → pkg       (Go import)
 *   - `import alias "pkg"`      → maps alias → pkg     (Go aliased import)
 *   - `import java.util.List`   → maps List → java.util.List (Java)
 *   - `import java.util.*`      → wildcard, maps util → java.util
 *   - `#include <foo.h>`        → maps foo.h → foo.h   (C/C++ include)
 *   - `using namespace std`     → maps std → std       (C++ using)
 *   - `require 'foo'` (Ruby)    → maps foo → foo       (Ruby require)
 *   - `use Foo\Bar` (PHP)       → maps Bar → Foo\Bar   (PHP namespace use)
 */
function buildScopeMap(
  importStatements: Node[],
  sourceText: string
): Map<string, string> {
  const scopeMap = new Map<string, string>();

  for (const stmt of importStatements) {
    const stmtType = stmt.type;

    // ── TypeScript / JavaScript ──────────────────────────────────────
    if (stmtType === "import_statement") {
      // source is always the last string child
      const sourceNode = stmt.descendantsOfType("string").pop();
      if (!sourceNode) continue;
      const sourceText = sourceNode.text.replace(/['"]/g, "");

      // Check for namespace_import: `import * as X from 'source'`
      const namespaceImport = stmt.descendantsOfType("namespace_import")[0];
      if (namespaceImport) {
        const nsId = namespaceImport.descendantsOfType("identifier")[0];
        if (nsId) {
          scopeMap.set(nsId.text, sourceText);
        }
        continue;
      }

      // Check for named_imports: `import { A, B as C } from 'source'`
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
      if (defaultId) {
        scopeMap.set(defaultId.text, sourceText);
      }
      continue;
    }

    // ── Python ───────────────────────────────────────────────────────
    if (stmtType === "import_from_statement") {
      // from X import Y
      const moduleName = stmt.childForFieldName("module_name");
      if (!moduleName) continue;
      const sourceStr = moduleName.text;

      // Check for wildcard: `from X import *`
      const wildcard = stmt.descendantsOfType("wildcard_import")[0];
      if (wildcard) continue; // wildcard: no specific mapping

      // Named imports: `from X import A, B as C`
      const names = stmt.childForFieldName("name");
      if (names) {
        // Collect all dotted_name and aliased_import children
        collectPythonFromImports(stmt, sourceStr, scopeMap);
      }
      continue;
    }

    if (stmtType === "import_statement" && stmt.descendantsOfType("dotted_name").length > 0) {
      // `import os.path` → map os → os
      const dottedNames = stmt.descendantsOfType("dotted_name");
      for (const dn of dottedNames) {
        const firstId = dn.descendantsOfType("identifier")[0];
        if (firstId) {
          scopeMap.set(firstId.text, dn.text);
        }
      }
      // Also handle aliased: `import os.path as osp`
      const aliased = stmt.descendantsOfType("aliased_import")[0];
      if (aliased) {
        const nameNode = aliased.childForFieldName("name");
        const aliasNode = aliased.childForFieldName("alias");
        if (nameNode && aliasNode) {
          scopeMap.set(aliasNode.text, nameNode.text);
        }
      }
      continue;
    }

    // ── Rust ─────────────────────────────────────────────────────────
    if (stmtType === "use_declaration") {
      const arg = stmt.childForFieldName("argument");
      if (!arg) continue;

      // use_as_clause: `use foo::bar as baz`
      if (arg.type === "use_as_clause") {
        const pathNode = arg.childForFieldName("path");
        const aliasNode = arg.childForFieldName("alias");
        if (pathNode && aliasNode) {
          scopeMap.set(aliasNode.text, pathNode.text);
        }
        continue;
      }

      // use_wildcard: `use foo::*` — no specific mapping
      if (arg.type === "use_wildcard") continue;

      // scoped_use_list: `use foo::{bar, baz}`
      if (arg.type === "scoped_use_list") {
        const pathNode = arg.childForFieldName("path");
        const listNode = arg.childForFieldName("list");
        if (pathNode && listNode) {
          const prefix = pathNode.text;
          for (const child of listNode.namedChildren) {
            if (child.type === "use_as_clause") {
              const p = child.childForFieldName("path");
              const a = child.childForFieldName("alias");
              if (p && a) {
                scopeMap.set(a.text, `${prefix}::${p.text}`);
              }
            } else if (child.type === "identifier") {
              scopeMap.set(child.text, `${prefix}::${child.text}`);
            } else if (child.type === "scoped_identifier") {
              const lastPart = child.descendantsOfType("identifier").pop();
              if (lastPart) {
                scopeMap.set(lastPart.text, `${prefix}::${child.text}`);
              }
            }
          }
        }
        continue;
      }

      // Simple path: `use foo::bar::baz` → map baz → foo::bar::baz
      if (arg.type === "scoped_identifier" || arg.type === "identifier") {
        const ids = arg.descendantsOfType("identifier");
        const lastId = ids[ids.length - 1];
        if (lastId) {
          scopeMap.set(lastId.text, arg.text);
        }
        continue;
      }

      // use_list: `use foo::{bar, baz}` at top level
      if (arg.type === "use_list") {
        // This shouldn't normally happen at top level, but handle it
        for (const child of arg.namedChildren) {
          if (child.type === "identifier") {
            scopeMap.set(child.text, child.text);
          }
        }
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
            // Aliased: `import alias "pkg"` or dot import
            if (nameNode.type === "dot") continue; // dot import: no mapping
            if (nameNode.type === "blank_identifier") continue;
            scopeMap.set(nameNode.text, pkgPath);
          } else {
            // Default: use last segment of path as package name
            const segments = pkgPath.split("/");
            const pkgName = segments[segments.length - 1];
            scopeMap.set(pkgName, pkgPath);
          }
        }
      }
      continue;
    }

    // ── Java ─────────────────────────────────────────────────────────
    if (stmtType === "import_declaration") {
      // Check for wildcard: `import java.util.*`
      const asterisk = stmt.descendantsOfType("asterisk")[0];
      if (asterisk) {
        const scopedIds = stmt.descendantsOfType("scoped_identifier");
        const lastScoped = scopedIds[scopedIds.length - 1];
        if (lastScoped) {
          const ids = lastScoped.descendantsOfType("identifier");
          const lastId = ids[ids.length - 1];
          if (lastId) {
            scopeMap.set(lastId.text, lastScoped.text);
          }
        }
        continue;
      }

      // Regular: `import java.util.List`
      const scopedIds = stmt.descendantsOfType("scoped_identifier");
      const ids = stmt.descendantsOfType("identifiers");
      if (scopedIds.length > 0) {
        const lastScoped = scopedIds[scopedIds.length - 1];
        const allIds = lastScoped.descendantsOfType("identifier");
        const lastId = allIds[allIds.length - 1];
        if (lastId) {
          scopeMap.set(lastId.text, lastScoped.text);
        }
      } else if (ids.length > 0) {
        const lastId = ids[ids.length - 1];
        scopeMap.set(lastId.text, lastId.text);
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
      // `using namespace std` or `using std::cout`
      const children = stmt.namedChildren;
      for (const child of children) {
        if (child.type === "qualified_identifier") {
          const ids = child.descendantsOfType("identifier");
          const lastId = ids[ids.length - 1];
          if (lastId) {
            scopeMap.set(lastId.text, child.text);
          }
        } else if (child.type === "identifier") {
          scopeMap.set(child.text, child.text);
        }
      }
      continue;
    }

    // ── Ruby ─────────────────────────────────────────────────────────
    if (stmtType === "call") {
      // require/require_relative/load are call nodes in Ruby
      const methodNode = stmt.childForFieldName("method");
      if (methodNode) {
        const methodName = methodNode.text;
        if (methodName === "require" || methodName === "require_relative" || methodName === "load") {
          const args = stmt.childForFieldName("arguments");
          if (args) {
            const strNode = args.descendantsOfType("string_content")[0]
              || args.descendantsOfType("string")[0];
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
    if (
      stmtType === "namespace_use_declaration" ||
      stmtType === "include_expression" ||
      stmtType === "include_once_expression" ||
      stmtType === "require_expression" ||
      stmtType === "require_once_expression"
    ) {
      // PHP namespace use: `use App\Models\User`
      if (stmtType === "namespace_use_declaration") {
        const nameNode = stmt.descendantsOfType("qualified_name")[0]
          || stmt.descendantsOfType("name")[0];
        if (nameNode) {
          const fullName = nameNode.text;
          const parts = fullName.split("\\");
          const shortName = parts[parts.length - 1];
          scopeMap.set(shortName, fullName);
        }
      } else {
        // include/require: extract the path
        const argNode = stmt.descendantsOfType("string")[0]
          || stmt.descendantsOfType("string_content")[0];
        if (argNode) {
          const path = argNode.text.replace(/['"]/g, "");
          scopeMap.set(path, path);
        }
      }
      continue;
    }

    // ── C# ───────────────────────────────────────────────────────────
    if (stmtType === "using_directive") {
      // `using System.Collections.Generic`
      const nameNode = stmt.descendantsOfType("qualified_name")[0]
        || stmt.descendantsOfType("identifier")[0];
      if (nameNode) {
        const fullName = nameNode.text;
        const parts = fullName.split(".");
        const shortName = parts[parts.length - 1];
        scopeMap.set(shortName, fullName);
      }
      continue;
    }

    // ── Fallback: generic identifier extraction ──────────────────────
    // For any unhandled import type, fall back to the old behavior
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
 * Helper: collect Python from-import names into the scope map.
 */
function collectPythonFromImports(
  stmt: Node,
  sourceStr: string,
  scopeMap: Map<string, string>
): void {
  const namesNode = stmt.childForFieldName("name");
  if (!namesNode) return;

  // Iterate over direct named children of the import statement
  for (const child of stmt.namedChildren) {
    if (child.type === "aliased_import") {
      // `y as z`
      const nameNode = child.childForFieldName("name");
      const aliasNode = child.childForFieldName("alias");
      if (nameNode && aliasNode) {
        scopeMap.set(aliasNode.text, `${sourceStr}::${nameNode.text}`);
      }
    } else if (child.type === "dotted_name") {
      // `y.z` → map z → source::y.z
      const ids = child.descendantsOfType("identifier");
      const lastId = ids[ids.length - 1];
      if (lastId) {
        scopeMap.set(lastId.text, `${sourceStr}::${child.text}`);
      }
    } else if (child.type === "identifier") {
      scopeMap.set(child.text, `${sourceStr}::${child.text}`);
    }
  }
}

/**
 * Determine whether a call expression is a method call (obj.method())
 * or a plain function call (func()).
 *
 * Returns an object with:
 *   - isMethodCall: boolean
 *   - methodName: string (the method name if it's a method call, or the function name)
 *   - objectName: string | undefined (the object/receiver if it's a method call)
 */
function classifyCall(callNode: Node): {
  isMethodCall: boolean;
  methodName: string;
  objectName?: string;
} {
  const callType = callNode.type;

  // ── TypeScript / JavaScript ──────────────────────────────────────
  if (callType === "call_expression") {
    const fnNode = callNode.childForFieldName("function");
    if (!fnNode) return { isMethodCall: false, methodName: "" };

    if (fnNode.type === "member_expression") {
      // obj.method() or obj.prop.method()
      const propNode = fnNode.childForFieldName("property");
      const objNode = fnNode.childForFieldName("object");
      if (propNode) {
        return {
          isMethodCall: true,
          methodName: propNode.text,
          objectName: objNode?.text,
        };
      }
    }

    // Plain function call
    return { isMethodCall: false, methodName: fnNode.text };
  }

  // ── Python ───────────────────────────────────────────────────────
  if (callType === "call") {
    const fnNode = callNode.childForFieldName("function");
    if (!fnNode) return { isMethodCall: false, methodName: "" };

    if (fnNode.type === "attribute") {
      // obj.method()
      const attrNode = fnNode.childForFieldName("attribute");
      const objNode = fnNode.childForFieldName("object");
      if (attrNode) {
        return {
          isMethodCall: true,
          methodName: attrNode.text,
          objectName: objNode?.text,
        };
      }
    }

    return { isMethodCall: false, methodName: fnNode.text };
  }

  // ── Rust ─────────────────────────────────────────────────────────
  if (callType === "call_expression") {
    const fnNode = callNode.childForFieldName("function");
    if (!fnNode) return { isMethodCall: false, methodName: "" };

    if (fnNode.type === "field_expression") {
      // obj.method()
      const fieldNode = fnNode.childForFieldName("field");
      const objNode = fnNode.childForFieldName("value");
      if (fieldNode) {
        return {
          isMethodCall: true,
          methodName: fieldNode.text,
          objectName: objNode?.text,
        };
      }
    }

    return { isMethodCall: false, methodName: fnNode.text };
  }

  // ── Go ───────────────────────────────────────────────────────────
  if (callType === "call_expression") {
    const fnNode = callNode.childForFieldName("function");
    if (!fnNode) return { isMethodCall: false, methodName: "" };

    if (fnNode.type === "selector_expression") {
      // obj.method()
      const fieldNode = fnNode.childForFieldName("field");
      const objNode = fnNode.childForFieldName("value");
      if (fieldNode) {
        return {
          isMethodCall: true,
          methodName: fieldNode.text,
          objectName: objNode?.text,
        };
      }
    }

    return { isMethodCall: false, methodName: fnNode.text };
  }

  // ── Java ─────────────────────────────────────────────────────────
  if (callType === "method_invocation") {
    // Java method_invocation is always a method call
    const nameNode = callNode.childForFieldName("name");
    const objNode = callNode.childForFieldName("object");
    if (nameNode) {
      return {
        isMethodCall: true,
        methodName: nameNode.text,
        objectName: objNode?.text,
      };
    }
  }

  if (callType === "explicit_constructor_invocation") {
    // this() or super()
    const objNode = callNode.childForFieldName("constructor");
    return {
      isMethodCall: true,
      methodName: objNode?.text || "this",
      objectName: "this",
    };
  }

  // ── C / C++ ──────────────────────────────────────────────────────
  if (callType === "call_expression") {
    const fnNode = callNode.childForFieldName("function");
    if (!fnNode) return { isMethodCall: false, methodName: "" };

    if (fnNode.type === "field_expression") {
      // obj.method() or obj->method()
      const fieldNode = fnNode.childForFieldName("field");
      const objNode = fnNode.childForFieldName("value");
      if (fieldNode) {
        return {
          isMethodCall: true,
          methodName: fieldNode.text,
          objectName: objNode?.text,
        };
      }
    }

    return { isMethodCall: false, methodName: fnNode.text };
  }

  // ── Ruby ─────────────────────────────────────────────────────────
  if (callType === "call" || callType === "command_call") {
    const methodNode = callNode.childForFieldName("method");
    if (methodNode) {
      // Check if there's an object (receiver)
      const objNode = callNode.childForFieldName("receiver");
      if (objNode) {
        return {
          isMethodCall: true,
          methodName: methodNode.text,
          objectName: objNode.text,
        };
      }
      return { isMethodCall: false, methodName: methodNode.text };
    }
  }

  // ── PHP ──────────────────────────────────────────────────────────
  if (
    callType === "function_call_expression" ||
    callType === "member_call_expression" ||
    callType === "scoped_call_expression"
  ) {
    const nameNode = callNode.childForFieldName("name");
    const methodName = nameNode?.text || "";

    if (callType === "member_call_expression") {
      // $obj->method()
      const objNode = callNode.childForFieldName("object");
      return {
        isMethodCall: true,
        methodName,
        objectName: objNode?.text,
      };
    }

    if (callType === "scoped_call_expression") {
      // Class::method()
      const classNode = callNode.childForFieldName("scope");
      return {
        isMethodCall: true,
        methodName,
        objectName: classNode?.text,
      };
    }

    return { isMethodCall: false, methodName };
  }

  // ── C# ───────────────────────────────────────────────────────────
  if (callType === "invocation_expression") {
    // Check if it's a method call via member_access_expression
    const exprNode = callNode.childForFieldName("function")
      || callNode.namedChildren[0];
    if (exprNode && exprNode.type === "member_access_expression") {
      const nameNode = exprNode.childForFieldName("name");
      const objNode = exprNode.childForFieldName("expression");
      if (nameNode) {
        return {
          isMethodCall: true,
          methodName: nameNode.text,
          objectName: objNode?.text,
        };
      }
    }

    if (exprNode) {
      return { isMethodCall: false, methodName: exprNode.text };
    }
  }

  if (callType === "object_creation_expression") {
    // new Foo()
    const typeNode = callNode.childForFieldName("type");
    return {
      isMethodCall: true,
      methodName: "new",
      objectName: typeNode?.text,
    };
  }

  // ── Fallback ─────────────────────────────────────────────────────
  const fnNode = callNode.childForFieldName("function")
    || callNode.descendantsOfType("identifier")[0];
  return { isMethodCall: false, methodName: fnNode?.text || "" };
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

    const importStatements = provider.extractImports(tree.rootNode);
    const scopeMap = buildScopeMap(importStatements, typeof fileContent === "string" ? fileContent : "");

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
      const classification = classifyCall(call);
      if (!classification.methodName) continue;

      const fnName = classification.methodName;
      const fqn = scopeMap.has(fnName) ? scopeMap.get(fnName)! : `${baseName}::${fnName}`;

      if (classification.isMethodCall) {
        yield {
          type: "method_call",
          name: fqn,
          method: classification.methodName,
          object: classification.objectName,
        };
      } else {
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
