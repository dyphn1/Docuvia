import type { LanguageConfig } from "@workspace/ast-core";
import { QueryCaptureName } from "../constants/query-capture-names.js";
import { LanguageNodeTypes } from "../constants/tree-sitter-node-types.js";

const TYPESCRIPT_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts"];
const TYPESCRIPT_WASM_FILE = "tree-sitter-typescript.wasm";

export const typescriptConfig: LanguageConfig = {
  extensions: TYPESCRIPT_EXTENSIONS,
  wasm_file: TYPESCRIPT_WASM_FILE,
  imports: [LanguageNodeTypes.IMPORT_STATEMENT],
  classes: [
    LanguageNodeTypes.CLASS_DECLARATION,
    LanguageNodeTypes.ABSTRACT_CLASS_DECLARATION,
    LanguageNodeTypes.INTERFACE_DECLARATION,
    LanguageNodeTypes.ENUM_DECLARATION,
    LanguageNodeTypes.TYPE_ALIAS_DECLARATION,
  ],
  functions: [
    LanguageNodeTypes.FUNCTION_DECLARATION,
    LanguageNodeTypes.METHOD_DEFINITION,
    LanguageNodeTypes.ARROW_FUNCTION,
    LanguageNodeTypes.FUNCTION_EXPRESSION,
    LanguageNodeTypes.GENERATOR_FUNCTION_DECLARATION,
    LanguageNodeTypes.GENERATOR_FUNCTION,
  ],
  calls: [LanguageNodeTypes.CALL_EXPRESSION],
  implements: [LanguageNodeTypes.IMPLEMENTS_CLAUSE],
  extends: [LanguageNodeTypes.EXTENDS_CLAUSE],
  queries: {
    // `class_declaration`'s name field is a `type_identifier` in this grammar (unlike plain
    // JS's `identifier`) — using `identifier` here made the whole pattern fail to compile.
    classes: `(${LanguageNodeTypes.CLASS_DECLARATION} name: (${LanguageNodeTypes.TYPE_IDENTIFIER})) @${QueryCaptureName.CLASS} (${LanguageNodeTypes.ABSTRACT_CLASS_DECLARATION} name: (${LanguageNodeTypes.TYPE_IDENTIFIER})) @${QueryCaptureName.CLASS} (${LanguageNodeTypes.INTERFACE_DECLARATION} name: (${LanguageNodeTypes.TYPE_IDENTIFIER})) @${QueryCaptureName.CLASS} (${LanguageNodeTypes.ENUM_DECLARATION} name: (${LanguageNodeTypes.IDENTIFIER})) @${QueryCaptureName.CLASS} (${LanguageNodeTypes.TYPE_ALIAS_DECLARATION} name: (${LanguageNodeTypes.TYPE_IDENTIFIER})) @${QueryCaptureName.CLASS}`,
    // No compiled `functions` query: arrow functions and function expressions (2 of the 6 kinds
    // in the fallback array above) have no queryable "name" field of their own — their name comes
    // from resolveCallableName() walking up to an enclosing binding after extraction, in
    // ast-worker.ts. A query restricted to function_declaration/method_definition would silently
    // drop every arrow/expression-form function, so this field stays on the descendantsOfType
    // fallback (which already covers all 6 kinds) rather than compiling a narrower query.
    imports: `(${LanguageNodeTypes.IMPORT_STATEMENT}) @${QueryCaptureName.IMPORT}`,
    calls: `(${LanguageNodeTypes.CALL_EXPRESSION} function: [(${LanguageNodeTypes.IDENTIFIER}) (${LanguageNodeTypes.MEMBER_EXPRESSION})] @${QueryCaptureName.CALL})`,
    implements: `(${LanguageNodeTypes.IMPLEMENTS_CLAUSE} (_) @${QueryCaptureName.IMPLEMENTS})`,
    extends: `(${LanguageNodeTypes.EXTENDS_CLAUSE} value: (_) @${QueryCaptureName.EXTENDS})`,
  },
};
