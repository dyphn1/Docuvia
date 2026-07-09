import { AST_NODE_TYPES, AST_FIELD_NAMES } from "@workspace/core";
import { resolveTsJsImport, classifyTsJsCall } from "./resolvers/typescript.resolver.js";
import { resolvePythonImport, classifyPythonCall } from "./resolvers/python.resolver.js";
import { resolveRustImport, classifyRustCall } from "./resolvers/rust.resolver.js";
import { resolveGoImport, classifyGoCall } from "./resolvers/go.resolver.js";
import { resolveJavaImport, classifyJavaCall } from "./resolvers/java.resolver.js";
import { resolveCppImport, classifyCppCall } from "./resolvers/cpp.resolver.js";
import { resolveRubyImport, classifyRubyCall } from "./resolvers/ruby.resolver.js";
import { resolvePhpImport, classifyPhpCall } from "./resolvers/php.resolver.js";
import { resolveCsharpImport, classifyCsharpCall } from "./resolvers/csharp.resolver.js";

export const NAMESPACE_DELIMITER = "::";

// List of language-specific scope resolvers
const importResolvers = [
  resolveTsJsImport,
  resolvePythonImport,
  resolveRustImport,
  resolveGoImport,
  resolveJavaImport,
  resolveCppImport,
  resolveRubyImport,
  resolvePhpImport,
  resolveCsharpImport,
];

// List of language-specific call classifiers
const callClassifiers = [
  classifyTsJsCall,
  classifyPythonCall,
  classifyRustCall,
  classifyGoCall,
  classifyJavaCall,
  classifyCppCall,
  classifyRubyCall,
  classifyPhpCall,
  classifyCsharpCall,
];

/**
 * Build a scope map from import statements with enhanced resolution.
 * Delegates to language-specific strategy resolvers (Strategy Pattern).
 */
export function buildScopeMap(importStatements: any[]): Map<string, string> {
  const scopeMap = new Map<string, string>();

  for (const stmt of importStatements) {
    let resolved = false;

    // Try language-specific resolvers first
    for (const resolve of importResolvers) {
      if (resolve(stmt, scopeMap)) {
        resolved = true;
        break;
      }
    }

    if (resolved) continue;

    // ── Fallback ─────────────────────────────────────────────────────
    const sourceNode = stmt.descendantsOfType(AST_NODE_TYPES.STRING).pop();
    if (!sourceNode) continue;
    const srcText = sourceNode.text.replace(/['"]/g, "");
    const identifiers = stmt.descendantsOfType(AST_NODE_TYPES.IDENTIFIER);
    for (const idNode of identifiers) {
      if (!scopeMap.has(idNode.text)) {
        scopeMap.set(idNode.text, `${srcText}${NAMESPACE_DELIMITER}${idNode.text}`);
      }
    }
  }

  return scopeMap;
}

/**
 * Classify a call expression as method call or function call.
 * Delegates to language-specific strategy classifiers (Strategy Pattern).
 */
export function classifyCall(callNode: any): {
  isMethodCall: boolean;
  methodName: string;
  objectName?: string;
} {
  // Try language-specific classifiers first
  for (const classify of callClassifiers) {
    const result = classify(callNode);
    if (result !== null) {
      return result;
    }
  }

  // Fallback
  const fnNode =
    callNode.childForFieldName(AST_FIELD_NAMES.FUNCTION) ||
    callNode.descendantsOfType(AST_NODE_TYPES.IDENTIFIER)[0];
  return { isMethodCall: false, methodName: fnNode?.text || "" };
}
