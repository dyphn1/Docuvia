import type { LanguageConfig } from "../language-provider.js";
import { QueryCaptureName } from "../constants/query-capture-names.js";
import { LanguageNodeTypes } from "../constants/language-node-types.js";
import { TreeSitterNodeTypes } from "../constants/tree-sitter-node-types.js";
import { JAVASCRIPT_EXTENSIONS } from "@workspace/contracts";
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
  // Plain JS's `class_heritage` has no intermediate `extends_clause` node (unlike TS's
  // grammar) — it directly wraps the anonymous "extends" token and the value expression.
  extends: [LanguageNodeTypes.CLASS_HERITAGE],
  queries: {
    classes: `(${LanguageNodeTypes.CLASS_DECLARATION} name: (${LanguageNodeTypes.IDENTIFIER})) @${QueryCaptureName.CLASS}`,
    // Same reasoning as typescript.ts: none of these 6 alternatives need a `name:` field (binding
    // names are resolved after extraction by resolveCallableName()), so a bare node-type capture
    // is equivalent to the old per-type descendantsOfType fallback while running one native query
    // pass instead of 6 JS-side tree walks.
    functions: `(${LanguageNodeTypes.FUNCTION_DECLARATION}) @${QueryCaptureName.FUNCTION} (${LanguageNodeTypes.METHOD_DEFINITION}) @${QueryCaptureName.FUNCTION} (${LanguageNodeTypes.ARROW_FUNCTION}) @${QueryCaptureName.FUNCTION} (${LanguageNodeTypes.FUNCTION_EXPRESSION}) @${QueryCaptureName.FUNCTION} (${LanguageNodeTypes.GENERATOR_FUNCTION_DECLARATION}) @${QueryCaptureName.FUNCTION} (${LanguageNodeTypes.GENERATOR_FUNCTION}) @${QueryCaptureName.FUNCTION}`,
    imports: `(${LanguageNodeTypes.IMPORT_STATEMENT}) @${QueryCaptureName.IMPORT} (${TreeSitterNodeTypes.EXPORT_STATEMENT} source: (string)) @${QueryCaptureName.IMPORT}`,
    // Same reasoning as typescript.ts's variables query (issue #192 gap 1).
    variables: `(export_statement declaration: (lexical_declaration (variable_declarator name: (${LanguageNodeTypes.IDENTIFIER})) @${QueryCaptureName.VARIABLE}))`,
    calls: `(${LanguageNodeTypes.CALL_EXPRESSION} function: [(${LanguageNodeTypes.IDENTIFIER}) (${LanguageNodeTypes.MEMBER_EXPRESSION})] @${QueryCaptureName.CALL})`,
    extends: `(${LanguageNodeTypes.CLASS_HERITAGE} "extends" (_) @${QueryCaptureName.EXTENDS})`,
  },
};
