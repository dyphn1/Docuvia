/**
 * Tree-sitter node `.type` discriminants used by this package's per-language
 * `LanguageConfig` definitions (`imports`/`classes`/`functions`/`calls`/etc.
 * arrays and their paired query patterns) — grammar-level values, not ours to
 * rename. Mirrors the convention in
 * `lib/ast-core/src/constants/tree-sitter-node-types.ts`, which is internal
 * to that package and not part of its public exports, so this package keeps
 * its own copy rather than importing across the package boundary.
 */
export const LanguageNodeTypes = {
  // Shared across languages
  IDENTIFIER: "identifier",
  TYPE_IDENTIFIER: "type_identifier",
  CALL: "call",
  CALL_EXPRESSION: "call_expression",
  CLASS_DECLARATION: "class_declaration",
  INTERFACE_DECLARATION: "interface_declaration",
  ENUM_DECLARATION: "enum_declaration",
  METHOD_DECLARATION: "method_declaration",
  METHOD_DEFINITION: "method_definition",
  FUNCTION_DECLARATION: "function_declaration",
  FUNCTION_DEFINITION: "function_definition",
  ARROW_FUNCTION: "arrow_function",
  MEMBER_EXPRESSION: "member_expression",
  IMPORT_STATEMENT: "import_statement",
  IMPORT_DECLARATION: "import_declaration",
  USE_DECLARATION: "use_declaration",
  ATTRIBUTE: "attribute",
  // C / C++
  STRUCT_SPECIFIER: "struct_specifier",
  ENUM_SPECIFIER: "enum_specifier",
  UNION_SPECIFIER: "union_specifier",
  TYPE_DEFINITION: "type_definition",
  FUNCTION_DECLARATOR: "function_declarator",
  CLASS_SPECIFIER: "class_specifier",
  FIELD_EXPRESSION: "field_expression",
  PREPROC_INCLUDE: "preproc_include",
  USING_DECLARATION: "using_declaration",
  // C#
  STRUCT_DECLARATION: "struct_declaration",
  RECORD_DECLARATION: "record_declaration",
  CONSTRUCTOR_DECLARATION: "constructor_declaration",
  DESTRUCTOR_DECLARATION: "destructor_declaration",
  CONVERSION_OPERATOR_DECLARATION: "conversion_operator_declaration",
  OPERATOR_DECLARATION: "operator_declaration",
  LOCAL_FUNCTION_STATEMENT: "local_function_statement",
  USING_DIRECTIVE: "using_directive",
  INVOCATION_EXPRESSION: "invocation_expression",
  OBJECT_CREATION_EXPRESSION: "object_creation_expression",
  // Go
  TYPE_DECLARATION: "type_declaration",
  FIELD_IDENTIFIER: "field_identifier",
  SELECTOR_EXPRESSION: "selector_expression",
  // Java
  ANNOTATION_TYPE_DECLARATION: "annotation_type_declaration",
  COMPACT_CONSTRUCTOR_DECLARATION: "compact_constructor_declaration",
  METHOD_INVOCATION: "method_invocation",
  EXPLICIT_CONSTRUCTOR_INVOCATION: "explicit_constructor_invocation",
  // JavaScript / TypeScript
  GENERATOR_FUNCTION_DECLARATION: "generator_function_declaration",
  GENERATOR_FUNCTION: "generator_function",
  FUNCTION_EXPRESSION: "function_expression",
  PROPERTY_IDENTIFIER: "property_identifier",
  IMPLEMENTS_CLAUSE: "implements_clause",
  EXTENDS_CLAUSE: "extends_clause",
  TYPE_ALIAS_DECLARATION: "type_alias_declaration",
  // PHP
  NAMESPACE_USE_DECLARATION: "namespace_use_declaration",
  INCLUDE_EXPRESSION: "include_expression",
  INCLUDE_ONCE_EXPRESSION: "include_once_expression",
  REQUIRE_EXPRESSION: "require_expression",
  REQUIRE_ONCE_EXPRESSION: "require_once_expression",
  TRAIT_DECLARATION: "trait_declaration",
  FUNCTION_CALL_EXPRESSION: "function_call_expression",
  MEMBER_CALL_EXPRESSION: "member_call_expression",
  SCOPED_CALL_EXPRESSION: "scoped_call_expression",
  NAME: "name",
  // Python
  IMPORT_FROM_STATEMENT: "import_from_statement",
  CLASS_DEFINITION: "class_definition",
  // Ruby
  CLASS: "class",
  MODULE: "module",
  SINGLETON_CLASS: "singleton_class",
  METHOD: "method",
  SINGLETON_METHOD: "singleton_method",
  COMMAND_CALL: "command_call",
  CONSTANT: "constant",
  SCOPE: "scope",
  // Rust
  STRUCT_ITEM: "struct_item",
  ENUM_ITEM: "enum_item",
  UNION_ITEM: "union_item",
  TRAIT_ITEM: "trait_item",
  FUNCTION_ITEM: "function_item",
} as const;
