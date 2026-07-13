import type { LanguageConfig } from "@workspace/ast-core";

export const cConfig: LanguageConfig = {
  extensions: [".c", ".h"],
  wasm_file: "tree-sitter-c.wasm",
  imports: ["preproc_include"],
  classes: [
    "struct_specifier",
    "enum_specifier",
    "union_specifier",
    "type_definition",
  ],
  functions: ["function_definition"],
  calls: ["call_expression"],
  queries: {
    classes: `(struct_specifier name: (type_identifier) @class) (enum_specifier name: (type_identifier) @class) (union_specifier name: (type_identifier) @class) (type_definition name: (type_identifier) @class)`,
    functions: `(function_definition declarator: (function_declarator declarator: (identifier) @function))`,
    imports: `(preproc_include) @import`,
    calls: `(call_expression function: (identifier) @call)`,
  },
};
