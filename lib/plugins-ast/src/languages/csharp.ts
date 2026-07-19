import type { LanguageConfig } from "@workspace/ast-core";
import { QueryCaptureName } from "../constants/query-capture-names.js";
import { LanguageNodeTypes } from "../constants/tree-sitter-node-types.js";

const CSHARP_EXTENSIONS = [".cs"];
const CSHARP_WASM_FILE = "tree-sitter-c_sharp.wasm";

export const csharpConfig: LanguageConfig = {
  extensions: CSHARP_EXTENSIONS,
  wasm_file: CSHARP_WASM_FILE,
  imports: [LanguageNodeTypes.USING_DIRECTIVE],
  classes: [
    LanguageNodeTypes.CLASS_DECLARATION,
    LanguageNodeTypes.STRUCT_DECLARATION,
    LanguageNodeTypes.INTERFACE_DECLARATION,
    LanguageNodeTypes.ENUM_DECLARATION,
    LanguageNodeTypes.RECORD_DECLARATION,
  ],
  functions: [
    LanguageNodeTypes.METHOD_DECLARATION,
    LanguageNodeTypes.CONSTRUCTOR_DECLARATION,
    LanguageNodeTypes.DESTRUCTOR_DECLARATION,
    LanguageNodeTypes.CONVERSION_OPERATOR_DECLARATION,
    LanguageNodeTypes.OPERATOR_DECLARATION,
    LanguageNodeTypes.LOCAL_FUNCTION_STATEMENT,
  ],
  calls: [
    LanguageNodeTypes.INVOCATION_EXPRESSION,
    LanguageNodeTypes.OBJECT_CREATION_EXPRESSION,
  ],
  queries: {
    classes: `(${LanguageNodeTypes.CLASS_DECLARATION} name: (${LanguageNodeTypes.IDENTIFIER}) @${QueryCaptureName.CLASS}) (${LanguageNodeTypes.STRUCT_DECLARATION} name: (${LanguageNodeTypes.IDENTIFIER}) @${QueryCaptureName.CLASS}) (${LanguageNodeTypes.INTERFACE_DECLARATION} name: (${LanguageNodeTypes.IDENTIFIER}) @${QueryCaptureName.CLASS}) (${LanguageNodeTypes.ENUM_DECLARATION} name: (${LanguageNodeTypes.IDENTIFIER}) @${QueryCaptureName.CLASS}) (${LanguageNodeTypes.RECORD_DECLARATION} name: (${LanguageNodeTypes.IDENTIFIER}) @${QueryCaptureName.CLASS})`,
    functions: `(${LanguageNodeTypes.METHOD_DECLARATION} name: (${LanguageNodeTypes.IDENTIFIER}) @${QueryCaptureName.FUNCTION}) (${LanguageNodeTypes.CONSTRUCTOR_DECLARATION} name: (${LanguageNodeTypes.IDENTIFIER}) @${QueryCaptureName.FUNCTION}) (${LanguageNodeTypes.DESTRUCTOR_DECLARATION}) @${QueryCaptureName.FUNCTION} (${LanguageNodeTypes.CONVERSION_OPERATOR_DECLARATION}) @${QueryCaptureName.FUNCTION} (${LanguageNodeTypes.OPERATOR_DECLARATION}) @${QueryCaptureName.FUNCTION} (${LanguageNodeTypes.LOCAL_FUNCTION_STATEMENT}) @${QueryCaptureName.FUNCTION}`,
    imports: `(${LanguageNodeTypes.USING_DIRECTIVE}) @${QueryCaptureName.IMPORT}`,
    calls: `(${LanguageNodeTypes.INVOCATION_EXPRESSION}) @${QueryCaptureName.CALL} (${LanguageNodeTypes.OBJECT_CREATION_EXPRESSION}) @${QueryCaptureName.CALL}`,
  },
};
