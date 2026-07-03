import type { LanguageConfig } from "@workspace/ast-core";

export const csharpConfig: LanguageConfig = {
  extensions: [".cs"],
  wasm_file: "tree-sitter-c_sharp.wasm",
  imports: ["using_directive"],
  classes: [
    "class_declaration",
    "struct_declaration",
    "interface_declaration",
    "enum_declaration",
    "record_declaration",
  ],
  functions: [
    "method_declaration",
    "constructor_declaration",
    "destructor_declaration",
    "conversion_operator_declaration",
    "operator_declaration",
    "local_function_statement",
  ],
  calls: ["invocation_expression", "object_creation_expression"],
  queries: {
    classes: `(class_declaration name: (identifier) @class) (struct_declaration name: (identifier) @class) (interface_declaration name: (identifier) @class) (enum_declaration name: (identifier) @class) (record_declaration name: (identifier) @class)`,
    functions: `(method_declaration name: (identifier) @function) (constructor_declaration name: (identifier) @function) (destructor_declaration) @function (conversion_operator_declaration) @function (operator_declaration) @function (local_function_statement) @function`,
    imports: `(using_directive) @import`,
    calls: `(invocation_expression) @call (object_creation_expression) @call`,
  },
};
