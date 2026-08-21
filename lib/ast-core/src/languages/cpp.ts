import type { LanguageConfig } from "../language-provider.js";
import { QueryCaptureName } from "../constants/query-capture-names.js";
import { LanguageNodeTypes } from "../constants/language-node-types.js";
import { CPP_EXTENSIONS } from "@workspace/contracts";
const CPP_WASM_FILE = "tree-sitter-cpp.wasm";

export const cppConfig: LanguageConfig = {
  extensions: CPP_EXTENSIONS,
  wasm_file: CPP_WASM_FILE,
  imports: [
    LanguageNodeTypes.PREPROC_INCLUDE,
    LanguageNodeTypes.USING_DECLARATION,
  ],
  classes: [
    LanguageNodeTypes.CLASS_SPECIFIER,
    LanguageNodeTypes.STRUCT_SPECIFIER,
    LanguageNodeTypes.ENUM_SPECIFIER,
    LanguageNodeTypes.UNION_SPECIFIER,
    LanguageNodeTypes.TYPE_DEFINITION,
  ],
  functions: [LanguageNodeTypes.FUNCTION_DEFINITION],
  calls: [LanguageNodeTypes.CALL_EXPRESSION],
  // C++ has no separate "implements" syntax — interfaces (abstract base classes) share the
  // same `base_class_clause` slot as concrete base classes, so both surface as `extends` edges.
  extends: [LanguageNodeTypes.BASE_CLASS_CLAUSE],
  queries: {
    classes: `(${LanguageNodeTypes.CLASS_SPECIFIER} name: (${LanguageNodeTypes.TYPE_IDENTIFIER})) @${QueryCaptureName.CLASS} (${LanguageNodeTypes.STRUCT_SPECIFIER} name: (${LanguageNodeTypes.TYPE_IDENTIFIER})) @${QueryCaptureName.CLASS} (${LanguageNodeTypes.ENUM_SPECIFIER} name: (${LanguageNodeTypes.TYPE_IDENTIFIER})) @${QueryCaptureName.CLASS} (${LanguageNodeTypes.UNION_SPECIFIER} name: (${LanguageNodeTypes.TYPE_IDENTIFIER})) @${QueryCaptureName.CLASS} (${LanguageNodeTypes.TYPE_DEFINITION} name: (${LanguageNodeTypes.TYPE_IDENTIFIER})) @${QueryCaptureName.CLASS}`,
    // declarator must accept `identifier` (free functions), `field_identifier` (inline class
    // methods), and `qualified_identifier` (out-of-line `Ret Class::method(){}` definitions) --
    // matching only `identifier` silently excluded every class method, inline or out-of-line
    // (GRPH-006 follow-up).
    functions: `(${LanguageNodeTypes.FUNCTION_DEFINITION} declarator: (${LanguageNodeTypes.FUNCTION_DECLARATOR} declarator: [(${LanguageNodeTypes.IDENTIFIER}) (${LanguageNodeTypes.FIELD_IDENTIFIER}) (${LanguageNodeTypes.QUALIFIED_IDENTIFIER})])) @${QueryCaptureName.FUNCTION}`,
    imports: `(${LanguageNodeTypes.PREPROC_INCLUDE}) @${QueryCaptureName.IMPORT} (${LanguageNodeTypes.USING_DECLARATION}) @${QueryCaptureName.IMPORT}`,
    calls: `(${LanguageNodeTypes.CALL_EXPRESSION} function: [(${LanguageNodeTypes.IDENTIFIER}) (${LanguageNodeTypes.FIELD_EXPRESSION})] @${QueryCaptureName.CALL})`,
    extends: `(${LanguageNodeTypes.BASE_CLASS_CLAUSE} (${LanguageNodeTypes.TYPE_IDENTIFIER}) @${QueryCaptureName.EXTENDS})`,
  },
};
