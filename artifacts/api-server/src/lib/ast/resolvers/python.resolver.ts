import { AST_NODE_TYPES, AST_FIELD_NAMES } from "@workspace/core";
import { NAMESPACE_DELIMITER } from "../ast-helpers.js";

export function resolvePythonImport(stmt: any, scopeMap: Map<string, string>): boolean {
  const stmtType = stmt.type;

  if (stmtType === AST_NODE_TYPES.IMPORT_FROM_STATEMENT) {
    const moduleName = stmt.childForFieldName(AST_FIELD_NAMES.MODULE_NAME);
    if (!moduleName) return false;
    const sourceStr = moduleName.text;

    const wildcard = stmt.descendantsOfType(AST_NODE_TYPES.WILDCARD_IMPORT)[0];
    if (wildcard) return true;

    for (const child of stmt.namedChildren) {
      if (child.type === AST_NODE_TYPES.ALIASED_IMPORT) {
        const nameNode = child.childForFieldName(AST_FIELD_NAMES.NAME);
        const aliasNode = child.childForFieldName(AST_FIELD_NAMES.ALIAS);
        if (nameNode && aliasNode) {
          scopeMap.set(aliasNode.text, `${sourceStr}${NAMESPACE_DELIMITER}${nameNode.text}`);
        }
      } else if (child.type === AST_NODE_TYPES.DOTTED_NAME) {
        const ids = child.descendantsOfType(AST_NODE_TYPES.IDENTIFIER);
        const lastId = ids[ids.length - 1];
        if (lastId) scopeMap.set(lastId.text, `${sourceStr}${NAMESPACE_DELIMITER}${child.text}`);
      } else if (child.type === AST_NODE_TYPES.IDENTIFIER) {
        scopeMap.set(child.text, `${sourceStr}${NAMESPACE_DELIMITER}${child.text}`);
      }
    }
    return true;
  }

  if (stmtType === AST_NODE_TYPES.IMPORT_STATEMENT) {
    // Only handle if it looks like python's import structure (aliased import or dotted name without typescript namespace indicators)
    const aliased = stmt.descendantsOfType(AST_NODE_TYPES.ALIASED_IMPORT)[0];
    if (aliased) {
      const nameNode = aliased.childForFieldName(AST_FIELD_NAMES.NAME);
      const aliasNode = aliased.childForFieldName(AST_FIELD_NAMES.ALIAS);
      if (nameNode && aliasNode) {
        scopeMap.set(aliasNode.text, nameNode.text);
        return true;
      }
    }
    const dottedNames = stmt.descendantsOfType(AST_NODE_TYPES.DOTTED_NAME);
    if (dottedNames.length > 0) {
      for (const dn of dottedNames) {
        const firstId = dn.descendantsOfType(AST_NODE_TYPES.IDENTIFIER)[0];
        if (firstId) scopeMap.set(firstId.text, dn.text);
      }
      return true;
    }
  }

  return false;
}

export function classifyPythonCall(
  callNode: any
): { isMethodCall: boolean; methodName: string; objectName?: string } | null {
  if (callNode.type !== AST_NODE_TYPES.CALL) return null;

  const fnNode = callNode.childForFieldName(AST_FIELD_NAMES.FUNCTION);
  if (!fnNode) return { isMethodCall: false, methodName: "" };

  if (fnNode.type === AST_NODE_TYPES.ATTRIBUTE) {
    const attrNode = fnNode.childForFieldName(AST_FIELD_NAMES.ATTRIBUTE);
    const objNode = fnNode.childForFieldName(AST_FIELD_NAMES.OBJECT);
    if (attrNode) {
      return { isMethodCall: true, methodName: attrNode.text, objectName: objNode?.text };
    }
  }

  return { isMethodCall: false, methodName: fnNode.text };
}
