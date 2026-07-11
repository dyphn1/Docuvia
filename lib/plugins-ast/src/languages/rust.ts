import type { LanguageConfig } from "@workspace/ast-core";

export const rustConfig: LanguageConfig = {
  extensions: [".rs"],
  wasm_file: "tree-sitter-rust.wasm",
  imports: ["use_declaration"],
  classes: ["struct_item", "enum_item", "union_item", "trait_item"],
  functions: ["function_item"],
  calls: ["call_expression"],
  queries: {
    classes: `(struct_item name: (type_identifier) @class) (enum_item name: (type_identifier) @class) (union_item name: (type_identifier) @class) (trait_item name: (type_identifier) @class)`,
    functions: `(function_item name: (identifier) @function)`,
    imports: `(use_declaration) @import`,
    calls: `(call_expression function: [(identifier) (field_expression)] @call)`,
  },
};
