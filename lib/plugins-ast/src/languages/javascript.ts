import type { LanguageConfig } from "@workspace/ast-core";

export const javascriptConfig: LanguageConfig = {
  extensions: [".js", ".jsx"],
  wasm_file: "tree-sitter-javascript.wasm",
  imports: ["import_statement"],
  classes: ["class_declaration"],
  functions: ["function_declaration", "method_definition"],
  calls: ["call_expression"],
  queries: {
    classes: `(class_declaration name: (identifier) @class)`,
    functions: `(function_declaration name: (identifier) @function) (method_definition name: (property_identifier) @function)`,
    imports: `(import_statement) @import`,
    calls: `(call_expression function: [(identifier) (member_expression)] @call)`,
  },
};
