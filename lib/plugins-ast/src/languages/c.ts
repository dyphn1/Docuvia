import type { LanguageConfig } from "@workspace/ast-core";
import { QueryCaptureName } from "../constants/query-capture-names.js";
import { LanguageNodeTypes } from "../constants/tree-sitter-node-types.js";

const C_EXTENSIONS = [".c", ".h"];
const C_WASM_FILE = "tree-sitter-c.wasm";

export const cConfig: LanguageConfig = {
  extensions: C_EXTENSIONS,
  wasm_file: C_WASM_FILE,
  imports: [LanguageNodeTypes.PREPROC_INCLUDE],
  classes: [
    LanguageNodeTypes.STRUCT_SPECIFIER,
    LanguageNodeTypes.ENUM_SPECIFIER,
    LanguageNodeTypes.UNION_SPECIFIER,
    LanguageNodeTypes.TYPE_DEFINITION,
  ],
  functions: [LanguageNodeTypes.FUNCTION_DEFINITION],
  calls: [LanguageNodeTypes.CALL_EXPRESSION],
  queries: {
    classes: `(${LanguageNodeTypes.STRUCT_SPECIFIER} name: (${LanguageNodeTypes.TYPE_IDENTIFIER}) @${QueryCaptureName.CLASS}) (${LanguageNodeTypes.ENUM_SPECIFIER} name: (${LanguageNodeTypes.TYPE_IDENTIFIER}) @${QueryCaptureName.CLASS}) (${LanguageNodeTypes.UNION_SPECIFIER} name: (${LanguageNodeTypes.TYPE_IDENTIFIER}) @${QueryCaptureName.CLASS}) (${LanguageNodeTypes.TYPE_DEFINITION} name: (${LanguageNodeTypes.TYPE_IDENTIFIER}) @${QueryCaptureName.CLASS})`,
    functions: `(${LanguageNodeTypes.FUNCTION_DEFINITION} declarator: (${LanguageNodeTypes.FUNCTION_DECLARATOR} declarator: (${LanguageNodeTypes.IDENTIFIER}) @${QueryCaptureName.FUNCTION}))`,
    imports: `(${LanguageNodeTypes.PREPROC_INCLUDE}) @${QueryCaptureName.IMPORT}`,
    calls: `(${LanguageNodeTypes.CALL_EXPRESSION} function: (${LanguageNodeTypes.IDENTIFIER}) @${QueryCaptureName.CALL})`,
  },
};
