import type { LanguageConfig } from "@workspace/ast-core";
import { QueryCaptureName } from "../constants/query-capture-names.js";

const CPP_EXTENSIONS = [
  ".cpp",
  ".cxx",
  ".cc",
  ".hpp",
  ".hxx",
  ".hh",
  ".cu",
  ".cuh",
];
const CPP_WASM_FILE = "tree-sitter-cpp.wasm";

export const cppConfig: LanguageConfig = {
  extensions: CPP_EXTENSIONS,
  wasm_file: CPP_WASM_FILE,
  imports: ["preproc_include", "using_declaration"],
  classes: [
    "class_specifier",
    "struct_specifier",
    "enum_specifier",
    "union_specifier",
    "type_definition",
  ],
  functions: ["function_definition"],
  calls: ["call_expression"],
  queries: {
    classes: `(class_specifier name: (type_identifier) @${QueryCaptureName.CLASS}) (struct_specifier name: (type_identifier) @${QueryCaptureName.CLASS}) (enum_specifier name: (type_identifier) @${QueryCaptureName.CLASS}) (union_specifier name: (type_identifier) @${QueryCaptureName.CLASS}) (type_definition name: (type_identifier) @${QueryCaptureName.CLASS})`,
    functions: `(function_definition declarator: (function_declarator declarator: (identifier) @${QueryCaptureName.FUNCTION}))`,
    imports: `(preproc_include) @${QueryCaptureName.IMPORT} (using_declaration) @${QueryCaptureName.IMPORT}`,
    calls: `(call_expression function: [(identifier) (field_expression)] @${QueryCaptureName.CALL})`,
  },
};
