/** TypeScript/JavaScript's Tier B LSP provider (phase1-decision-integration.md §8b D1,
 *  IMPT-002) -- `typescript-language-server`, resolved via the npm/npx strategy.
 *
 *  These are TS/JS-specific constants and messages; the generic LSP wire/shared constants live in
 *  `lsp-constants.ts`.
 */

/** `typescript-language-server`'s package/binary name and wire vocabulary. Resolution order: an
 *  explicit override, then `<workspaceRoot>/node_modules/.bin`, then `npx --no-install` -- never
 *  bundled with docuvia itself. */
export const TsLspConstants = {
  PACKAGE_NAME: "typescript-language-server",
  NPX_COMMAND: "npx",
  NPX_NO_INSTALL_FLAG: "--no-install",
  STDIO_ARG: "--stdio",
  VERSION_FLAG: "--version",
} as const;

/** Default `--max-old-space-size` (MB) for the spawned typescript-language-server/tsserver
 *  process. Exported so `typescript-lsp-edge-provider.ts` can pass the same number through
 *  `initializationOptions.maxTsServerMemory` -- the mechanism that actually reaches tsserver's
 *  own heap flag (confirmed by reading `typescript-language-server`'s own source: it explicitly
 *  pushes `--max-old-space-size=${configuration.maxTsServerMemory}` onto the forked tsserver
 *  process's own args, which wins over/coexists redundantly with any NODE_OPTIONS-supplied value
 *  -- so `buildTsHeapSizeEnvOverride` is a secondary belt-and-suspenders path, not the primary
 *  fix). Bumped from an initial 4096 to 8192 after live-verifying against a real vscode checkout
 *  that 4096 (env-only, no `initializationOptions`) still let tsserver OOM-abort (exit 134/
 *  SIGABRT) partway through a large Tier B batch -- still untuned/a round number, not a measured
 *  vscode-specific ceiling; re-tune (or make config-overridable) if real usage shows it's still
 *  insufficient or now wasteful. Root cause: roadmap item 28. */
export const DEFAULT_TS_MAX_OLD_SPACE_SIZE_MB = 8192;

/** TS/JS's pre-flight gate messages (multi-language-lsp-support plan, Finding D) --
 *  TS-specific reasons for a `ready: false` pre-flight, kept out of the shared `LSP_MESSAGES`
 *  since every other language has its own vocabulary. */
export const TS_LSP_MESSAGES = {
  binaryUnresolvable:
    "typescript-language-server is not resolvable (no local node_modules/.bin copy and `npx --no-install` cannot find it) -- install it as a project devDependency to enable LSP-precision cross-file edges",
  nodeModulesMissing:
    "node_modules is missing -- run the project's package manager install first",
  tsconfigMissing: "no tsconfig.json/jsconfig.json found at the workspace root",
} as const;
