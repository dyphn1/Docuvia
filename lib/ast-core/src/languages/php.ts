import type { LanguageConfig } from "../language-provider.js";
import { QueryCaptureName } from "../constants/query-capture-names.js";
import { LanguageNodeTypes } from "../constants/language-node-types.js";

const PHP_EXTENSIONS = [".php", ".phtml", ".php3", ".php4", ".php5", ".phps"];
const PHP_WASM_FILE = "tree-sitter-php.wasm";

export const phpConfig: LanguageConfig = {
  extensions: PHP_EXTENSIONS,
  wasm_file: PHP_WASM_FILE,
  imports: [
    LanguageNodeTypes.NAMESPACE_USE_DECLARATION,
    LanguageNodeTypes.INCLUDE_EXPRESSION,
    LanguageNodeTypes.INCLUDE_ONCE_EXPRESSION,
    LanguageNodeTypes.REQUIRE_EXPRESSION,
    LanguageNodeTypes.REQUIRE_ONCE_EXPRESSION,
  ],
  classes: [
    LanguageNodeTypes.CLASS_DECLARATION,
    LanguageNodeTypes.INTERFACE_DECLARATION,
    LanguageNodeTypes.TRAIT_DECLARATION,
    LanguageNodeTypes.ENUM_DECLARATION,
  ],
  functions: [
    LanguageNodeTypes.FUNCTION_DEFINITION,
    LanguageNodeTypes.METHOD_DECLARATION,
  ],
  calls: [
    LanguageNodeTypes.FUNCTION_CALL_EXPRESSION,
    LanguageNodeTypes.MEMBER_CALL_EXPRESSION,
    LanguageNodeTypes.SCOPED_CALL_EXPRESSION,
  ],
  extends: [LanguageNodeTypes.BASE_CLAUSE],
  implements: [LanguageNodeTypes.CLASS_INTERFACE_CLAUSE],
  queries: {
    classes: `(${LanguageNodeTypes.CLASS_DECLARATION} name: (${LanguageNodeTypes.NAME})) @${QueryCaptureName.CLASS} (${LanguageNodeTypes.INTERFACE_DECLARATION} name: (${LanguageNodeTypes.NAME})) @${QueryCaptureName.CLASS} (${LanguageNodeTypes.TRAIT_DECLARATION} name: (${LanguageNodeTypes.NAME})) @${QueryCaptureName.CLASS} (${LanguageNodeTypes.ENUM_DECLARATION} name: (${LanguageNodeTypes.NAME})) @${QueryCaptureName.CLASS}`,
    functions: `(${LanguageNodeTypes.FUNCTION_DEFINITION} name: (${LanguageNodeTypes.NAME})) @${QueryCaptureName.FUNCTION} (${LanguageNodeTypes.METHOD_DECLARATION} name: (${LanguageNodeTypes.NAME})) @${QueryCaptureName.FUNCTION}`,
    imports: `(${LanguageNodeTypes.NAMESPACE_USE_DECLARATION}) @${QueryCaptureName.IMPORT} (${LanguageNodeTypes.INCLUDE_EXPRESSION}) @${QueryCaptureName.IMPORT} (${LanguageNodeTypes.INCLUDE_ONCE_EXPRESSION}) @${QueryCaptureName.IMPORT} (${LanguageNodeTypes.REQUIRE_EXPRESSION}) @${QueryCaptureName.IMPORT} (${LanguageNodeTypes.REQUIRE_ONCE_EXPRESSION}) @${QueryCaptureName.IMPORT}`,
    calls: `(${LanguageNodeTypes.FUNCTION_CALL_EXPRESSION} function: (${LanguageNodeTypes.NAME}) @${QueryCaptureName.CALL}) (${LanguageNodeTypes.MEMBER_CALL_EXPRESSION} name: (${LanguageNodeTypes.NAME}) @${QueryCaptureName.CALL}) (${LanguageNodeTypes.SCOPED_CALL_EXPRESSION} name: (${LanguageNodeTypes.NAME}) @${QueryCaptureName.CALL})`,
    extends: `(${LanguageNodeTypes.BASE_CLAUSE} (${LanguageNodeTypes.NAME}) @${QueryCaptureName.EXTENDS})`,
    implements: `(${LanguageNodeTypes.CLASS_INTERFACE_CLAUSE} (${LanguageNodeTypes.NAME}) @${QueryCaptureName.IMPLEMENTS})`,
  },
};
