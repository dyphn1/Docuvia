import type { LanguageConfig } from "../language-provider.js";

export const phpConfig: LanguageConfig = {
  extensions: [".php", ".phtml", ".php3", ".php4", ".php5", ".phps"],
  wasm_file: "tree-sitter-php.wasm",
  imports: [
    "namespace_use_declaration",
    "include_expression",
    "include_once_expression",
    "require_expression",
    "require_once_expression",
  ],
  classes: ["class_declaration", "interface_declaration", "trait_declaration", "enum_declaration"],
  functions: ["function_definition", "method_declaration"],
  calls: ["function_call_expression", "member_call_expression", "scoped_call_expression"],
  queries: {
    classes: `(class_declaration name: (name) @class) (interface_declaration name: (name) @class) (trait_declaration name: (name) @class) (enum_declaration name: (name) @class)`,
    functions: `(function_definition name: (name) @function) (method_declaration name: (name) @function)`,
    imports: `(namespace_use_declaration) @import (include_expression) @import (include_once_expression) @import (require_expression) @import (require_once_expression) @import`,
    calls: `(function_call_expression function: (name) @call) (member_call_expression name: (name) @call) (scoped_call_expression name: (name) @call)`,
  },
};
