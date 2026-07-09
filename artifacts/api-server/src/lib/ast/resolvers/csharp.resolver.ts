import { AST_NODE_TYPES, AST_FIELD_NAMES } from "@workspace/core";

const CONSTRUCTOR_METHOD_NAME = "new";

export function resolveCsharpImport(stmt: any, scopeMap: Map<string, string>): boolean {
  if (stmt.type !== AST_NODE_TYPES.USING_DIRECTIVE) return false;

  const nameNode =
    stmt.descendantsOfType(AST_NODE_TYPES.QUALIFIED_NAME)[0] ||
    stmt.descendantsOfType(AST_NODE_TYPES.IDENTIFIER)[0];
  if (nameNode) {
    const fullName = nameNode.text;
    const parts = fullName.split(".");
    scopeMap.set(parts[parts.length - 1], fullName);
    return true;
  }

  return false;
}

export function classifyCsharpCall(
  callNode: any
): { isMethodCall: boolean; methodName: string; objectName?: string } | null {
  const callType = callNode.type;

  if (callType === AST_NODE_TYPES.INVOCATION_EXPRESSION) {
    const exprNode =
      callNode.childForFieldName(AST_FIELD_NAMES.FUNCTION) || callNode.namedChildren[0];
    if (exprNode?.type === AST_NODE_TYPES.MEMBER_ACCESS_EXPRESSION) {
      const nameNode = exprNode.childForFieldName(AST_FIELD_NAMES.NAME);
      const objNode = exprNode.childForFieldName(AST_FIELD_NAMES.EXPRESSION);
      if (nameNode) {
        return { isMethodCall: true, methodName: nameNode.text, objectName: objNode?.text };
      }
    }
    if (exprNode) return { isMethodCall: false, methodName: exprNode.text };
  }

  if (callType === AST_NODE_TYPES.OBJECT_CREATION_EXPRESSION) {
    const typeNode = callNode.childForFieldName(AST_FIELD_NAMES.TYPE);
    return { isMethodCall: true, methodName: CONSTRUCTOR_METHOD_NAME, objectName: typeNode?.text };
  }

  return null;
}
