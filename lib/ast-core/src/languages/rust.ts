import type { LanguageConfig } from "../language-provider.js";
import { QueryCaptureName } from "../constants/query-capture-names.js";
import { LanguageNodeTypes } from "../constants/language-node-types.js";

const RUST_EXTENSIONS = [".rs"];
const RUST_WASM_FILE = "tree-sitter-rust.wasm";

export const rustConfig: LanguageConfig = {
  extensions: RUST_EXTENSIONS,
  wasm_file: RUST_WASM_FILE,
  imports: [LanguageNodeTypes.USE_DECLARATION],
  classes: [
    LanguageNodeTypes.STRUCT_ITEM,
    LanguageNodeTypes.ENUM_ITEM,
    LanguageNodeTypes.UNION_ITEM,
    LanguageNodeTypes.TRAIT_ITEM,
  ],
  functions: [LanguageNodeTypes.FUNCTION_ITEM],
  calls: [LanguageNodeTypes.CALL_EXPRESSION],
  queries: {
    classes: `(${LanguageNodeTypes.STRUCT_ITEM} name: (${LanguageNodeTypes.TYPE_IDENTIFIER})) @${QueryCaptureName.CLASS} (${LanguageNodeTypes.ENUM_ITEM} name: (${LanguageNodeTypes.TYPE_IDENTIFIER})) @${QueryCaptureName.CLASS} (${LanguageNodeTypes.UNION_ITEM} name: (${LanguageNodeTypes.TYPE_IDENTIFIER})) @${QueryCaptureName.CLASS} (${LanguageNodeTypes.TRAIT_ITEM} name: (${LanguageNodeTypes.TYPE_IDENTIFIER})) @${QueryCaptureName.CLASS}`,
    functions: `(${LanguageNodeTypes.FUNCTION_ITEM} name: (${LanguageNodeTypes.IDENTIFIER})) @${QueryCaptureName.FUNCTION}`,
    imports: `(${LanguageNodeTypes.USE_DECLARATION}) @${QueryCaptureName.IMPORT}`,
    calls: `(${LanguageNodeTypes.CALL_EXPRESSION} function: [(${LanguageNodeTypes.IDENTIFIER}) (${LanguageNodeTypes.FIELD_EXPRESSION})] @${QueryCaptureName.CALL})`,
  },
};
