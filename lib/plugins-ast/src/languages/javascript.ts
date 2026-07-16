import type { LanguageConfig } from "@workspace/ast-core";
import { QueryCaptureName } from "../constants/query-capture-names.js";

const JAVASCRIPT_EXTENSIONS = [".js", ".jsx", ".mjs", ".cjs"];
const JAVASCRIPT_WASM_FILE = "tree-sitter-javascript.wasm";

export const javascriptConfig: LanguageConfig = {
  extensions: JAVASCRIPT_EXTENSIONS,
  wasm_file: JAVASCRIPT_WASM_FILE,
  imports: ["import_statement"],
  classes: ["class_declaration"],
  functions: [
    "function_declaration",
    "method_definition",
    "arrow_function",
    "function_expression",
    "generator_function_declaration",
    "generator_function",
  ],
  calls: ["call_expression"],
  queries: {
    classes: `(class_declaration name: (identifier) @${QueryCaptureName.CLASS})`,
    functions: `(function_declaration name: (identifier) @${QueryCaptureName.FUNCTION}) (method_definition name: (property_identifier) @${QueryCaptureName.FUNCTION})`,
    imports: `(import_statement) @${QueryCaptureName.IMPORT}`,
    calls: `(call_expression function: [(identifier) (member_expression)] @${QueryCaptureName.CALL})`,
  },
};
