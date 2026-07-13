import path from "path";
import { DEFAULT_REGISTRY } from "@workspace/plugins-ast";
import type { LanguageConfig, SupportedLanguage } from "@workspace/ast-core";

const EXT_TO_LANGUAGE: Map<string, SupportedLanguage> = (() => {
  const map = new Map<string, SupportedLanguage>();
  const entries = Object.entries(DEFAULT_REGISTRY.languages) as [
    SupportedLanguage,
    LanguageConfig,
  ][];
  for (const [languageName, config] of entries) {
    for (const ext of config.extensions) map.set(ext, languageName);
  }
  return map;
})();

/**
 * Ruby project files that conventionally carry no extension (mirrors GitNexus's own
 * RUBY_EXTENSIONLESS_FILES set). `path.extname()`-based detection can never match these,
 * so they need an explicit basename allowlist.
 */
export const RUBY_EXTENSIONLESS_BASENAMES = new Set([
  "Rakefile",
  "Gemfile",
  "Guardfile",
  "Vagrantfile",
  "Brewfile",
]);

/** Returns the DEFAULT_REGISTRY language name for a file (e.g. "typescript"), or undefined. */
export function detectLanguageForFile(
  filePath: string,
): SupportedLanguage | undefined {
  const byExt = EXT_TO_LANGUAGE.get(path.extname(filePath).toLowerCase());
  if (byExt) return byExt;
  return RUBY_EXTENSIONLESS_BASENAMES.has(path.basename(filePath))
    ? "ruby"
    : undefined;
}

/** True if the AST layer (LanguageRegistry) recognizes this file's extension at all. */
export function isSupportedSourceFile(filePath: string): boolean {
  if (EXT_TO_LANGUAGE.has(path.extname(filePath).toLowerCase())) return true;
  return RUBY_EXTENSIONLESS_BASENAMES.has(path.basename(filePath));
}

/** Extensions with the leading dot stripped, for building fast-glob brace patterns. */
export function getSupportedGlobExtensions(): string[] {
  return Array.from(EXT_TO_LANGUAGE.keys()).map((ext) =>
    ext.replace(/^\./, ""),
  );
}
