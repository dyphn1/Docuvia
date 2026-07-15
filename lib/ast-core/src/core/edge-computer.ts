import { Node } from "web-tree-sitter";
import { AstEvent } from "../sink.js";
import { AstEventType } from "../constants/ast-event-constants.js";

/**
 * Marks namespace/default/whole-module import bindings that don't resolve to a
 * single named symbol (e.g. `import * as X`, Python dotted `import a.b.c`, C's
 * `#include`) — see {@link parseImportDescriptors} JSDoc above for the full contract.
 */
const WILDCARD_IMPORT_MARKER = "*";

/** Ruby stdlib call names that behave like import statements. */
const RUBY_IMPORT_METHOD_NAMES = [
  "require",
  "require_relative",
  "load",
] as const;

/** Sentinel used when a call resolves to the enclosing constructor/self reference. */
const SELF_REFERENCE_KEYWORD = "this";

/** Synthetic method name assigned to constructor-invocation call edges. */
const CONSTRUCTOR_CALL_METHOD_NAME = "new";

/**
 * Build a scope map from import statements.
 *
 * Handles the following patterns across languages:
 *   - `import { A as B }`       → maps B → source::A
 *   - `import { A }`            → maps A → source::A
 *   - `import * as X`           → maps X → source
 *   - `import Foo from 'bar'`   → maps Foo → bar
 *   - `from x import y`         → maps y → x::y
 *   - `from x import y as z`    → maps z → x::y
 *   - `use foo::bar as baz`     → maps baz → foo::bar
 *   - `use foo::*`              → wildcard, no mapping
 *   - `import "pkg"`            → maps pkg → pkg
 *   - `import alias "pkg"`      → maps alias → pkg
 *   - `import java.util.List`   → maps List → java.util.List
 *   - `import java.util.*`      → wildcard, maps util → java.util
 *   - `#include <foo.h>`        → maps foo.h → foo.h
 *   - `using namespace std`     → maps std → std
 *   - `require 'foo'`           → maps foo → foo
 *   - `use Foo\Bar`             → maps Bar → Foo\Bar
 */
export interface ParsedImportDescriptor {
  localName: string;
  originalName: string;
  modulePath: string;
}

/**
 * Parses import/use/require statements into structured {localName, originalName, modulePath}
 * descriptors, one per language-specific binding. This is the single source of truth for
 * import parsing across languages — buildScopeMap() is a thin wrapper over this that encodes
 * the same data into the opaque `${modulePath}::${originalName}` string format EdgeComputer
 * expects (kept only for that consumer's backward compatibility).
 *
 * `originalName: "*"` marks namespace/default/whole-module bindings that don't resolve to a
 * single named symbol (e.g. `import * as X`, Python dotted `import a.b.c`, C's `#include`) —
 * callers (ScopeResolver.resolveCall) treat "*" as "fall back to the call name itself".
 */
