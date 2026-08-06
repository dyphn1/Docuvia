/** PHP's Tier B LSP provider --
 *  `intelephense`, resolved via the npm/npx strategy
 *  (`resolveNpmNpxBinary`, `lsp-binary-resolver-strategies.ts`).
 */
export const PhpLspConstants = {
  PACKAGE_NAME: "intelephense",
  NPX_COMMAND: "npx",
  NPX_NO_INSTALL_FLAG: "--no-install",
  STDIO_ARG: "--stdio",
  VERSION_FLAG: "--version",
} as const;

export const PHP_LSP_MESSAGES = {
  binaryUnresolvable:
    "intelephense is not resolvable (no local node_modules/.bin copy and `npx --no-install` cannot find intelephense) -- install intelephense as a project devDependency (`npm install -D intelephense`) to enable LSP-precision cross-file edges for PHP",
  markerFileMissing: "no composer.json found at the workspace root",
} as const;
