/** C#'s Tier B LSP provider --
 *  `csharp-ls`, resolved via the PATH-native strategy
 *  (`resolvePathNativeBinary`, `lsp-binary-resolver-strategies.ts`).
 */
export const CsharpLspConstants = {
  BINARY_NAME: "csharp-ls",
  DEFAULT_ARGS: [] as string[],
  VERSION_FLAG: "--version",
} as const;

export const CSHARP_LSP_MESSAGES = {
  binaryUnresolvable:
    "csharp-ls is not resolvable (not found on PATH or ~/.dotnet/tools) -- install it with `dotnet tool install --global csharp-ls` to enable LSP-precision cross-file edges for C#",
  markerFileMissing:
    "no solution (.sln/.slnx) or project file (*.csproj) found at the workspace root",
} as const;
