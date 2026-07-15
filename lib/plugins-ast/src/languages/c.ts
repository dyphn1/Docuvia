import type { LanguageConfig } from "@workspace/ast-core";
import { QueryCaptureName } from "../constants/query-capture-names.js";

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
    classes: `(struct_specifier name: (type_identifier) @${QueryCaptureName.CLASS}) (enum_specifier name: (type_identifier) @${QueryCaptureName.CLASS}) (union_specifier name: (type_identifier) @${QueryCaptureName.CLASS}) (type_definition name: (type_identifier) @${QueryCaptureName.CLASS})`,
    functions: `(function_definition declarator: (function_declarator declarator: (identifier) @${QueryCaptureName.FUNCTION}))`,
    imports: `(preproc_include) @${QueryCaptureName.IMPORT}`,
    calls: `(call_expression function: (identifier) @${QueryCaptureName.CALL})`,
  },
};
