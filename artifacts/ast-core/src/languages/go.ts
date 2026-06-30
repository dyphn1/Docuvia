import type { LanguageConfig } from "../language-provider.js";

export const goConfig: LanguageConfig = {
  extensions: [".go"],
  wasm_file: "tree-sitter-go.wasm",
  imports: ["import_declaration"],
  classes: ["type_declaration"],
  functions: ["function_declaration", "method_declaration"],
  calls: ["call_expression"],
  queries: {
    classes: `(type_declaration name: (type_identifier) @class)`,
    functions: `(function_declaration name: (identifier) @function) (method_declaration name: (field_identifier) @function)`,
    imports: `(import_declaration) @import`,
    calls: `(call_expression function: [(identifier) (selector_expression)] @call)`,
  },
};
