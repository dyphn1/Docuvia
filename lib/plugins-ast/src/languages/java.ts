import type { LanguageConfig } from "@workspace/ast-core";
import { QueryCaptureName } from "../constants/query-capture-names.js";
import { LanguageNodeTypes } from "../constants/tree-sitter-node-types.js";

const JAVA_EXTENSIONS = [".java"];
const JAVA_WASM_FILE = "tree-sitter-java.wasm";

export const javaConfig: LanguageConfig = {
  extensions: JAVA_EXTENSIONS,
  wasm_file: JAVA_WASM_FILE,
  imports: [LanguageNodeTypes.IMPORT_DECLARATION],
  classes: [
    LanguageNodeTypes.CLASS_DECLARATION,
    LanguageNodeTypes.INTERFACE_DECLARATION,
    LanguageNodeTypes.ENUM_DECLARATION,
    LanguageNodeTypes.ANNOTATION_TYPE_DECLARATION,
    LanguageNodeTypes.RECORD_DECLARATION,
  ],
  functions: [
    LanguageNodeTypes.METHOD_DECLARATION,
    LanguageNodeTypes.CONSTRUCTOR_DECLARATION,
    LanguageNodeTypes.COMPACT_CONSTRUCTOR_DECLARATION,
  ],
  calls: [
    LanguageNodeTypes.METHOD_INVOCATION,
    LanguageNodeTypes.EXPLICIT_CONSTRUCTOR_INVOCATION,
  ],
  queries: {
    classes: `(${LanguageNodeTypes.CLASS_DECLARATION} name: (${LanguageNodeTypes.IDENTIFIER}) @${QueryCaptureName.CLASS}) (${LanguageNodeTypes.INTERFACE_DECLARATION} name: (${LanguageNodeTypes.IDENTIFIER}) @${QueryCaptureName.CLASS}) (${LanguageNodeTypes.ENUM_DECLARATION} name: (${LanguageNodeTypes.IDENTIFIER}) @${QueryCaptureName.CLASS}) (${LanguageNodeTypes.ANNOTATION_TYPE_DECLARATION} name: (${LanguageNodeTypes.IDENTIFIER}) @${QueryCaptureName.CLASS}) (${LanguageNodeTypes.RECORD_DECLARATION} name: (${LanguageNodeTypes.IDENTIFIER}) @${QueryCaptureName.CLASS})`,
    functions: `(${LanguageNodeTypes.METHOD_DECLARATION} name: (${LanguageNodeTypes.IDENTIFIER}) @${QueryCaptureName.FUNCTION}) (${LanguageNodeTypes.CONSTRUCTOR_DECLARATION} name: (${LanguageNodeTypes.IDENTIFIER}) @${QueryCaptureName.FUNCTION}) (${LanguageNodeTypes.COMPACT_CONSTRUCTOR_DECLARATION} name: (${LanguageNodeTypes.IDENTIFIER}) @${QueryCaptureName.FUNCTION})`,
    imports: `(${LanguageNodeTypes.IMPORT_DECLARATION}) @${QueryCaptureName.IMPORT}`,
    calls: `(${LanguageNodeTypes.METHOD_INVOCATION} name: (${LanguageNodeTypes.IDENTIFIER}) @${QueryCaptureName.CALL}) (${LanguageNodeTypes.EXPLICIT_CONSTRUCTOR_INVOCATION}) @${QueryCaptureName.CALL}`,
  },
};
