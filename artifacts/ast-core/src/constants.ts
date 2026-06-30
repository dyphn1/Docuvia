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

export type SupportedLanguage = typeof SUPPORTED_LANGUAGES[keyof typeof SUPPORTED_LANGUAGES];