export function parseImportDescriptors(
  importStatements: Node[],
): ParsedImportDescriptor[] {
  const descriptors: ParsedImportDescriptor[] = [];

  for (const stmt of importStatements) {
    const stmtType = stmt.type;

    // ── TypeScript / JavaScript ──────────────────────────────────────
    if (stmtType === "import_statement") {
      const sourceNode = stmt.descendantsOfType("string").pop();
      if (!sourceNode) continue;
      const srcText = sourceNode.text.replace(/['"]/g, "");

      const namespaceImport = stmt.descendantsOfType("namespace_import")[0];
      if (namespaceImport) {
        const nsId = namespaceImport.descendantsOfType("identifier")[0];
        if (nsId) {
          descriptors.push({
            localName: nsId.text,
            originalName: WILDCARD_IMPORT_MARKER,
            modulePath: srcText,
          });
        }
        continue;
      }

      const namedImports = stmt.descendantsOfType("named_imports")[0];
      if (namedImports) {
        const specifiers = namedImports.descendantsOfType("import_specifier");
        for (const spec of specifiers) {
          if (!spec) continue;
          const nameNode = spec.childForFieldName("name");
          const aliasNode = spec.childForFieldName("alias");
          if (nameNode) {
            const importedName = nameNode.text;
            const localName = aliasNode ? aliasNode.text : importedName;
            descriptors.push({
              localName,
              originalName: importedName,
              modulePath: srcText,
            });
          }
        }
        continue;
      }

      const defaultId = stmt.descendantsOfType("identifier")[0];
      if (defaultId) {
        descriptors.push({
          localName: defaultId.text,
          originalName: WILDCARD_IMPORT_MARKER,
          modulePath: srcText,
        });
      }
      continue;
    }

    // ── Python ───────────────────────────────────────────────────────
    if (stmtType === "import_from_statement") {
      const moduleName = stmt.childForFieldName("module_name");
      if (!moduleName) continue;
      const sourceStr = moduleName.text;

      const wildcard = stmt.descendantsOfType("wildcard_import")[0];
      if (wildcard) continue;

      const names = stmt.childForFieldName("name");
      if (names) {
        collectPythonFromImportDescriptors(stmt, sourceStr, descriptors);
      }
      continue;
    }

    if (
      stmtType === "import_statement" &&
      stmt.descendantsOfType("dotted_name").length > 0
    ) {
      const dottedNames = stmt.descendantsOfType("dotted_name");
      for (const dn of dottedNames) {
        if (!dn) continue;
        const firstId = dn.descendantsOfType("identifier")[0];
        if (firstId) {
          descriptors.push({
            localName: firstId.text,
            originalName: WILDCARD_IMPORT_MARKER,
            modulePath: dn.text,
          });
        }
      }
      const aliased = stmt.descendantsOfType("aliased_import")[0];
      if (aliased) {
        const nameNode = aliased.childForFieldName("name");
        const aliasNode = aliased.childForFieldName("alias");
        if (nameNode && aliasNode) {
          descriptors.push({
            localName: aliasNode.text,
            originalName: WILDCARD_IMPORT_MARKER,
            modulePath: nameNode.text,
          });
        }
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
        if (pathNode && aliasNode) {
          descriptors.push({
            localName: aliasNode.text,
            originalName: WILDCARD_IMPORT_MARKER,
            modulePath: pathNode.text,
          });
        }
        continue;
      }

      if (arg.type === "use_wildcard") continue;

      if (arg.type === "scoped_use_list") {
        const pathNode = arg.childForFieldName("path");
        const listNode = arg.childForFieldName("list");
        if (pathNode && listNode) {
          const prefix = pathNode.text;
          for (const child of listNode.namedChildren) {
            if (!child) continue;
            if (child.type === "use_as_clause") {
              const p = child.childForFieldName("path");
              const a = child.childForFieldName("alias");
              if (p && a) {
                descriptors.push({
                  localName: a.text,
                  originalName: WILDCARD_IMPORT_MARKER,
                  modulePath: `${prefix}::${p.text}`,
                });
              }
            } else if (child.type === "identifier") {
              descriptors.push({
                localName: child.text,
                originalName: WILDCARD_IMPORT_MARKER,
                modulePath: `${prefix}::${child.text}`,
              });
            } else if (child.type === "scoped_identifier") {
              const lastPart = child.descendantsOfType("identifier").pop();
              if (lastPart) {
                descriptors.push({
                  localName: lastPart.text,
                  originalName: WILDCARD_IMPORT_MARKER,
                  modulePath: `${prefix}::${child.text}`,
                });
              }
            }
          }
        }
        continue;
      }

      if (arg.type === "scoped_identifier" || arg.type === "identifier") {
        const ids = arg.descendantsOfType("identifier");
        const lastId = ids[ids.length - 1];
        if (lastId) {
          descriptors.push({
            localName: lastId.text,
            originalName: WILDCARD_IMPORT_MARKER,
            modulePath: arg.text,
          });
        }
        continue;
      }

      if (arg.type === "use_list") {
        for (const child of arg.namedChildren) {
          if (!child) continue;
          if (child.type === "identifier") {
            descriptors.push({
              localName: child.text,
              originalName: WILDCARD_IMPORT_MARKER,
              modulePath: child.text,
            });
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
          if (!spec) continue;
          const pathNode = spec.childForFieldName("path");
          if (!pathNode) continue;
          const pkgPath = pathNode.text.replace(/['"]/g, "");

          const nameNode = spec.childForFieldName("name");
          if (nameNode) {
            if (nameNode.type === "dot") continue;
            if (nameNode.type === "blank_identifier") continue;
            descriptors.push({
              localName: nameNode.text,
              originalName: WILDCARD_IMPORT_MARKER,
              modulePath: pkgPath,
            });
          } else {
            const segments = pkgPath.split("/");
            const pkgName = segments[segments.length - 1];
            descriptors.push({
              localName: pkgName,
              originalName: WILDCARD_IMPORT_MARKER,
              modulePath: pkgPath,
            });
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
        if (!lastScoped) continue;
        if (lastScoped) {
          const ids = lastScoped.descendantsOfType("identifier");
          const lastId = ids[ids.length - 1];
          if (lastId) {
            descriptors.push({
              localName: lastId.text,
              originalName: WILDCARD_IMPORT_MARKER,
              modulePath: lastScoped.text,
            });
          }
        }
        continue;
      }

      const scopedIds = stmt.descendantsOfType("scoped_identifier");
      const ids = stmt.descendantsOfType("identifiers");
      if (scopedIds.length > 0) {
        const lastScoped = scopedIds[scopedIds.length - 1];
        if (!lastScoped) continue;
        const allIds = lastScoped.descendantsOfType("identifier");
        const lastId = allIds[allIds.length - 1];
        if (lastId) {
          descriptors.push({
            localName: lastId.text,
            originalName: WILDCARD_IMPORT_MARKER,
            modulePath: lastScoped.text,
          });
        }
      } else if (ids.length > 0) {
        const lastId = ids[ids.length - 1];
        if (lastId) {
          descriptors.push({
            localName: lastId.text,
            originalName: WILDCARD_IMPORT_MARKER,
            modulePath: lastId.text,
          });
        }
      }
      continue;
    }

    // ── C / C++ ──────────────────────────────────────────────────────
    if (stmtType === "preproc_include") {
      const pathNode = stmt.childForFieldName("path");
      if (pathNode) {
        const includePath = pathNode.text.replace(/[<>"']/g, "");
        descriptors.push({
          localName: includePath,
          originalName: WILDCARD_IMPORT_MARKER,
          modulePath: includePath,
        });
      }
      continue;
    }

    if (stmtType === "using_declaration") {
      const children = stmt.namedChildren;
      for (const child of children) {
        if (!child) continue;
        if (child.type === "qualified_identifier") {
          const ids = child.descendantsOfType("identifier");
          const lastId = ids[ids.length - 1];
          if (lastId) {
            descriptors.push({
              localName: lastId.text,
              originalName: WILDCARD_IMPORT_MARKER,
              modulePath: child.text,
            });
          }
        } else if (child.type === "identifier") {
          descriptors.push({
            localName: child.text,
            originalName: WILDCARD_IMPORT_MARKER,
            modulePath: child.text,
          });
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
          (RUBY_IMPORT_METHOD_NAMES as readonly string[]).includes(methodName)
        ) {
          const args = stmt.childForFieldName("arguments");
          if (args) {
            const strNode =
              args.descendantsOfType("string_content")[0] ||
              args.descendantsOfType("string")[0];
            if (strNode) {
              const libName = strNode.text.replace(/['"]/g, "");
              const shortName = libName.replace(/\.rb$/, "");
              descriptors.push({
                localName: shortName,
                originalName: WILDCARD_IMPORT_MARKER,
                modulePath: libName,
              });
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
      if (stmtType === "namespace_use_declaration") {
        const nameNode =
          stmt.descendantsOfType("qualified_name")[0] ||
          stmt.descendantsOfType("name")[0];
        if (nameNode) {
          const fullName = nameNode.text;
          const parts = fullName.split("\\");
          const shortName = parts[parts.length - 1];
          descriptors.push({
            localName: shortName,
            originalName: WILDCARD_IMPORT_MARKER,
            modulePath: fullName,
          });
        }
      } else {
        const argNode =
          stmt.descendantsOfType("string")[0] ||
          stmt.descendantsOfType("string_content")[0];
        if (argNode) {
          const path = argNode.text.replace(/['"]/g, "");
          descriptors.push({
            localName: path,
            originalName: WILDCARD_IMPORT_MARKER,
            modulePath: path,
          });
        }
      }
      continue;
    }

    // ── C# ───────────────────────────────────────────────────────────
    if (stmtType === "using_directive") {
      const nameNode =
        stmt.descendantsOfType("qualified_name")[0] ||
        stmt.descendantsOfType("identifier")[0];
      if (nameNode) {
        const fullName = nameNode.text;
        const parts = fullName.split(".");
        const shortName = parts[parts.length - 1];
        descriptors.push({
          localName: shortName,
          originalName: WILDCARD_IMPORT_MARKER,
          modulePath: fullName,
        });
      }
      continue;
    }

    // ── Fallback: generic identifier extraction ──────────────────────
    const sourceNode = stmt.descendantsOfType("string").pop();
    if (!sourceNode) continue;
    const fallbackSrcText = sourceNode.text.replace(/['"]/g, "");
    const identifiers = stmt.descendantsOfType("identifier");
    for (const idNode of identifiers) {
      if (!idNode) continue;
      // Mirrors the original `if (!scopeMap.has(idNode.text))` guard: skip if a descriptor
      // for this localName was already collected (from this or an earlier statement).
      if (!descriptors.some((d) => d.localName === idNode.text)) {
        descriptors.push({
          localName: idNode.text,
          originalName: idNode.text,
          modulePath: fallbackSrcText,
        });
      }
    }
  }

  return descriptors;
}

/**
 * Thin wrapper over parseImportDescriptors() that encodes descriptors into the opaque
 * `${modulePath}::${originalName}` string format EdgeComputer.computeCallEdges consumes.
 * Preserved for backward compatibility (AstTraverser / headless-lsp) — reproduces the exact
 * same Map<localName, encodedValue> output the original hand-written implementation produced.
 */
export function buildScopeMap(
  importStatements: Node[],
  sourceText: string,
): Map<string, string> {
  const scopeMap = new Map<string, string>();
  for (const d of parseImportDescriptors(importStatements)) {
    scopeMap.set(
      d.localName,
      d.originalName === WILDCARD_IMPORT_MARKER
        ? d.modulePath
        : `${d.modulePath}::${d.originalName}`,
    );
  }
  return scopeMap;
}

function collectPythonFromImportDescriptors(
  stmt: Node,
  sourceStr: string,
  descriptors: ParsedImportDescriptor[],
): void {
  const namesNode = stmt.childForFieldName("name");
  if (!namesNode) return;

  for (const child of stmt.namedChildren) {
    if (!child) continue;
    if (child.type === "aliased_import") {
      const nameNode = child.childForFieldName("name");
      const aliasNode = child.childForFieldName("alias");
      if (nameNode && aliasNode) {
        descriptors.push({
          localName: aliasNode.text,
          originalName: nameNode.text,
          modulePath: sourceStr,
        });
      }
    } else if (child.type === "dotted_name") {
      const ids = child.descendantsOfType("identifier");
      const lastId = ids[ids.length - 1];
      if (lastId) {
        descriptors.push({
          localName: lastId.text,
          originalName: child.text,
          modulePath: sourceStr,
        });
      }
    } else if (child.type === "identifier") {
      descriptors.push({
        localName: child.text,
        originalName: child.text,
        modulePath: sourceStr,
      });
    }
  }
}

export function classifyCall(callNode: Node): {
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
    return { isMethodCall: false, methodName: fnNode.text };
  }

  // ── Python ───────────────────────────────────────────────────────
  if (callType === "call") {
    const fnNode = callNode.childForFieldName("function");
    if (!fnNode) return { isMethodCall: false, methodName: "" };

    if (fnNode.type === "attribute") {
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
    const objNode = callNode.childForFieldName("constructor");
    return {
      isMethodCall: true,
      methodName: objNode?.text || SELF_REFERENCE_KEYWORD,
      objectName: SELF_REFERENCE_KEYWORD,
    };
  }

  // ── C / C++ ──────────────────────────────────────────────────────
  if (callType === "call_expression") {
    const fnNode = callNode.childForFieldName("function");
    if (!fnNode) return { isMethodCall: false, methodName: "" };

    if (fnNode.type === "field_expression") {
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
      const objNode = callNode.childForFieldName("object");
      return {
        isMethodCall: true,
        methodName,
        objectName: objNode?.text,
      };
    }

    if (callType === "scoped_call_expression") {
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
    const exprNode =
      callNode.childForFieldName("function") || callNode.namedChildren[0];
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
    const typeNode = callNode.childForFieldName("type");
    return {
      isMethodCall: true,
      methodName: CONSTRUCTOR_CALL_METHOD_NAME,
      objectName: typeNode?.text,
    };
  }

  // ── Fallback ─────────────────────────────────────────────────────
  const fnNode =
    callNode.childForFieldName("function") ||
    callNode.descendantsOfType("identifier")[0];
  return { isMethodCall: false, methodName: fnNode?.text || "" };
}

export class EdgeComputer {
  private scopeMap: Map<string, string>;
  private baseName: string;

  constructor(importStatements: Node[], sourceText: string, filePath: string) {
    this.scopeMap = buildScopeMap(importStatements, sourceText);
    this.baseName = filePath.split(/[/\\]/).pop() || "";
  }

  computeCallEdges(callExprs: Node[]): AstEvent[] {
    const events: AstEvent[] = [];
    for (const call of callExprs) {
      const classification = classifyCall(call);
      if (!classification.methodName) continue;

      const fnName = classification.methodName;
      const fqn = this.scopeMap.has(fnName)
        ? this.scopeMap.get(fnName)!
        : `${this.baseName}::${fnName}`;

      if (classification.isMethodCall) {
        events.push({
          type: AstEventType.METHOD_CALL,
          name: fqn,
          method: classification.methodName,
          object: classification.objectName,
        });
      } else {
        events.push({ type: AstEventType.CALL, name: fqn });
      }
    }
    return events;
  }
}
