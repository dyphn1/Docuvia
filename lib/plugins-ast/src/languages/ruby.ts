import type { LanguageConfig } from "@workspace/ast-core";

export const rubyConfig: LanguageConfig = {
  extensions: [".rb", ".rake", ".gemspec"],
  wasm_file: "tree-sitter-ruby.wasm",
  imports: ["call"], // Ruby has no import statements; require/load are method calls
  classes: ["class", "module", "singleton_class"],
  functions: ["method", "singleton_method"],
  calls: ["call", "command_call"],
  queries: {
    classes: `(class name: [(constant) (scope)] @class) (module name: (constant) @class) (singleton_class) @class`,
    functions: `(method name: (identifier) @function) (singleton_method name: (identifier) @function)`,
    imports: `(call method: (identifier) @_method @_method.match?(/^(require|require_relative|load)$/) @import)`,
    calls: `(call method: (identifier) @call) (command_call method: (identifier) @call)`,
  },
};
