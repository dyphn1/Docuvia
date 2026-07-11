import type { LanguageConfig } from "@workspace/ast-core";

export const cppConfig: LanguageConfig = {
  extensions: [".cpp", ".cxx", ".cc", ".hpp", ".hxx", ".hh", ".cu", ".cuh"],
  wasm_file: "tree-sitter-cpp.wasm",
  imports: ["preproc_include", "using_declaration"],
  classes: [
    "class_specifier",
    "struct_specifier",
    "enum_specifier",
    "union_specifier",
    "type_definition",
  ],
  functions: ["function_definition"],
  calls: ["call_expression"],
  queries: {
    classes: `(class_specifier name: (type_identifier) @class) (struct_specifier name: (type_identifier) @class) (enum_specifier name: (type_identifier) @class) (union_specifier name: (type_identifier) @class) (type_definition name: (type_identifier) @class)`,
    functions: `(function_definition declarator: (function_declarator declarator: (identifier) @function))`,
    imports: `(preproc_include) @import (using_declaration) @import`,
    calls: `(call_expression function: [(identifier) (field_expression)] @call)`,
  },
};
