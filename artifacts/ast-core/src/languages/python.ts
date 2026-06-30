import type { LanguageConfig } from "../language-provider.js";

export const pythonConfig: LanguageConfig = {
  extensions: [".py"],
  wasm_file: "tree-sitter-python.wasm",
  imports: ["import_statement", "import_from_statement"],
  classes: ["class_definition"],
  functions: ["function_definition"],
  calls: ["call"],
  queries: {
    classes: `(class_definition name: (identifier) @class)`,
    functions: `(function_definition name: (identifier) @function)`,
    imports: `(import_statement) @import (import_from_statement) @import`,
    calls: `(call function: [(identifier) (attribute)] @call)`,
  },
};
