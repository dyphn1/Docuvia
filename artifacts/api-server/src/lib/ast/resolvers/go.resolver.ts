import { AST_NODE_TYPES, AST_FIELD_NAMES } from "@workspace/core";

export function resolveGoImport(stmt: any, scopeMap: Map<string, string>): boolean {
  if (stmt.type !== AST_NODE_TYPES.IMPORT_DECLARATION) return false;

  const specList = stmt.descendantsOfType(AST_NODE_TYPES.IMPORT_SPEC_LIST)[0];
  if (specList) {
    const specs = specList.descendantsOfType(AST_NODE_TYPES.IMPORT_SPEC);
    for (const spec of specs) {
      const pathNode = spec.childForFieldName(AST_FIELD_NAMES.PATH);
      if (!pathNode) continue;
      const pkgPath = pathNode.text.replace(/['"]/g, "");
      const nameNode = spec.childForFieldName(AST_FIELD_NAMES.NAME);
      if (nameNode) {
        if (
          nameNode.type === AST_NODE_TYPES.DOT ||
          nameNode.type === AST_NODE_TYPES.BLANK_IDENTIFIER
        )
          continue;
        scopeMap.set(nameNode.text, pkgPath);
      } else {
        const segments = pkgPath.split("/");
        scopeMap.set(segments[segments.length - 1], pkgPath);
      }
    }
    return true;
  }

  return false;
}

export function classifyGoCall(
  callNode: any
): { isMethodCall: boolean; methodName: string; objectName?: string } | null {
  if (callNode.type !== AST_NODE_TYPES.CALL_EXPRESSION) return null;

  const fnNode = callNode.childForFieldName(AST_FIELD_NAMES.FUNCTION);
  if (!fnNode) return null;

  if (fnNode.type === AST_NODE_TYPES.SELECTOR_EXPRESSION) {
    const fieldNode = fnNode.childForFieldName(AST_FIELD_NAMES.FIELD);
    const objNode = fnNode.childForFieldName(AST_FIELD_NAMES.VALUE);
    if (fieldNode) {
      return { isMethodCall: true, methodName: fieldNode.text, objectName: objNode?.text };
    }
  }

  return null;
}
