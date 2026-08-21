import path from "path";
import { SUPPORTED_LANGUAGES } from "./languages.js";
import type { SupportedLanguage } from "./languages.js";

// ---------------------------------------------------------------------------
// Per-language extension arrays — the canonical definitions.  These were
// previously scattered across lib/ast-core/src/languages/*.ts; moving them
// here means there is ONE list to maintain and every layer derives from it.
// ---------------------------------------------------------------------------

export const TYPESCRIPT_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts"];
export const JAVASCRIPT_EXTENSIONS = [".js", ".jsx", ".mjs", ".cjs"];
export const PYTHON_EXTENSIONS = [".py"];
export const RUST_EXTENSIONS = [".rs"];
export const GO_EXTENSIONS = [".go"];
export const JAVA_EXTENSIONS = [".java"];
export const C_EXTENSIONS = [".c", ".h"];
export const CPP_EXTENSIONS = [
  ".cpp",
  ".cxx",
  ".cc",
  ".hpp",
  ".hxx",
  ".hh",
  ".cu",
  ".cuh",
];
export const RUBY_EXTENSIONS = [".rb", ".rake", ".gemspec"];
export const PHP_EXTENSIONS = [".php", ".phtml", ".php3", ".php4", ".php5", ".phps"];
export const CSHARP_EXTENSIONS = [".cs"];

/**
 * Ruby project files that conventionally carry no extension.  `path.extname()`
 * can never match these, so they need an explicit basename allowlist.
 */
export const RUBY_EXTENSIONLESS_BASENAMES = new Set([
  "Rakefile",
  "Gemfile",
  "Guardfile",
  "Vagrantfile",
  "Brewfile",
]);

// ---------------------------------------------------------------------------
// Derived extension → language map (single source of truth, not hand-copied)
// ---------------------------------------------------------------------------

const EXT_TO_LANGUAGE: Map<string, SupportedLanguage> = (() => {
  const map = new Map<string, SupportedLanguage>();
  const entries: [SupportedLanguage, string[]][] = [
    [SUPPORTED_LANGUAGES.TYPESCRIPT, TYPESCRIPT_EXTENSIONS],
    [SUPPORTED_LANGUAGES.JAVASCRIPT, JAVASCRIPT_EXTENSIONS],
    [SUPPORTED_LANGUAGES.PYTHON, PYTHON_EXTENSIONS],
    [SUPPORTED_LANGUAGES.RUST, RUST_EXTENSIONS],
    [SUPPORTED_LANGUAGES.GO, GO_EXTENSIONS],
    [SUPPORTED_LANGUAGES.JAVA, JAVA_EXTENSIONS],
    [SUPPORTED_LANGUAGES.C, C_EXTENSIONS],
    [SUPPORTED_LANGUAGES.CPP, CPP_EXTENSIONS],
    [SUPPORTED_LANGUAGES.RUBY, RUBY_EXTENSIONS],
    [SUPPORTED_LANGUAGES.PHP, PHP_EXTENSIONS],
    [SUPPORTED_LANGUAGES.CSHARP, CSHARP_EXTENSIONS],
  ];
  for (const [languageName, extensions] of entries) {
    for (const ext of extensions) map.set(ext, languageName);
  }
  return map;
})();

/**
 * Returns the language name for a file (e.g. `"typescript"`), or `undefined`
 * if the file's extension (or basename) is not recognised.
 */
export function detectLanguageForFile(
  filePath: string,
): SupportedLanguage | undefined {
  const byExt = EXT_TO_LANGUAGE.get(path.extname(filePath).toLowerCase());
  if (byExt) return byExt;
  return RUBY_EXTENSIONLESS_BASENAMES.has(path.basename(filePath))
    ? SUPPORTED_LANGUAGES.RUBY
    : undefined;
}

/**
 * `true` when the AST layer recognises this file's extension (or basename) —
 * i.e. the file *can* be parsed.  Uses `path.basename()` for cross-platform
 * correctness (the previous implementation in core used `lastIndexOf("/")`
 * which broke on Windows backslash paths).
 */
export function isSupportedSourceFile(filePath: string): boolean {
  if (EXT_TO_LANGUAGE.has(path.extname(filePath).toLowerCase())) return true;
  return RUBY_EXTENSIONLESS_BASENAMES.has(path.basename(filePath));
}

/**
 * Extensions with the leading dot stripped, for building fast-glob brace
 * patterns.
 */
export function getSupportedGlobExtensions(): string[] {
  return Array.from(EXT_TO_LANGUAGE.keys()).map((ext) =>
    ext.replace(/^\./, ""),
  );
}
