/**
 * AstEvent.type discriminant values emitted by parser-core, ast-traverser,
 * edge-computer, and bridge-provider to classify AST/graph events flowing
 * through the ingestion pipeline.
 */
export const AstEventType = {
  FILE: "file",
  CLASS: "class",
  FUNCTION: "function",
  CALL: "call",
  METHOD_CALL: "method_call",
  IMPORT: "import",
  API_CONTRACT: "api_contract",
} as const;

export type AstEventType = (typeof AstEventType)[keyof typeof AstEventType];
