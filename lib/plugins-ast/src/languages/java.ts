import type { LanguageConfig } from "@workspace/ast-core";

export const javaConfig: LanguageConfig = {
  extensions: [".java"],
  wasm_file: "tree-sitter-java.wasm",
  imports: ["import_declaration"],
  classes: [
    "class_declaration",
    "interface_declaration",
    "enum_declaration",
    "annotation_type_declaration",
    "record_declaration",
  ],
  functions: ["method_declaration", "constructor_declaration", "compact_constructor_declaration"],
  calls: ["method_invocation", "explicit_constructor_invocation"],
  queries: {
    classes: `(class_declaration name: (identifier) @class) (interface_declaration name: (identifier) @class) (enum_declaration name: (identifier) @class) (annotation_type_declaration name: (identifier) @class) (record_declaration name: (identifier) @class)`,
    functions: `(method_declaration name: (identifier) @function) (constructor_declaration name: (identifier) @function) (compact_constructor_declaration name: (identifier) @function)`,
    imports: `(import_declaration) @import`,
    calls: `(method_invocation name: (identifier) @call) (explicit_constructor_invocation) @call`,
  },
};
