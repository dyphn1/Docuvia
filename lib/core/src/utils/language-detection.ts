import {
  DOCUVIA_DIR_NAME,
  NODE_MODULES_DIR_NAME,
  isSupportedSourceFile as isSupportedSourceFileFromContracts,
  detectLanguageForFile as detectLanguageForFileFromContracts,
  getSupportedGlobExtensions as getSupportedGlobExtensionsFromContracts,
  RUBY_EXTENSIONLESS_BASENAMES,
} from "@workspace/contracts";

// Re-export the canonical implementations from @workspace/contracts so existing
// importers within lib/core keep working.  The source of truth now lives in
// contracts — this module is a backward-compatibility shim only.
export {
  RUBY_EXTENSIONLESS_BASENAMES,
  isSupportedSourceFileFromContracts as isSupportedSourceFile,
  detectLanguageForFileFromContracts as detectLanguageForFile,
  getSupportedGlobExtensionsFromContracts as getSupportedGlobExtensions,
};

/**
 * `FileDiscoveryService.discoverFiles()`'s post-glob/post-git-list filter, extracted so
 * `analyze` auto mode's delta ingestion (phase1-decision-integration.md §6b) can apply the exact
 * same ignore rule to a git-diff-derived file list without duplicating it — "filtered by the
 * SAME discovery ignore/oversize rules `init` uses" per the spec. `discoverFiles()` itself is
 * refactored to call this too, so there is exactly one place this rule lives.
 */
export function isDiscoverableSourceFile(filePath: string): boolean {
  return (
    isSupportedSourceFileFromContracts(filePath) &&
    !filePath.includes(`${NODE_MODULES_DIR_NAME}/`) &&
    !filePath.includes(`${DOCUVIA_DIR_NAME}/`)
  );
}
