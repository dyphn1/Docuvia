import { AST_NODE_TYPES, AST_FIELD_NAMES } from "@workspace/core";
import { type LanguageProvider } from "@workspace/ast-core";
import { NAMESPACE_DELIMITER } from "../ast-helpers.js";

export function resolveTsJsImport(stmt: any, scopeMap: Map<string, string>): boolean {
  if (stmt.type !== AST_NODE_TYPES.IMPORT_STATEMENT) return false;

  const sourceNode = stmt.descendantsOfType(AST_NODE_TYPES.STRING).pop();
  if (!sourceNode) return false;
  const sourceText = sourceNode.text.replace(/['"]/g, "");

  // namespace_import: `import * as X from 'source'`
  const namespaceImport = stmt.descendantsOfType(AST_NODE_TYPES.NAMESPACE_IMPORT)[0];
  if (namespaceImport) {
    const nsId = namespaceImport.descendantsOfType(AST_NODE_TYPES.IDENTIFIER)[0];
    if (nsId) scopeMap.set(nsId.text, sourceText);
    return true;
  }

  // named_imports: `import { A, B as C } from 'source'`
  const namedImports = stmt.descendantsOfType(AST_NODE_TYPES.NAMED_IMPORTS)[0];
  if (namedImports) {
    const specifiers = namedImports.descendantsOfType(AST_NODE_TYPES.IMPORT_SPECIFIER);
    for (const spec of specifiers) {
      const nameNode = spec.childForFieldName(AST_FIELD_NAMES.NAME);
      const aliasNode = spec.childForFieldName(AST_FIELD_NAMES.ALIAS);
      if (nameNode) {
        const importedName = nameNode.text;
        const localName = aliasNode ? aliasNode.text : importedName;
        scopeMap.set(localName, `${sourceText}${NAMESPACE_DELIMITER}${importedName}`);
      }
    }
    return true;
  }

  // Default import: `import Foo from 'source'`
  const defaultId = stmt.descendantsOfType(AST_NODE_TYPES.IDENTIFIER)[0];
  if (defaultId) {
    scopeMap.set(defaultId.text, sourceText);
    return true;
  }

  return false;
}

export function classifyTsJsCall(
  callNode: any
): { isMethodCall: boolean; methodName: string; objectName?: string } | null {
  if (callNode.type !== AST_NODE_TYPES.CALL_EXPRESSION) return null;

  const fnNode = callNode.childForFieldName(AST_FIELD_NAMES.FUNCTION);
  if (!fnNode) return { isMethodCall: false, methodName: "" };

  if (fnNode.type === AST_NODE_TYPES.MEMBER_EXPRESSION) {
    const propNode = fnNode.childForFieldName(AST_FIELD_NAMES.PROPERTY);
    const objNode = fnNode.childForFieldName(AST_FIELD_NAMES.OBJECT);
    if (propNode) {
      return { isMethodCall: true, methodName: propNode.text, objectName: objNode?.text };
    }
  }

  return { isMethodCall: false, methodName: fnNode.text };
}
