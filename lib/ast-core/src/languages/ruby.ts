import type { LanguageConfig } from "../language-provider.js";
import { QueryCaptureName } from "../constants/query-capture-names.js";
import { LanguageNodeTypes } from "../constants/language-node-types.js";
import { RUBY_EXTENSIONS } from "@workspace/contracts";
const RUBY_WASM_FILE = "tree-sitter-ruby.wasm";

export const rubyConfig: LanguageConfig = {
  extensions: RUBY_EXTENSIONS,
  wasm_file: RUBY_WASM_FILE,
  imports: [LanguageNodeTypes.CALL], // Ruby has no import statements; require/load are method calls
  classes: [
    LanguageNodeTypes.CLASS,
    LanguageNodeTypes.MODULE,
    LanguageNodeTypes.SINGLETON_CLASS,
  ],
  functions: [LanguageNodeTypes.METHOD, LanguageNodeTypes.SINGLETON_METHOD],
  // This grammar has no separate "command_call" node — receiver-based unparenthesized calls
  // (`obj.method arg`) parse as plain `call` nodes too, same as `obj.method(arg)`.
  calls: [LanguageNodeTypes.CALL],
  // Only the `class Derived < Base` form is captured here — `include`/`extend`/`prepend`
  // mixins are plain method calls in this grammar, not a distinct node type, so they still
  // fall through as generic `calls` edges rather than `extends`.
  extends: [LanguageNodeTypes.SUPERCLASS],
  queries: {
    classes: `(${LanguageNodeTypes.CLASS} name: [(${LanguageNodeTypes.CONSTANT}) (${LanguageNodeTypes.SCOPE_RESOLUTION})]) @${QueryCaptureName.CLASS} (${LanguageNodeTypes.MODULE} name: (${LanguageNodeTypes.CONSTANT})) @${QueryCaptureName.CLASS} (${LanguageNodeTypes.SINGLETON_CLASS}) @${QueryCaptureName.CLASS}`,
    functions: `(${LanguageNodeTypes.METHOD} name: (${LanguageNodeTypes.IDENTIFIER})) @${QueryCaptureName.FUNCTION} (${LanguageNodeTypes.SINGLETON_METHOD} name: (${LanguageNodeTypes.IDENTIFIER})) @${QueryCaptureName.FUNCTION}`,
    // Predicates must live inside the same top-level pattern group as the capture they
    // filter (`(#match? @_method ...)` as a trailing sibling of the pattern, not a chained
    // JS-style method call) — the old `@_method.match?(...)` syntax was never valid tree-sitter
    // query syntax and made this pattern fail to compile.
    imports: `((${LanguageNodeTypes.CALL} method: (${LanguageNodeTypes.IDENTIFIER}) @_method) @${QueryCaptureName.IMPORT} (#match? @_method "^(require|require_relative|load)$"))`,
    calls: `(${LanguageNodeTypes.CALL} method: (${LanguageNodeTypes.IDENTIFIER}) @${QueryCaptureName.CALL})`,
    extends: `(${LanguageNodeTypes.SUPERCLASS} (_) @${QueryCaptureName.EXTENDS})`,
  },
};
