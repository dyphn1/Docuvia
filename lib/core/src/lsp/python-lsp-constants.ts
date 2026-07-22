/** Python's Tier B LSP provider (multi-language-lsp-support plan, §3 row 1) --
 *  `pyright-langserver --stdio`, resolved via the npm/npx strategy
 *  (`resolveNpmNpxBinary`, `lsp-binary-resolver-strategies.ts`) since pyright ships as an npm
 *  package -- the same resolution shape as TypeScript, just a different package/binary name.
 *
 *  Note the package/binary name split: the npm package is named `pyright`, but the actual LSP
 *  server binary it ships is `pyright-langserver` -- a distinct bin within the same package
 *  (`pyright` itself is pyright's CLI type-checker, not the LSP stdio server). Verified against
 *  the real npm registry package during this slice's implementation.
 */
export const PyLspConstants = {
  PACKAGE_NAME: "pyright",
  BINARY_NAME: "pyright-langserver",
  NPX_COMMAND: "npx",
  NPX_NO_INSTALL_FLAG: "--no-install",
  STDIO_ARG: "--stdio",
  VERSION_FLAG: "--version",
} as const;

export const PY_LSP_MESSAGES = {
  binaryUnresolvable:
    "pyright-langserver is not resolvable (no local node_modules/.bin copy and `npx --no-install` cannot find pyright) -- install pyright as a project devDependency (`npm install -D pyright`) to enable LSP-precision cross-file edges for Python",
  markerFileMissing:
    "no pyproject.toml/requirements.txt found at the workspace root",
} as const;
