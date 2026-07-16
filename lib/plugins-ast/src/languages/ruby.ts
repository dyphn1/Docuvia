import type { LanguageConfig } from "@workspace/ast-core";
import { QueryCaptureName } from "../constants/query-capture-names.js";

const RUBY_EXTENSIONS = [".rb", ".rake", ".gemspec"];
const RUBY_WASM_FILE = "tree-sitter-ruby.wasm";

export const rubyConfig: LanguageConfig = {
  extensions: RUBY_EXTENSIONS,
  wasm_file: RUBY_WASM_FILE,
  imports: ["call"], // Ruby has no import statements; require/load are method calls
  classes: ["class", "module", "singleton_class"],
  functions: ["method", "singleton_method"],
  calls: ["call", "command_call"],
  queries: {
    classes: `(class name: [(constant) (scope)] @${QueryCaptureName.CLASS}) (module name: (constant) @${QueryCaptureName.CLASS}) (singleton_class) @${QueryCaptureName.CLASS}`,
    functions: `(method name: (identifier) @${QueryCaptureName.FUNCTION}) (singleton_method name: (identifier) @${QueryCaptureName.FUNCTION})`,
    imports: `(call method: (identifier) @_method @_method.match?(/^(require|require_relative|load)$/) @${QueryCaptureName.IMPORT})`,
    calls: `(call method: (identifier) @${QueryCaptureName.CALL}) (command_call method: (identifier) @${QueryCaptureName.CALL})`,
  },
};
