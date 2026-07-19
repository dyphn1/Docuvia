import type { LanguageConfig } from "@workspace/ast-core";
import { QueryCaptureName } from "../constants/query-capture-names.js";
import { LanguageNodeTypes } from "../constants/tree-sitter-node-types.js";

const GO_EXTENSIONS = [".go"];
const GO_WASM_FILE = "tree-sitter-go.wasm";

export const goConfig: LanguageConfig = {
  extensions: GO_EXTENSIONS,
  wasm_file: GO_WASM_FILE,
  imports: [LanguageNodeTypes.IMPORT_DECLARATION],
  classes: [LanguageNodeTypes.TYPE_DECLARATION],
  functions: [
    LanguageNodeTypes.FUNCTION_DECLARATION,
    LanguageNodeTypes.METHOD_DECLARATION,
  ],
  calls: [LanguageNodeTypes.CALL_EXPRESSION],
  queries: {
    classes: `(${LanguageNodeTypes.TYPE_DECLARATION} name: (${LanguageNodeTypes.TYPE_IDENTIFIER}) @${QueryCaptureName.CLASS})`,
    functions: `(${LanguageNodeTypes.FUNCTION_DECLARATION} name: (${LanguageNodeTypes.IDENTIFIER}) @${QueryCaptureName.FUNCTION}) (${LanguageNodeTypes.METHOD_DECLARATION} name: (${LanguageNodeTypes.FIELD_IDENTIFIER}) @${QueryCaptureName.FUNCTION})`,
    imports: `(${LanguageNodeTypes.IMPORT_DECLARATION}) @${QueryCaptureName.IMPORT}`,
    calls: `(${LanguageNodeTypes.CALL_EXPRESSION} function: [(${LanguageNodeTypes.IDENTIFIER}) (${LanguageNodeTypes.SELECTOR_EXPRESSION})] @${QueryCaptureName.CALL})`,
  },
};
