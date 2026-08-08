import {
  resolveNpmNpxBinary,
  type ResolvedLspBinary,
} from "./lsp-binary-resolver-strategies.js";
import {
  TsLspConstants,
  DEFAULT_TS_MAX_OLD_SPACE_SIZE_MB,
} from "./typescript-lsp-constants.js";

/** Builds an env override that raises tsserver's heap ceiling via NODE_OPTIONS -- unless the
 *  caller's own environment already sets --max-old-space-size itself, in which case this returns
 *  undefined and leaves the caller's env untouched entirely (respecting an explicit user choice).
 *  When NODE_OPTIONS is already set to something else (e.g. --stack-trace-limit), the new flag is
 *  appended, not a replacement. Passed as the npm/npx strategy's `buildEnv` so it applies to
 *  whichever resolution branch wins. */
function buildTsHeapSizeEnvOverride(): NodeJS.ProcessEnv | undefined {
  const existing = process.env.NODE_OPTIONS ?? "";
  if (existing.includes("--max-old-space-size")) return undefined;
  const flag = `--max-old-space-size=${DEFAULT_TS_MAX_OLD_SPACE_SIZE_MB}`;
  return {
    ...process.env,
    NODE_OPTIONS: existing ? `${existing} ${flag}` : flag,
  };
}

/**
 * TS/JS's binary resolution (phase1-decision-integration.md §8b D1): an explicit override first,
 * then `<workspaceRoot>/node_modules/.bin`, then `npx --no-install` -- all via the shared npm/npx
 * strategy (`resolveNpmNpxBinary`), with TS/JS's tsserver heap ceiling applied to whichever
 * branch wins (roadmap item 28; see `DEFAULT_TS_MAX_OLD_SPACE_SIZE_MB`). Never falls back to a
 * bundled copy -- there isn't one.
 */
export function resolveTypeScriptLspBinary(
  workspaceRoot: string,
  override?: { binary?: string; args?: string[] },
): ResolvedLspBinary {
  return resolveNpmNpxBinary(
    workspaceRoot,
    {
      packageName: TsLspConstants.PACKAGE_NAME,
      defaultArgs: [TsLspConstants.STDIO_ARG],
      buildEnv: buildTsHeapSizeEnvOverride,
    },
    override,
  );
}
