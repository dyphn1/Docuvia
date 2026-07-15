import type { LanguageConfig } from "@workspace/ast-core";
import { QueryCaptureName } from "../constants/query-capture-names.js";

export const rustConfig: LanguageConfig = {
  extensions: [".rs"],
  wasm_file: "tree-sitter-rust.wasm",
  imports: ["use_declaration"],
  classes: ["struct_item", "enum_item", "union_item", "trait_item"],
  functions: ["function_item"],
  calls: ["call_expression"],
  queries: {
    classes: `(struct_item name: (type_identifier) @${QueryCaptureName.CLASS}) (enum_item name: (type_identifier) @${QueryCaptureName.CLASS}) (union_item name: (type_identifier) @${QueryCaptureName.CLASS}) (trait_item name: (type_identifier) @${QueryCaptureName.CLASS})`,
    functions: `(function_item name: (identifier) @${QueryCaptureName.FUNCTION})`,
    imports: `(use_declaration) @${QueryCaptureName.IMPORT}`,
    calls: `(call_expression function: [(identifier) (field_expression)] @${QueryCaptureName.CALL})`,
  },
};
