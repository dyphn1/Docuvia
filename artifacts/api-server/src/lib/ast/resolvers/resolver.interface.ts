/**
 * Interface representing a language-specific AST resolver.
 */
export interface LanguageResolver {
  /**
   * Checks if this resolver can handle the given import statement type.
   */
  canResolveImport(stmtType: string): boolean;

  /**
   * Resolves scope (imports/exports mapping) for the given statement.
   */
  resolveScope(stmt: any, scopeMap: Map<string, string>, namespaceDelimiter: string): void;

  /**
   * Checks if this resolver can handle the given call expression node.
   */
  canResolveCall(callNode: any): boolean;

  /**
   * Classifies a call expression as method call or function call.
   */
  classifyCall(callNode: any): {
    isMethodCall: boolean;
    methodName: string;
    objectName?: string;
  } | null;
}
