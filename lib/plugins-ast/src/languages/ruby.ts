import type { LanguageConfig } from "@workspace/ast-core";
import { QueryCaptureName } from "../constants/query-capture-names.js";
import { LanguageNodeTypes } from "../constants/tree-sitter-node-types.js";

const RUBY_EXTENSIONS = [".rb", ".rake", ".gemspec"];
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
  calls: [LanguageNodeTypes.CALL, LanguageNodeTypes.COMMAND_CALL],
  queries: {
    classes: `(${LanguageNodeTypes.CLASS} name: [(${LanguageNodeTypes.CONSTANT}) (${LanguageNodeTypes.SCOPE})] @${QueryCaptureName.CLASS}) (${LanguageNodeTypes.MODULE} name: (${LanguageNodeTypes.CONSTANT}) @${QueryCaptureName.CLASS}) (${LanguageNodeTypes.SINGLETON_CLASS}) @${QueryCaptureName.CLASS}`,
    functions: `(${LanguageNodeTypes.METHOD} name: (${LanguageNodeTypes.IDENTIFIER}) @${QueryCaptureName.FUNCTION}) (${LanguageNodeTypes.SINGLETON_METHOD} name: (${LanguageNodeTypes.IDENTIFIER}) @${QueryCaptureName.FUNCTION})`,
    imports: `(${LanguageNodeTypes.CALL} method: (${LanguageNodeTypes.IDENTIFIER}) @_method @_method.match?(/^(require|require_relative|load)$/) @${QueryCaptureName.IMPORT})`,
    calls: `(${LanguageNodeTypes.CALL} method: (${LanguageNodeTypes.IDENTIFIER}) @${QueryCaptureName.CALL}) (${LanguageNodeTypes.COMMAND_CALL} method: (${LanguageNodeTypes.IDENTIFIER}) @${QueryCaptureName.CALL})`,
  },
};
