import type { LanguageConfig } from "../language-provider.js";
import { QueryCaptureName } from "../constants/query-capture-names.js";
import { LanguageNodeTypes } from "../constants/language-node-types.js";
import { GO_EXTENSIONS } from "@workspace/contracts";
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
    // The name field lives on the nested `type_spec`, not `type_declaration` itself — the
    // latter has no `name:` field and made the whole pattern fail to compile.
    classes: `(${LanguageNodeTypes.TYPE_SPEC} name: (${LanguageNodeTypes.TYPE_IDENTIFIER})) @${QueryCaptureName.CLASS}`,
    functions: `(${LanguageNodeTypes.FUNCTION_DECLARATION} name: (${LanguageNodeTypes.IDENTIFIER})) @${QueryCaptureName.FUNCTION} (${LanguageNodeTypes.METHOD_DECLARATION} name: (${LanguageNodeTypes.FIELD_IDENTIFIER})) @${QueryCaptureName.FUNCTION}`,
    imports: `(${LanguageNodeTypes.IMPORT_DECLARATION}) @${QueryCaptureName.IMPORT}`,
    calls: `(${LanguageNodeTypes.CALL_EXPRESSION} function: [(${LanguageNodeTypes.IDENTIFIER}) (${LanguageNodeTypes.SELECTOR_EXPRESSION})] @${QueryCaptureName.CALL})`,
  },
};
