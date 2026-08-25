import { Node } from "web-tree-sitter";
import { AstEvent } from "../sink.js";
import { AstEventType } from "../constants/ast-event-constants.js";
import { TreeSitterNodeTypes } from "../constants/tree-sitter-node-types.js";

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
  /** True for TS/JS barrel re-export descriptors (`export { X } from "./y"`) — see
   *  collectTsJsExportFromDescriptors. */
  viaReexport?: boolean;
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

  // NOTE: the original hand-written chain of `if (stmtType === "...")` checks had two
  // provably unreachable branches, preserved here only in this comment for the record:
  //   - a Python "dotted import" check gated on `stmtType === "import_statement"` — dead,
  //     because the TS/JS `import_statement` branch above it always hit `continue`.
  //   - a Java `import_declaration` check — dead, because the Go `import_declaration`
  //     branch above it always hit `continue`.
  // Both were unreachable for every input, so omitting them here changes no behavior.
  for (const stmt of importStatements) {
    const stmtType = stmt.type;

    const handler = SINGLE_TYPE_IMPORT_HANDLERS[stmtType];
    if (handler) {
      handler(stmt, descriptors);
      continue;
    }

    if (isPhpImportStatement(stmtType)) {
      collectPhpImportDescriptors(stmt, stmtType, descriptors);
      continue;
    }

    collectFallbackImportDescriptors(stmt, descriptors);
  }

  return descriptors;
}

/**
 * Dispatch table for import statement types that resolve unambiguously to a single
 * per-language collector. Mirrors the exact set of standalone `stmtType === "..."`
 * checks from the original hand-written implementation (PHP and the generic fallback
 * are handled separately below since they aren't single-type equality checks).
 */
const SINGLE_TYPE_IMPORT_HANDLERS: Record<
  string,
  (stmt: Node, descriptors: ParsedImportDescriptor[]) => void
> = {
  [TreeSitterNodeTypes.IMPORT_STATEMENT]: collectTsJsImportDescriptors,
  [TreeSitterNodeTypes.EXPORT_STATEMENT]: collectTsJsExportFromDescriptors,
  [TreeSitterNodeTypes.IMPORT_FROM_STATEMENT]:
    collectPythonFromStatementDescriptors,
  [TreeSitterNodeTypes.USE_DECLARATION]: collectRustUseDescriptors,
  [TreeSitterNodeTypes.IMPORT_DECLARATION]: collectGoImportDescriptors,
  [TreeSitterNodeTypes.PREPROC_INCLUDE]: collectCIncludeDescriptors,
  [TreeSitterNodeTypes.USING_DECLARATION]:
    collectCppUsingDeclarationDescriptors,
  [TreeSitterNodeTypes.CALL]: collectRubyRequireDescriptors,
  [TreeSitterNodeTypes.USING_DIRECTIVE]: collectCSharpUsingDescriptors,
};

// ── TypeScript / JavaScript ────────────────────────────────────────────
function collectTsJsImportDescriptors(
  stmt: Node,
  descriptors: ParsedImportDescriptor[],
): void {
  const sourceNode = stmt.descendantsOfType("string").pop();
  if (!sourceNode) return;
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
    return;
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
    return;
  }

  const defaultId = stmt.descendantsOfType("identifier")[0];
  if (defaultId) {
    descriptors.push({
      localName: defaultId.text,
      originalName: WILDCARD_IMPORT_MARKER,
      modulePath: srcText,
    });
  }
}

// ── Python ────────────────────────────────────────────────────────────
/**
 * TS/JS barrel re-export (`export { X } from "./y"` — issue #192's gap 2). Emits one descriptor
 * per export specifier so a barrel file becomes self-describing: an importer of `X` from the
 * barrel can then be chained through it to `./y` by ScopeResolver.resolveReexportTarget.
 * Direction note: `export { A as B } from "./y"` means importers see `B` while `A` is the
 * original name in `./y`, so localName = outward-facing alias/name, originalName = source name.
 *
 * Only re-export forms (those carrying a `source` clause) produce descriptors — a plain local
 * `export const/class/function` is a definition, not a dependency, and must not fabricate one.
 * `export * from "./y"` has no named binding to track and is skipped.
 */
