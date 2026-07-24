import type { LanguageConfig } from "@workspace/ast-core";
import { QueryCaptureName } from "../constants/query-capture-names.js";
import { LanguageNodeTypes } from "../constants/tree-sitter-node-types.js";

const JAVASCRIPT_EXTENSIONS = [".js", ".jsx", ".mjs", ".cjs"];
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
    classes: `(${LanguageNodeTypes.CLASS_DECLARATION} name: (${LanguageNodeTypes.IDENTIFIER}) @${QueryCaptureName.CLASS})`,
    // No compiled `functions` query — same reasoning as typescript.ts: arrow functions and
    // function expressions have no queryable "name" field, so this field stays on the
    // fallback (which covers all 6 kinds in the array above) rather than compiling a query
    // restricted to function_declaration/method_definition that would silently drop them.
    imports: `(${LanguageNodeTypes.IMPORT_STATEMENT}) @${QueryCaptureName.IMPORT}`,
    calls: `(${LanguageNodeTypes.CALL_EXPRESSION} function: [(${LanguageNodeTypes.IDENTIFIER}) (${LanguageNodeTypes.MEMBER_EXPRESSION})] @${QueryCaptureName.CALL})`,
    extends: `(${LanguageNodeTypes.CLASS_HERITAGE} "extends" (_) @${QueryCaptureName.EXTENDS})`,
  },
};
