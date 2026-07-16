/**
 * Fallback symbol name `ast-worker.ts`'s `resolveCallableName`/`getNodeName`/
 * `findEnclosingContainerName` return for genuinely unbound/unnamed AST nodes (IIFEs, bare
 * callback arguments, top-level call sites). `persist-ast-graph.ts` checks against the same
 * sentinel to decide whether a call site has a real containing symbol to link from.
 */
export const ANONYMOUS_SYMBOL_NAME = "anonymous";
