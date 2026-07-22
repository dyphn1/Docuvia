/** Java's Tier B LSP provider --
 *  `jdtls`, resolved via the PATH-native strategy
 *  (`resolvePathNativeBinary`, `lsp-binary-resolver-strategies.ts`).
 */
export const JavaLspConstants = {
  BINARY_NAME: "jdtls",
  DEFAULT_ARGS: [] as string[],
  VERSION_FLAG: "--version",
} as const;

export const JAVA_LSP_MESSAGES = {
  binaryUnresolvable:
    "jdtls is not resolvable (not found on PATH) -- install jdtls to enable LSP-precision cross-file edges for Java",
  markerFileMissing:
    "no pom.xml/build.gradle found at the workspace root",
} as const;
