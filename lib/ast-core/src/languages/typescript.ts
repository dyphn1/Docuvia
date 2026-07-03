import type { LanguageConfig } from "../language-provider.js";

export const typescriptConfig: LanguageConfig = {
  extensions: [".ts", ".tsx"],
  wasm_file: "tree-sitter-typescript.wasm",
  imports: ["import_statement"],
  classes: ["class_declaration"],
  functions: ["function_declaration", "method_definition"],
  calls: ["call_expression"],
  implements: ["implements_clause"],
  extends: ["extends_clause"],
  queries: {
    classes: `(class_declaration name: (identifier) @class)`,
    functions: `(function_declaration name: (identifier) @function) (method_definition name: (property_identifier) @function)`,
    imports: `(import_statement) @import`,
    calls: `(call_expression function: [(identifier) (member_expression)] @call)`,
    implements: `(implements_clause (_) @implements)`,
    extends: `(extends_clause value: (_) @extends)`,
  },
};
