import {
  isSupportedSourceFile as isSupportedSourceFileFromContracts,
  detectLanguageForFile as detectLanguageForFileFromContracts,
  getSupportedGlobExtensions as getSupportedGlobExtensionsFromContracts,
  RUBY_EXTENSIONLESS_BASENAMES,
  isDiscoverableSourceFile as isDiscoverableSourceFileFromContracts,
} from "@workspace/contracts";

// Re-export the canonical implementations from @workspace/contracts so existing
// importers within lib/core keep working. The source of truth now lives in
// contracts — this module is a backward-compatibility shim only.
export {
  RUBY_EXTENSIONLESS_BASENAMES,
  isSupportedSourceFileFromContracts as isSupportedSourceFile,
  detectLanguageForFileFromContracts as detectLanguageForFile,
  getSupportedGlobExtensionsFromContracts as getSupportedGlobExtensions,
  isDiscoverableSourceFileFromContracts as isDiscoverableSourceFile,
};
