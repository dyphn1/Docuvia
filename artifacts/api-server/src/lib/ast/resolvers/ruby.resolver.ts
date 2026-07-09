import { AST_NODE_TYPES, AST_FIELD_NAMES } from "@workspace/core";

const RUBY_IMPORT_METHODS = new Set(["require", "require_relative", "load"]);

export function resolveRubyImport(stmt: any, scopeMap: Map<string, string>): boolean {
  if (stmt.type !== AST_NODE_TYPES.CALL) return false;

  const methodNode = stmt.childForFieldName(AST_FIELD_NAMES.METHOD);
  if (methodNode) {
    const methodName = methodNode.text;
    if (RUBY_IMPORT_METHODS.has(methodName)) {
      const args = stmt.childForFieldName(AST_FIELD_NAMES.ARGUMENTS);
      if (args) {
        const strNode =
          args.descendantsOfType(AST_NODE_TYPES.STRING_CONTENT)[0] ||
          args.descendantsOfType(AST_NODE_TYPES.STRING)[0];
        if (strNode) {
          const libName = strNode.text.replace(/['"]/g, "");
          const shortName = libName.replace(/\.rb$/, "");
          scopeMap.set(shortName, libName);
          return true;
        }
      }
    }
  }

  return false;
}

export function classifyRubyCall(
  callNode: any
): { isMethodCall: boolean; methodName: string; objectName?: string } | null {
  const callType = callNode.type;
  if (callType !== AST_NODE_TYPES.CALL && callType !== AST_NODE_TYPES.COMMAND_CALL) return null;

  const methodNode = callNode.childForFieldName(AST_FIELD_NAMES.METHOD);
  if (methodNode) {
    const objNode = callNode.childForFieldName(AST_FIELD_NAMES.RECEIVER);
    if (objNode) {
      return { isMethodCall: true, methodName: methodNode.text, objectName: objNode.text };
    }
    return { isMethodCall: false, methodName: methodNode.text };
  }

  return null;
}
