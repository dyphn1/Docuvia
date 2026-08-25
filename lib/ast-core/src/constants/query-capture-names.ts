/**
 * Tree-sitter query capture-group names (`@name`) used across every language
 * config's `queries` patterns. Unlike grammar-dictated node-type/field-name
 * strings (e.g. `class_declaration`, `name:`), these capture names are a
 * Docuvia-defined convention layered on top of the grammar — they line up
 * with `AstEventType` (see `./ast-event-constants.js`) — so they are not
 * exempt pass-through vocabulary and must be centralized here.
 */
export const QueryCaptureName = {
  CLASS: "class",
  FUNCTION: "function",
  VARIABLE: "variable",
  IMPORT: "import",
  CALL: "call",
  IMPLEMENTS: "implements",
  EXTENDS: "extends",
} as const;
