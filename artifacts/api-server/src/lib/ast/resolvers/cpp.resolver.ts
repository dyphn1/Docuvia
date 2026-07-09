import { AST_NODE_TYPES, AST_FIELD_NAMES } from "@workspace/core";

export function resolveCppImport(stmt: any, scopeMap: Map<string, string>): boolean {
  const stmtType = stmt.type;

  if (stmtType === AST_NODE_TYPES.PREPROC_INCLUDE) {
    const pathNode = stmt.childForFieldName(AST_FIELD_NAMES.PATH);
    if (pathNode) {
      const includePath = pathNode.text.replace(/[<>"']/g, "");
      scopeMap.set(includePath, includePath);
    }
    return true;
  }

  if (stmtType === AST_NODE_TYPES.USING_DECLARATION) {
    for (const child of stmt.namedChildren) {
      if (child.type === AST_NODE_TYPES.QUALIFIED_IDENTIFIER) {
        const ids = child.descendantsOfType(AST_NODE_TYPES.IDENTIFIER);
        const lastId = ids[ids.length - 1];
        if (lastId) scopeMap.set(lastId.text, child.text);
      } else if (child.type === AST_NODE_TYPES.IDENTIFIER) {
        scopeMap.set(child.text, child.text);
      }
    }
    return true;
  }

  return false;
}

export function classifyCppCall(
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

  return null;
}
