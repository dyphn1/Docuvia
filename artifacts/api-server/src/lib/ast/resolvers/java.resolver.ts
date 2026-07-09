import { AST_NODE_TYPES, AST_FIELD_NAMES } from "@workspace/core";

export function resolveJavaImport(stmt: any, scopeMap: Map<string, string>): boolean {
  if (stmt.type !== AST_NODE_TYPES.IMPORT_DECLARATION) return false;

  const asterisk = stmt.descendantsOfType(AST_NODE_TYPES.ASTERISK)[0];
  if (asterisk) {
    const scopedIds = stmt.descendantsOfType(AST_NODE_TYPES.SCOPED_IDENTIFIER);
    const lastScoped = scopedIds[scopedIds.length - 1];
    if (lastScoped) {
      const ids = lastScoped.descendantsOfType(AST_NODE_TYPES.IDENTIFIER);
      const lastId = ids[ids.length - 1];
      if (lastId) scopeMap.set(lastId.text, lastScoped.text);
    }
    return true;
  }

  const scopedIds = stmt.descendantsOfType(AST_NODE_TYPES.SCOPED_IDENTIFIER);
  if (scopedIds.length > 0) {
    const lastScoped = scopedIds[scopedIds.length - 1];
    const allIds = lastScoped.descendantsOfType(AST_NODE_TYPES.IDENTIFIER);
    const lastId = allIds[allIds.length - 1];
    if (lastId) scopeMap.set(lastId.text, lastScoped.text);
    return true;
  }

  return false;
}

export function classifyJavaCall(
  callNode: any
): { isMethodCall: boolean; methodName: string; objectName?: string } | null {
  if (callNode.type !== AST_NODE_TYPES.METHOD_INVOCATION) return null;

  const nameNode = callNode.childForFieldName(AST_FIELD_NAMES.NAME);
  const objNode = callNode.childForFieldName(AST_FIELD_NAMES.OBJECT);
  if (nameNode) {
    return { isMethodCall: true, methodName: nameNode.text, objectName: objNode?.text };
  }

  return { isMethodCall: false, methodName: "" };
}
