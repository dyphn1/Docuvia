import type { LanguageConfig } from "@workspace/ast-core";
import { QueryCaptureName } from "../constants/query-capture-names.js";

const PYTHON_EXTENSIONS = [".py"];
const PYTHON_WASM_FILE = "tree-sitter-python.wasm";

export const pythonConfig: LanguageConfig = {
  extensions: PYTHON_EXTENSIONS,
  wasm_file: PYTHON_WASM_FILE,
  imports: ["import_statement", "import_from_statement"],
  classes: ["class_definition"],
  functions: ["function_definition"],
  calls: ["call"],
  queries: {
    classes: `(class_definition name: (identifier) @${QueryCaptureName.CLASS})`,
    functions: `(function_definition name: (identifier) @${QueryCaptureName.FUNCTION})`,
    imports: `(import_statement) @${QueryCaptureName.IMPORT} (import_from_statement) @${QueryCaptureName.IMPORT}`,
    calls: `(call function: [(identifier) (attribute)] @${QueryCaptureName.CALL})`,
  },
};
