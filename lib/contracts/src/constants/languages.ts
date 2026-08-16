/**
 * The set of languages the AST layer can parse, shared across the whole workspace
 * (Virtual Contracts §8 — shared definitions must live in contracts). Moved here from
 * `lib/ast-core` so `lib/core` / `lib/plugins-ast` can reference the supported-language
 * set without importing the tree-sitter tech-provider package for a plain constant.
 *
 * `SupportedLanguage` is the string-literal union over the keys — values are stable
 * identifiers persisted in the graph (`l2_nodes.language`), not display names.
 */
export const SUPPORTED_LANGUAGES = {
  TYPESCRIPT: "typescript",
  JAVASCRIPT: "javascript",
  PYTHON: "python",
  RUST: "rust",
  GO: "go",
  JAVA: "java",
  C: "c",
  CPP: "cpp",
  RUBY: "ruby",
  PHP: "php",
  CSHARP: "csharp",
} as const;

export type SupportedLanguage =
  (typeof SUPPORTED_LANGUAGES)[keyof typeof SUPPORTED_LANGUAGES];
