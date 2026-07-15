import type { LanguageConfig } from "@workspace/ast-core";
import { QueryCaptureName } from "../constants/query-capture-names.js";

export const javaConfig: LanguageConfig = {
  extensions: [".java"],
  wasm_file: "tree-sitter-java.wasm",
  imports: ["import_declaration"],
  classes: [
    "class_declaration",
    "interface_declaration",
    "enum_declaration",
    "annotation_type_declaration",
    "record_declaration",
  ],
  functions: [
    "method_declaration",
    "constructor_declaration",
    "compact_constructor_declaration",
  ],
  calls: ["method_invocation", "explicit_constructor_invocation"],
  queries: {
    classes: `(class_declaration name: (identifier) @${QueryCaptureName.CLASS}) (interface_declaration name: (identifier) @${QueryCaptureName.CLASS}) (enum_declaration name: (identifier) @${QueryCaptureName.CLASS}) (annotation_type_declaration name: (identifier) @${QueryCaptureName.CLASS}) (record_declaration name: (identifier) @${QueryCaptureName.CLASS})`,
    functions: `(method_declaration name: (identifier) @${QueryCaptureName.FUNCTION}) (constructor_declaration name: (identifier) @${QueryCaptureName.FUNCTION}) (compact_constructor_declaration name: (identifier) @${QueryCaptureName.FUNCTION})`,
    imports: `(import_declaration) @${QueryCaptureName.IMPORT}`,
    calls: `(method_invocation name: (identifier) @${QueryCaptureName.CALL}) (explicit_constructor_invocation) @${QueryCaptureName.CALL}`,
  },
};
