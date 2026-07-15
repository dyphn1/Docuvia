import type { LanguageConfig } from "@workspace/ast-core";
import { QueryCaptureName } from "../constants/query-capture-names.js";

export const goConfig: LanguageConfig = {
  extensions: [".go"],
  wasm_file: "tree-sitter-go.wasm",
  imports: ["import_declaration"],
  classes: ["type_declaration"],
  functions: ["function_declaration", "method_declaration"],
  calls: ["call_expression"],
  queries: {
    classes: `(type_declaration name: (type_identifier) @${QueryCaptureName.CLASS})`,
    functions: `(function_declaration name: (identifier) @${QueryCaptureName.FUNCTION}) (method_declaration name: (field_identifier) @${QueryCaptureName.FUNCTION})`,
    imports: `(import_declaration) @${QueryCaptureName.IMPORT}`,
    calls: `(call_expression function: [(identifier) (selector_expression)] @${QueryCaptureName.CALL})`,
  },
};
