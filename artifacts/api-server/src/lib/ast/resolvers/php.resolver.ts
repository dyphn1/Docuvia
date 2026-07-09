import { AST_NODE_TYPES, AST_FIELD_NAMES } from "@workspace/core";

export function resolvePhpImport(stmt: any, scopeMap: Map<string, string>): boolean {
  const stmtType = stmt.type;

  if (stmtType === AST_NODE_TYPES.NAMESPACE_USE_DECLARATION) {
    const nameNode =
      stmt.descendantsOfType(AST_NODE_TYPES.QUALIFIED_NAME)[0] ||
      stmt.descendantsOfType(AST_NODE_TYPES.NAME)[0];
    if (nameNode) {
      const fullName = nameNode.text;
      const parts = fullName.split("\\");
      scopeMap.set(parts[parts.length - 1], fullName);
    }
    return true;
  }

  if (
    stmtType === AST_NODE_TYPES.INCLUDE_EXPRESSION ||
    stmtType === AST_NODE_TYPES.INCLUDE_ONCE_EXPRESSION ||
    stmtType === AST_NODE_TYPES.REQUIRE_EXPRESSION ||
    stmtType === AST_NODE_TYPES.REQUIRE_ONCE_EXPRESSION
  ) {
    const strNode =
      stmt.descendantsOfType(AST_NODE_TYPES.STRING)[0] ||
      stmt.descendantsOfType(AST_NODE_TYPES.STRING_CONTENT)[0];
    if (strNode) {
      const includePath = strNode.text.replace(/['"]/g, "");
      scopeMap.set(includePath, includePath);
    }
    return true;
  }

  return false;
}

export function classifyPhpCall(
  callNode: any
): { isMethodCall: boolean; methodName: string; objectName?: string } | null {
  const callType = callNode.type;

  if (callType === AST_NODE_TYPES.MEMBER_CALL_EXPRESSION) {
    const nameNode = callNode.childForFieldName(AST_FIELD_NAMES.NAME);
    const objNode = callNode.childForFieldName(AST_FIELD_NAMES.OBJECT);
    return { isMethodCall: true, methodName: nameNode?.text || "", objectName: objNode?.text };
  }
  if (callType === AST_NODE_TYPES.SCOPED_CALL_EXPRESSION) {
    const nameNode = callNode.childForFieldName(AST_FIELD_NAMES.NAME);
    const classNode = callNode.childForFieldName(AST_FIELD_NAMES.SCOPE);
    return { isMethodCall: true, methodName: nameNode?.text || "", objectName: classNode?.text };
  }
  if (callType === AST_NODE_TYPES.FUNCTION_CALL_EXPRESSION) {
    const nameNode = callNode.childForFieldName(AST_FIELD_NAMES.NAME);
    return { isMethodCall: false, methodName: nameNode?.text || "" };
  }

  return null;
}
