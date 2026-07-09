import { AST_NODE_TYPES, AST_FIELD_NAMES } from "@workspace/core";
import { NAMESPACE_DELIMITER } from "../ast-helpers.js";

export function resolveRustImport(stmt: any, scopeMap: Map<string, string>): boolean {
  if (stmt.type !== AST_NODE_TYPES.USE_DECLARATION) return false;

  const arg = stmt.childForFieldName(AST_FIELD_NAMES.ARGUMENT);
  if (!arg) return false;

  if (arg.type === AST_NODE_TYPES.USE_AS_CLAUSE) {
    const pathNode = arg.childForFieldName(AST_FIELD_NAMES.PATH);
    const aliasNode = arg.childForFieldName(AST_FIELD_NAMES.ALIAS);
    if (pathNode && aliasNode) scopeMap.set(aliasNode.text, pathNode.text);
    return true;
  }
  if (arg.type === AST_NODE_TYPES.USE_WILDCARD) return true;

  if (arg.type === AST_NODE_TYPES.SCOPED_USE_LIST) {
    const pathNode = arg.childForFieldName(AST_FIELD_NAMES.PATH);
    const listNode = arg.childForFieldName(AST_FIELD_NAMES.LIST);
    if (pathNode && listNode) {
      const prefix = pathNode.text;
      for (const child of listNode.namedChildren) {
        if (child.type === AST_NODE_TYPES.IDENTIFIER) {
          scopeMap.set(child.text, `${prefix}${NAMESPACE_DELIMITER}${child.text}`);
        } else if (child.type === AST_NODE_TYPES.SCOPED_IDENTIFIER) {
          const lastPart = child.descendantsOfType(AST_NODE_TYPES.IDENTIFIER).pop();
          if (lastPart) scopeMap.set(lastPart.text, `${prefix}${NAMESPACE_DELIMITER}${child.text}`);
        }
      }
    }
    return true;
  }

  if (arg.type === AST_NODE_TYPES.SCOPED_IDENTIFIER || arg.type === AST_NODE_TYPES.IDENTIFIER) {
    const ids = arg.descendantsOfType(AST_NODE_TYPES.IDENTIFIER);
    const lastId = ids[ids.length - 1];
    if (lastId) scopeMap.set(lastId.text, arg.text);
    return true;
  }

  return false;
}

export function classifyRustCall(
  callNode: any
): { isMethodCall: boolean; methodName: string; objectName?: string } | null {
  if (callNode.type !== AST_NODE_TYPES.CALL_EXPRESSION) return null;

  const fnNode = callNode.childForFieldName(AST_FIELD_NAMES.FUNCTION);
  if (!fnNode) return null;

  if (fnNode.type === AST_NODE_TYPES.FIELD_EXPRESSION) {
    const fieldNode = fnNode.childForFieldName(AST_FIELD_NAMES.FIELD);
    const objNode = fnNode.childForFieldName(AST_FIELD_NAMES.VALUE);
    if (fieldNode) {
      return { isMethodCall: true, methodName: fieldNode.text, objectName: objNode?.text };
    }
  }

  return null; // Let fallback or other resolvers handle standard call expression
}
