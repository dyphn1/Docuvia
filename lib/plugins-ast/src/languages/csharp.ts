import type { LanguageConfig } from "@workspace/ast-core";
import { QueryCaptureName } from "../constants/query-capture-names.js";

export const csharpConfig: LanguageConfig = {
  extensions: [".cs"],
  wasm_file: "tree-sitter-c_sharp.wasm",
  imports: ["using_directive"],
  classes: [
    "class_declaration",
    "struct_declaration",
    "interface_declaration",
    "enum_declaration",
    "record_declaration",
  ],
  functions: [
    "method_declaration",
    "constructor_declaration",
    "destructor_declaration",
    "conversion_operator_declaration",
    "operator_declaration",
    "local_function_statement",
  ],
  calls: ["invocation_expression", "object_creation_expression"],
  queries: {
    classes: `(class_declaration name: (identifier) @${QueryCaptureName.CLASS}) (struct_declaration name: (identifier) @${QueryCaptureName.CLASS}) (interface_declaration name: (identifier) @${QueryCaptureName.CLASS}) (enum_declaration name: (identifier) @${QueryCaptureName.CLASS}) (record_declaration name: (identifier) @${QueryCaptureName.CLASS})`,
    functions: `(method_declaration name: (identifier) @${QueryCaptureName.FUNCTION}) (constructor_declaration name: (identifier) @${QueryCaptureName.FUNCTION}) (destructor_declaration) @${QueryCaptureName.FUNCTION} (conversion_operator_declaration) @${QueryCaptureName.FUNCTION} (operator_declaration) @${QueryCaptureName.FUNCTION} (local_function_statement) @${QueryCaptureName.FUNCTION}`,
    imports: `(using_directive) @${QueryCaptureName.IMPORT}`,
    calls: `(invocation_expression) @${QueryCaptureName.CALL} (object_creation_expression) @${QueryCaptureName.CALL}`,
  },
};
