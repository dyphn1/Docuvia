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
  ABSTRACT_CLASS_DECLARATION: "abstract_class_declaration",
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
  BASE_LIST: "base_list",
  // Go
  TYPE_DECLARATION: "type_declaration",
  TYPE_SPEC: "type_spec",
  FIELD_IDENTIFIER: "field_identifier",
  SELECTOR_EXPRESSION: "selector_expression",
  // Java
  ANNOTATION_TYPE_DECLARATION: "annotation_type_declaration",
  COMPACT_CONSTRUCTOR_DECLARATION: "compact_constructor_declaration",
  METHOD_INVOCATION: "method_invocation",
  EXPLICIT_CONSTRUCTOR_INVOCATION: "explicit_constructor_invocation",
  SUPERCLASS: "superclass",
  SUPER_INTERFACES: "super_interfaces",
  TYPE_LIST: "type_list",
  // JavaScript / TypeScript
  GENERATOR_FUNCTION_DECLARATION: "generator_function_declaration",
  GENERATOR_FUNCTION: "generator_function",
  FUNCTION_EXPRESSION: "function_expression",
  PROPERTY_IDENTIFIER: "property_identifier",
  IMPLEMENTS_CLAUSE: "implements_clause",
  EXTENDS_CLAUSE: "extends_clause",
  TYPE_ALIAS_DECLARATION: "type_alias_declaration",
  CLASS_HERITAGE: "class_heritage",
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
  BASE_CLAUSE: "base_clause",
  CLASS_INTERFACE_CLAUSE: "class_interface_clause",
  // Python
  IMPORT_FROM_STATEMENT: "import_from_statement",
  CLASS_DEFINITION: "class_definition",
  ARGUMENT_LIST: "argument_list",
  // Ruby
  CLASS: "class",
  MODULE: "module",
  SINGLETON_CLASS: "singleton_class",
  METHOD: "method",
  SINGLETON_METHOD: "singleton_method",
  CONSTANT: "constant",
  SCOPE_RESOLUTION: "scope_resolution",
  // C++
  BASE_CLASS_CLAUSE: "base_class_clause",
  QUALIFIED_IDENTIFIER: "qualified_identifier",
  // Rust
  STRUCT_ITEM: "struct_item",
  ENUM_ITEM: "enum_item",
  UNION_ITEM: "union_item",
  TRAIT_ITEM: "trait_item",
  FUNCTION_ITEM: "function_item",
} as const;
