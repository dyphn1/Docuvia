import type { LanguageConfig } from "@workspace/ast-core";
import { QueryCaptureName } from "../constants/query-capture-names.js";

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
  classes: [
    "class_declaration",
    "interface_declaration",
    "trait_declaration",
    "enum_declaration",
  ],
  functions: ["function_definition", "method_declaration"],
  calls: [
    "function_call_expression",
    "member_call_expression",
    "scoped_call_expression",
  ],
  queries: {
    classes: `(class_declaration name: (name) @${QueryCaptureName.CLASS}) (interface_declaration name: (name) @${QueryCaptureName.CLASS}) (trait_declaration name: (name) @${QueryCaptureName.CLASS}) (enum_declaration name: (name) @${QueryCaptureName.CLASS})`,
    functions: `(function_definition name: (name) @${QueryCaptureName.FUNCTION}) (method_declaration name: (name) @${QueryCaptureName.FUNCTION})`,
    imports: `(namespace_use_declaration) @${QueryCaptureName.IMPORT} (include_expression) @${QueryCaptureName.IMPORT} (include_once_expression) @${QueryCaptureName.IMPORT} (require_expression) @${QueryCaptureName.IMPORT} (require_once_expression) @${QueryCaptureName.IMPORT}`,
    calls: `(function_call_expression function: (name) @${QueryCaptureName.CALL}) (member_call_expression name: (name) @${QueryCaptureName.CALL}) (scoped_call_expression name: (name) @${QueryCaptureName.CALL})`,
  },
};
