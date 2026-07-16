import type { LanguageConfig } from "@workspace/ast-core";
import { QueryCaptureName } from "../constants/query-capture-names.js";

const TYPESCRIPT_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts"];
const TYPESCRIPT_WASM_FILE = "tree-sitter-typescript.wasm";

export const typescriptConfig: LanguageConfig = {
  extensions: TYPESCRIPT_EXTENSIONS,
  wasm_file: TYPESCRIPT_WASM_FILE,
  imports: ["import_statement"],
  classes: [
    "class_declaration",
    "interface_declaration",
    "enum_declaration",
    "type_alias_declaration",
  ],
  functions: [
    "function_declaration",
    "method_definition",
    "arrow_function",
    "function_expression",
    "generator_function_declaration",
    "generator_function",
  ],
  calls: ["call_expression"],
  implements: ["implements_clause"],
  extends: ["extends_clause"],
  queries: {
    classes: `(class_declaration name: (identifier) @${QueryCaptureName.CLASS}) (interface_declaration name: (type_identifier) @${QueryCaptureName.CLASS}) (enum_declaration name: (identifier) @${QueryCaptureName.CLASS}) (type_alias_declaration name: (type_identifier) @${QueryCaptureName.CLASS})`,
    functions: `(function_declaration name: (identifier) @${QueryCaptureName.FUNCTION}) (method_definition name: (property_identifier) @${QueryCaptureName.FUNCTION})`, // arrow/expression forms handled outside queries — see resolveCallableName() in ast-worker.ts, they have no queryable "name" field
    imports: `(import_statement) @${QueryCaptureName.IMPORT}`,
    calls: `(call_expression function: [(identifier) (member_expression)] @${QueryCaptureName.CALL})`,
    implements: `(implements_clause (_) @${QueryCaptureName.IMPLEMENTS})`,
    extends: `(extends_clause value: (_) @${QueryCaptureName.EXTENDS})`,
  },
};
