/** C/C++'s Tier B LSP provider --
 *  `clangd`, resolved via the PATH-native strategy
 *  (`resolvePathNativeBinary`, `lsp-binary-resolver-strategies.ts`).
 */
export const CppLspConstants = {
  BINARY_NAME: "clangd",
  DEFAULT_ARGS: [] as string[],
  VERSION_FLAG: "--version",
} as const;

export const CPP_LSP_MESSAGES = {
  binaryUnresolvable:
    "clangd is not resolvable (not found on PATH) -- install clangd to enable LSP-precision cross-file edges for C/C++",
  markerFileMissing:
    "no compile_commands.json/CMakeLists.txt found at the workspace root",
} as const;
