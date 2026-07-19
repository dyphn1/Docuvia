import type { LanguageConfig } from "@workspace/ast-core";
import { QueryCaptureName } from "../constants/query-capture-names.js";
import { LanguageNodeTypes } from "../constants/tree-sitter-node-types.js";

const JAVASCRIPT_EXTENSIONS = [".js", ".jsx", ".mjs", ".cjs"];
const JAVASCRIPT_WASM_FILE = "tree-sitter-javascript.wasm";

export const javascriptConfig: LanguageConfig = {
  extensions: JAVASCRIPT_EXTENSIONS,
  wasm_file: JAVASCRIPT_WASM_FILE,
  imports: [LanguageNodeTypes.IMPORT_STATEMENT],
  classes: [LanguageNodeTypes.CLASS_DECLARATION],
  functions: [
    LanguageNodeTypes.FUNCTION_DECLARATION,
    LanguageNodeTypes.METHOD_DEFINITION,
    LanguageNodeTypes.ARROW_FUNCTION,
    LanguageNodeTypes.FUNCTION_EXPRESSION,
    LanguageNodeTypes.GENERATOR_FUNCTION_DECLARATION,
    LanguageNodeTypes.GENERATOR_FUNCTION,
  ],
  calls: [LanguageNodeTypes.CALL_EXPRESSION],
  queries: {
    classes: `(${LanguageNodeTypes.CLASS_DECLARATION} name: (${LanguageNodeTypes.IDENTIFIER}) @${QueryCaptureName.CLASS})`,
    functions: `(${LanguageNodeTypes.FUNCTION_DECLARATION} name: (${LanguageNodeTypes.IDENTIFIER}) @${QueryCaptureName.FUNCTION}) (${LanguageNodeTypes.METHOD_DEFINITION} name: (${LanguageNodeTypes.PROPERTY_IDENTIFIER}) @${QueryCaptureName.FUNCTION})`,
    imports: `(${LanguageNodeTypes.IMPORT_STATEMENT}) @${QueryCaptureName.IMPORT}`,
    calls: `(${LanguageNodeTypes.CALL_EXPRESSION} function: [(${LanguageNodeTypes.IDENTIFIER}) (${LanguageNodeTypes.MEMBER_EXPRESSION})] @${QueryCaptureName.CALL})`,
  },
};
