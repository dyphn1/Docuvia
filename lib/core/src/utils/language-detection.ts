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

/** Returns the DEFAULT_REGISTRY language name for a file (e.g. "typescript"), or undefined. */
export function detectLanguageForFile(filePath: string): SupportedLanguage | undefined {
  return EXT_TO_LANGUAGE.get(path.extname(filePath).toLowerCase());
}

/** True if the AST layer (LanguageRegistry) recognizes this file's extension at all. */
export function isSupportedSourceFile(filePath: string): boolean {
  return EXT_TO_LANGUAGE.has(path.extname(filePath).toLowerCase());
}

/** Extensions with the leading dot stripped, for building fast-glob brace patterns. */
export function getSupportedGlobExtensions(): string[] {
  return Array.from(EXT_TO_LANGUAGE.keys()).map((ext) => ext.replace(/^\./, ""));
}
