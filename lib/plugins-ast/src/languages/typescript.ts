import type { LanguageConfig } from "@workspace/ast-core";

export const typescriptConfig: LanguageConfig = {
  extensions: [".ts", ".tsx", ".mts", ".cts"],
  wasm_file: "tree-sitter-typescript.wasm",
  imports: ["import_statement"],
  classes: [
    "class_declaration",
    "interface_declaration",
    "enum_declaration",
    "type_alias_declaration",
  ],
  functions: [
    "function_declaration",
    "method_definition",
    "arrow_function",
    "function_expression",
    "generator_function_declaration",
    "generator_function",
  ],
  calls: ["call_expression"],
  implements: ["implements_clause"],
  extends: ["extends_clause"],
  queries: {
    classes: `(class_declaration name: (identifier) @class) (interface_declaration name: (type_identifier) @class) (enum_declaration name: (identifier) @class) (type_alias_declaration name: (type_identifier) @class)`,
    functions: `(function_declaration name: (identifier) @function) (method_definition name: (property_identifier) @function)`, // arrow/expression forms handled outside queries — see resolveCallableName() in ast-worker.ts, they have no queryable "name" field
    imports: `(import_statement) @import`,
    calls: `(call_expression function: [(identifier) (member_expression)] @call)`,
    implements: `(implements_clause (_) @implements)`,
    extends: `(extends_clause value: (_) @extends)`,
  },
};
