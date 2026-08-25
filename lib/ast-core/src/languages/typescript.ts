import type { LanguageConfig } from "../language-provider.js";
import { QueryCaptureName } from "../constants/query-capture-names.js";
import { LanguageNodeTypes } from "../constants/language-node-types.js";
import { TreeSitterNodeTypes } from "../constants/tree-sitter-node-types.js";
import { TYPESCRIPT_EXTENSIONS } from "@workspace/contracts";
const TYPESCRIPT_WASM_FILE = "tree-sitter-typescript.wasm";

export const typescriptConfig: LanguageConfig = {
  extensions: TYPESCRIPT_EXTENSIONS,
  wasm_file: TYPESCRIPT_WASM_FILE,
  // Mirrors the `imports` query below: both an `import_statement` and a re-exporting
  // `export ... from` are dependency-bearing. Kept in sync deliberately -- when the query
  // fails to compile, extractNodes() silently falls back to this list, and a list narrower
  // than the query turns that failure into missing edges rather than an error (issue #192
  // follow-up).
  imports: [
    LanguageNodeTypes.IMPORT_STATEMENT,
    TreeSitterNodeTypes.EXPORT_STATEMENT,
  ],
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
    // Unlike `classes` above, none of these 6 alternatives require a `name:` field — arrow
    // functions and function expressions have no queryable name of their own, and their binding
    // name is resolved separately by resolveCallableName() walking up to an enclosing declarator
    // *after* extraction either way (ast-worker.ts), so a bare node-type capture loses nothing
    // versus the old per-type descendantsOfType fallback while replacing 6 full JS-side tree
    // walks with a single native query pass (docs/cli-test-analysis/typescript-cli-benchmark.md,
    // Open Findings §3).
    functions: `(${LanguageNodeTypes.FUNCTION_DECLARATION}) @${QueryCaptureName.FUNCTION} (${LanguageNodeTypes.METHOD_DEFINITION}) @${QueryCaptureName.FUNCTION} (${LanguageNodeTypes.ARROW_FUNCTION}) @${QueryCaptureName.FUNCTION} (${LanguageNodeTypes.FUNCTION_EXPRESSION}) @${QueryCaptureName.FUNCTION} (${LanguageNodeTypes.GENERATOR_FUNCTION_DECLARATION}) @${QueryCaptureName.FUNCTION} (${LanguageNodeTypes.GENERATOR_FUNCTION}) @${QueryCaptureName.FUNCTION}`,
    imports: `(${LanguageNodeTypes.IMPORT_STATEMENT}) @${QueryCaptureName.IMPORT} (${TreeSitterNodeTypes.EXPORT_STATEMENT} source: (string)) @${QueryCaptureName.IMPORT}`,
    // Issue #192 gap 1: exported `const X = ...` declarations become indexable symbols so
    // `impact <constName>` resolves. Captures the variable_declarator (not the whole export
    // statement) since that's where the name field lives; arrow-function/function-expression
    // initializers are filtered out in ast-worker's collectVariableNodes because they're
    // already indexed as functions via the `functions` query above.
    variables: `(export_statement declaration: (lexical_declaration (variable_declarator name: (${LanguageNodeTypes.IDENTIFIER})) @${QueryCaptureName.VARIABLE}))`,
    calls: `(${LanguageNodeTypes.CALL_EXPRESSION} function: [(${LanguageNodeTypes.IDENTIFIER}) (${LanguageNodeTypes.MEMBER_EXPRESSION})] @${QueryCaptureName.CALL})`,
    implements: `(${LanguageNodeTypes.IMPLEMENTS_CLAUSE} (_) @${QueryCaptureName.IMPLEMENTS})`,
    extends: `(${LanguageNodeTypes.EXTENDS_CLAUSE} value: (_) @${QueryCaptureName.EXTENDS})`,
  },
};