function collectTsJsExportFromDescriptors(
  stmt: Node,
  descriptors: ParsedImportDescriptor[],
): void {
  const sourceNode = stmt.childForFieldName("source");
  if (!sourceNode) return;
  const srcText = sourceNode.text.replace(/['"]/g, "");

  const exportClause = stmt.descendantsOfType("export_clause")[0];
  if (!exportClause) return;

  for (const spec of exportClause.descendantsOfType("export_specifier")) {
    if (!spec) continue;
    const nameNode = spec.childForFieldName("name");
    if (!nameNode) continue;
    const aliasNode = spec.childForFieldName("alias");
    descriptors.push({
      localName: aliasNode ? aliasNode.text : nameNode.text,
      originalName: nameNode.text,
      modulePath: srcText,
      viaReexport: true,
    });
  }
}

function collectPythonFromStatementDescriptors(
  stmt: Node,
  descriptors: ParsedImportDescriptor[],
): void {
  const moduleName = stmt.childForFieldName("module_name");
  if (!moduleName) return;
  const sourceStr = moduleName.text;

  const wildcard = stmt.descendantsOfType("wildcard_import")[0];
  if (wildcard) return;

  const names = stmt.childForFieldName("name");
  if (names) {
    collectPythonFromImportDescriptors(stmt, sourceStr, descriptors);
  }
}

// ── Rust ──────────────────────────────────────────────────────────────
function collectRustUseAsClauseDescriptor(
  arg: Node,
  descriptors: ParsedImportDescriptor[],
): void {
  const pathNode = arg.childForFieldName("path");
  const aliasNode = arg.childForFieldName("alias");
  if (pathNode && aliasNode) {
    descriptors.push({
      localName: aliasNode.text,
      originalName: WILDCARD_IMPORT_MARKER,
      modulePath: pathNode.text,
    });
  }
}

function collectRustScopedUseListAsClauseDescriptor(
  child: Node,
  prefix: string,
  descriptors: ParsedImportDescriptor[],
): void {
  const p = child.childForFieldName("path");
  const a = child.childForFieldName("alias");
  if (p && a) {
    descriptors.push({
      localName: a.text,
      originalName: WILDCARD_IMPORT_MARKER,
      modulePath: `${prefix}::${p.text}`,
    });
  }
}

function collectRustScopedUseListScopedIdentifierDescriptor(
  child: Node,
  prefix: string,
  descriptors: ParsedImportDescriptor[],
): void {
  const lastPart = child.descendantsOfType("identifier").pop();
  if (lastPart) {
    descriptors.push({
      localName: lastPart.text,
      originalName: WILDCARD_IMPORT_MARKER,
      modulePath: `${prefix}::${child.text}`,
    });
  }
}

function collectRustScopedUseListChildDescriptor(
  child: Node,
  prefix: string,
  descriptors: ParsedImportDescriptor[],
): void {
  if (child.type === TreeSitterNodeTypes.USE_AS_CLAUSE) {
    collectRustScopedUseListAsClauseDescriptor(child, prefix, descriptors);
    return;
  }
  if (child.type === TreeSitterNodeTypes.IDENTIFIER) {
    descriptors.push({
      localName: child.text,
      originalName: WILDCARD_IMPORT_MARKER,
      modulePath: `${prefix}::${child.text}`,
    });
    return;
  }
  if (child.type === TreeSitterNodeTypes.SCOPED_IDENTIFIER) {
    collectRustScopedUseListScopedIdentifierDescriptor(
      child,
      prefix,
      descriptors,
    );
  }
}

function collectRustScopedUseListDescriptors(
  arg: Node,
  descriptors: ParsedImportDescriptor[],
): void {
  const pathNode = arg.childForFieldName("path");
  const listNode = arg.childForFieldName("list");
  if (!pathNode || !listNode) return;

  const prefix = pathNode.text;
  for (const child of listNode.namedChildren) {
    if (!child) continue;
    collectRustScopedUseListChildDescriptor(child, prefix, descriptors);
  }
}

function collectRustScopedOrPlainIdentifierDescriptor(
  arg: Node,
  descriptors: ParsedImportDescriptor[],
): void {
  const ids = arg.descendantsOfType("identifier");
  const lastId = ids[ids.length - 1];
  if (lastId) {
    descriptors.push({
      localName: lastId.text,
      originalName: WILDCARD_IMPORT_MARKER,
      modulePath: arg.text,
    });
  }
}

function collectRustUseListDescriptors(
  arg: Node,
  descriptors: ParsedImportDescriptor[],
): void {
  for (const child of arg.namedChildren) {
    if (!child) continue;
    if (child.type === TreeSitterNodeTypes.IDENTIFIER) {
      descriptors.push({
        localName: child.text,
        originalName: WILDCARD_IMPORT_MARKER,
        modulePath: child.text,
      });
    }
  }
}

function collectRustUseDescriptors(
  stmt: Node,
  descriptors: ParsedImportDescriptor[],
): void {
  const arg = stmt.childForFieldName("argument");
  if (!arg) return;

  if (arg.type === TreeSitterNodeTypes.USE_AS_CLAUSE) {
    collectRustUseAsClauseDescriptor(arg, descriptors);
    return;
  }

  if (arg.type === TreeSitterNodeTypes.USE_WILDCARD) return;

  if (arg.type === TreeSitterNodeTypes.SCOPED_USE_LIST) {
    collectRustScopedUseListDescriptors(arg, descriptors);
    return;
  }

  if (
    arg.type === TreeSitterNodeTypes.SCOPED_IDENTIFIER ||
    arg.type === TreeSitterNodeTypes.IDENTIFIER
  ) {
    collectRustScopedOrPlainIdentifierDescriptor(arg, descriptors);
    return;
  }

  if (arg.type === TreeSitterNodeTypes.USE_LIST) {
    collectRustUseListDescriptors(arg, descriptors);
  }
}

// ── Go ────────────────────────────────────────────────────────────────
function collectGoImportSpecDescriptor(
  spec: Node,
  descriptors: ParsedImportDescriptor[],
): void {
  const pathNode = spec.childForFieldName("path");
  if (!pathNode) return;
  const pkgPath = pathNode.text.replace(/['"]/g, "");

  const nameNode = spec.childForFieldName("name");
  if (nameNode) {
    if (nameNode.type === TreeSitterNodeTypes.DOT) return;
    if (nameNode.type === TreeSitterNodeTypes.BLANK_IDENTIFIER) return;
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

function collectGoImportDescriptors(
  stmt: Node,
  descriptors: ParsedImportDescriptor[],
): void {
  const specList = stmt.descendantsOfType("import_spec_list")[0];
  if (!specList) return;
  const specs = specList.descendantsOfType("import_spec");
  for (const spec of specs) {
    if (!spec) continue;
    collectGoImportSpecDescriptor(spec, descriptors);
  }
}

// ── C / C++ ───────────────────────────────────────────────────────────
function collectCIncludeDescriptors(
  stmt: Node,
  descriptors: ParsedImportDescriptor[],
): void {
  const pathNode = stmt.childForFieldName("path");
  if (pathNode) {
    const includePath = pathNode.text.replace(/[<>"']/g, "");
    descriptors.push({
      localName: includePath,
      originalName: WILDCARD_IMPORT_MARKER,
      modulePath: includePath,
    });
  }
}

function collectCppUsingDeclarationDescriptors(
  stmt: Node,
  descriptors: ParsedImportDescriptor[],
): void {
  const children = stmt.namedChildren;
  for (const child of children) {
    if (!child) continue;
    if (child.type === TreeSitterNodeTypes.QUALIFIED_IDENTIFIER) {
      const ids = child.descendantsOfType("identifier");
      const lastId = ids[ids.length - 1];
      if (lastId) {
        descriptors.push({
          localName: lastId.text,
          originalName: WILDCARD_IMPORT_MARKER,
          modulePath: child.text,
        });
      }
    } else if (child.type === TreeSitterNodeTypes.IDENTIFIER) {
      descriptors.push({
        localName: child.text,
        originalName: WILDCARD_IMPORT_MARKER,
        modulePath: child.text,
      });
    }
  }
}

// ── Ruby ──────────────────────────────────────────────────────────────
function collectRubyRequireDescriptors(
  stmt: Node,
  descriptors: ParsedImportDescriptor[],
): void {
  const methodNode = stmt.childForFieldName("method");
  if (!methodNode) return;
  const methodName = methodNode.text;
  if (!(RUBY_IMPORT_METHOD_NAMES as readonly string[]).includes(methodName)) {
    return;
  }
  const args = stmt.childForFieldName("arguments");
  if (!args) return;
  const strNode =
    args.descendantsOfType("string_content")[0] ||
    args.descendantsOfType("string")[0];
  if (!strNode) return;
  const libName = strNode.text.replace(/['"]/g, "");
  const shortName = libName.replace(/\.rb$/, "");
  descriptors.push({
    localName: shortName,
    originalName: WILDCARD_IMPORT_MARKER,
    modulePath: libName,
  });
}

// ── PHP ───────────────────────────────────────────────────────────────
function isPhpImportStatement(stmtType: string): boolean {
  return (
    stmtType === TreeSitterNodeTypes.NAMESPACE_USE_DECLARATION ||
    stmtType === TreeSitterNodeTypes.INCLUDE_EXPRESSION ||
    stmtType === TreeSitterNodeTypes.INCLUDE_ONCE_EXPRESSION ||
    stmtType === TreeSitterNodeTypes.REQUIRE_EXPRESSION ||
    stmtType === TreeSitterNodeTypes.REQUIRE_ONCE_EXPRESSION
  );
}

function collectPhpNamespaceUseDescriptor(
  stmt: Node,
  descriptors: ParsedImportDescriptor[],
): void {
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
}

function collectPhpIncludeOrRequireDescriptor(
  stmt: Node,
  descriptors: ParsedImportDescriptor[],
): void {
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

function collectPhpImportDescriptors(
  stmt: Node,
  stmtType: string,
  descriptors: ParsedImportDescriptor[],
): void {
  if (stmtType === TreeSitterNodeTypes.NAMESPACE_USE_DECLARATION) {
    collectPhpNamespaceUseDescriptor(stmt, descriptors);
  } else {
    collectPhpIncludeOrRequireDescriptor(stmt, descriptors);
  }
}

// ── C# ────────────────────────────────────────────────────────────────
function collectCSharpUsingDescriptors(
  stmt: Node,
  descriptors: ParsedImportDescriptor[],
): void {
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
}

// ── Fallback: generic identifier extraction ──────────────────────────
function collectFallbackImportDescriptors(
  stmt: Node,
  descriptors: ParsedImportDescriptor[],
): void {
  const sourceNode = stmt.descendantsOfType("string").pop();
  if (!sourceNode) return;
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
    if (child.type === TreeSitterNodeTypes.ALIASED_IMPORT) {
      const nameNode = child.childForFieldName("name");
      const aliasNode = child.childForFieldName("alias");
      if (nameNode && aliasNode) {
        descriptors.push({
          localName: aliasNode.text,
          originalName: nameNode.text,
          modulePath: sourceStr,
        });
      }
    } else if (child.type === TreeSitterNodeTypes.DOTTED_NAME) {
      const ids = child.descendantsOfType("identifier");
      const lastId = ids[ids.length - 1];
      if (lastId) {
        descriptors.push({
          localName: lastId.text,
          originalName: child.text,
          modulePath: sourceStr,
        });
      }
    } else if (child.type === TreeSitterNodeTypes.IDENTIFIER) {
      descriptors.push({
        localName: child.text,
        originalName: child.text,
        modulePath: sourceStr,
      });
    }
  }
}

interface CallClassification {
  isMethodCall: boolean;
  methodName: string;
  objectName?: string;
}

// ── TypeScript / JavaScript ────────────────────────────────────────────
function classifyTsJsCall(callNode: Node): CallClassification {
  const fnNode = callNode.childForFieldName("function");
  if (!fnNode) return { isMethodCall: false, methodName: "" };

  if (fnNode.type === TreeSitterNodeTypes.MEMBER_EXPRESSION) {
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

// ── Python ────────────────────────────────────────────────────────────
function classifyPythonCall(callNode: Node): CallClassification {
  const fnNode = callNode.childForFieldName("function");
  if (!fnNode) return { isMethodCall: false, methodName: "" };

  if (fnNode.type === TreeSitterNodeTypes.ATTRIBUTE) {
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

// ── Java ──────────────────────────────────────────────────────────────
function classifyJavaMethodInvocation(
  callNode: Node,
): CallClassification | undefined {
  const nameNode = callNode.childForFieldName("name");
  const objNode = callNode.childForFieldName("object");
  if (nameNode) {
    return {
      isMethodCall: true,
      methodName: nameNode.text,
      objectName: objNode?.text,
    };
  }
  return undefined;
}

function classifyJavaConstructorInvocation(callNode: Node): CallClassification {
  const objNode = callNode.childForFieldName("constructor");
  return {
    isMethodCall: true,
    methodName: objNode?.text || SELF_REFERENCE_KEYWORD,
    objectName: SELF_REFERENCE_KEYWORD,
  };
}

// ── Ruby ──────────────────────────────────────────────────────────────
function classifyRubyCommandCall(
  callNode: Node,
): CallClassification | undefined {
  const methodNode = callNode.childForFieldName("method");
  if (!methodNode) return undefined;

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

// ── PHP ───────────────────────────────────────────────────────────────
function classifyPhpCall(callNode: Node): CallClassification {
  const callType = callNode.type;
  const nameNode = callNode.childForFieldName("name");
  const methodName = nameNode?.text || "";

  if (callType === TreeSitterNodeTypes.MEMBER_CALL_EXPRESSION) {
    const objNode = callNode.childForFieldName("object");
    return {
      isMethodCall: true,
      methodName,
      objectName: objNode?.text,
    };
  }

  if (callType === TreeSitterNodeTypes.SCOPED_CALL_EXPRESSION) {
    const classNode = callNode.childForFieldName("scope");
    return {
      isMethodCall: true,
      methodName,
      objectName: classNode?.text,
    };
  }
  return { isMethodCall: false, methodName };
}

// ── C# ────────────────────────────────────────────────────────────────
function classifyCSharpInvocation(
  callNode: Node,
): CallClassification | undefined {
  const exprNode =
    callNode.childForFieldName("function") || callNode.namedChildren[0];
  if (
    exprNode &&
    exprNode.type === TreeSitterNodeTypes.MEMBER_ACCESS_EXPRESSION
  ) {
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
  return undefined;
}

function classifyCSharpObjectCreation(callNode: Node): CallClassification {
  const typeNode = callNode.childForFieldName("type");
  return {
    isMethodCall: true,
    methodName: CONSTRUCTOR_CALL_METHOD_NAME,
    objectName: typeNode?.text,
  };
}

// ── Fallback ──────────────────────────────────────────────────────────
function classifyFallbackCall(callNode: Node): CallClassification {
  const fnNode =
    callNode.childForFieldName("function") ||
    callNode.descendantsOfType("identifier")[0];
  return { isMethodCall: false, methodName: fnNode?.text || "" };
}

/**
 * Dispatch table for call-node types that resolve unambiguously to a single per-language
 * classifier. Mirrors the exact reachable set of standalone `callType === "..."` checks from
 * the original hand-written implementation: several languages (Rust, Go, C/C++) share the
 * tree-sitter node type "call_expression" with TypeScript/JavaScript, and Ruby's "call" type
 * is shared with Python — in the original, whichever language-specific check appeared first
 * always returned, making the later same-type checks unreachable. Only the first (reachable)
 * handler for each type is registered here, which reproduces that behavior exactly.
 */
const CALL_CLASSIFIERS: Record<
  string,
  (callNode: Node) => CallClassification | undefined
> = {
  [TreeSitterNodeTypes.CALL_EXPRESSION]: classifyTsJsCall,
  [TreeSitterNodeTypes.CALL]: classifyPythonCall,
  [TreeSitterNodeTypes.METHOD_INVOCATION]: classifyJavaMethodInvocation,
  [TreeSitterNodeTypes.EXPLICIT_CONSTRUCTOR_INVOCATION]:
    classifyJavaConstructorInvocation,
  [TreeSitterNodeTypes.COMMAND_CALL]: classifyRubyCommandCall,
  [TreeSitterNodeTypes.FUNCTION_CALL_EXPRESSION]: classifyPhpCall,
  [TreeSitterNodeTypes.MEMBER_CALL_EXPRESSION]: classifyPhpCall,
  [TreeSitterNodeTypes.SCOPED_CALL_EXPRESSION]: classifyPhpCall,
  [TreeSitterNodeTypes.INVOCATION_EXPRESSION]: classifyCSharpInvocation,
  [TreeSitterNodeTypes.OBJECT_CREATION_EXPRESSION]:
    classifyCSharpObjectCreation,
};

export function classifyCall(callNode: Node): CallClassification {
  const handler = CALL_CLASSIFIERS[callNode.type];
  if (handler) {
    const classification = handler(callNode);
    if (classification) return classification;
  }
  return classifyFallbackCall(callNode);
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
