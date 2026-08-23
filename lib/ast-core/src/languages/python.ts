import type { LanguageConfig } from "../language-provider.js";
import { QueryCaptureName } from "../constants/query-capture-names.js";
import { LanguageNodeTypes } from "../constants/language-node-types.js";
import { PYTHON_EXTENSIONS } from "@workspace/contracts";
const PYTHON_WASM_FILE = "tree-sitter-python.wasm";

export const pythonConfig: LanguageConfig = {
  extensions: PYTHON_EXTENSIONS,
  wasm_file: PYTHON_WASM_FILE,
  imports: [
    LanguageNodeTypes.IMPORT_STATEMENT,
    LanguageNodeTypes.IMPORT_FROM_STATEMENT,
  ],
  classes: [LanguageNodeTypes.CLASS_DEFINITION],
  functions: [LanguageNodeTypes.FUNCTION_DEFINITION],
  calls: [LanguageNodeTypes.CALL],
  // Python has no `implements` keyword — base classes and mixins share the same
  // parenthesized list (`class Derived(Base, Mixin):`), so both surface as `extends` edges.
  // `keyword_argument` entries (e.g. `metaclass=ABCMeta`) are excluded by only matching
  // bare identifiers/attributes, not the full argument_list.
  extends: [LanguageNodeTypes.CLASS_DEFINITION],
  queries: {
    classes: `(${LanguageNodeTypes.CLASS_DEFINITION} name: (${LanguageNodeTypes.IDENTIFIER})) @${QueryCaptureName.CLASS}`,
    functions: `(${LanguageNodeTypes.FUNCTION_DEFINITION} name: (${LanguageNodeTypes.IDENTIFIER})) @${QueryCaptureName.FUNCTION}`,
    imports: `(${LanguageNodeTypes.IMPORT_STATEMENT}) @${QueryCaptureName.IMPORT} (${LanguageNodeTypes.IMPORT_FROM_STATEMENT}) @${QueryCaptureName.IMPORT}`,
    calls: `(${LanguageNodeTypes.CALL} function: [(${LanguageNodeTypes.IDENTIFIER}) (${LanguageNodeTypes.ATTRIBUTE})] @${QueryCaptureName.CALL})`,
    extends: `(${LanguageNodeTypes.CLASS_DEFINITION} (${LanguageNodeTypes.ARGUMENT_LIST} [(${LanguageNodeTypes.IDENTIFIER}) (${LanguageNodeTypes.ATTRIBUTE})] @${QueryCaptureName.EXTENDS}))`,
  },
};
