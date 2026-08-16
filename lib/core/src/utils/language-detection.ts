import path from "path";
import { DEFAULT_REGISTRY, type LanguageConfig } from "@workspace/ast-core";
import {
  DOCUVIA_DIR_NAME,
  NODE_MODULES_DIR_NAME,
  SUPPORTED_LANGUAGES,
  type SupportedLanguage,
} from "@workspace/contracts";

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
    ? SUPPORTED_LANGUAGES.RUBY
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

/**
 * `FileDiscoveryService.discoverFiles()`'s post-glob/post-git-list filter, extracted so
 * `analyze` auto mode's delta ingestion (phase1-decision-integration.md §6b) can apply the exact
 * same ignore rule to a git-diff-derived file list without duplicating it — "filtered by the
 * SAME discovery ignore/oversize rules `init` uses" per the spec. `discoverFiles()` itself is
 * refactored to call this too, so there is exactly one place this rule lives.
 */
export function isDiscoverableSourceFile(filePath: string): boolean {
  return (
    isSupportedSourceFile(filePath) &&
    !filePath.includes(`${NODE_MODULES_DIR_NAME}/`) &&
    !filePath.includes(`${DOCUVIA_DIR_NAME}/`)
  );
}
