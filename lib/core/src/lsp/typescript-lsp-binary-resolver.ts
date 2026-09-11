import {
  resolveNpmNpxBinary,
  type ResolvedLspBinary,
} from "./lsp-binary-resolver-strategies.js";
import {
  TsLspConstants,
  DEFAULT_TS_MAX_OLD_SPACE_SIZE_MB,
} from "./typescript-lsp-constants.js";
import { buildMinimalLspEnv } from "./lsp-process-env.js";

/** Builds the minimal child-process env plus tsserver's heap ceiling. The parent process's
 * environment is deliberately not spread here: doing so would leak credentials/API keys into
 * the TypeScript LSP process and bypass the transport's minimal-env policy (issue #322).
 * Existing NODE_OPTIONS are preserved so an explicit --max-old-space-size choice still wins. */
function buildTsHeapSizeEnvOverride(): NodeJS.ProcessEnv {
  const env = buildMinimalLspEnv();
  const existing = process.env.NODE_OPTIONS ?? "";
  if (existing.includes("--max-old-space-size")) {
    env.NODE_OPTIONS = existing;
    return env;
  }

  const flag = `--max-old-space-size=${DEFAULT_TS_MAX_OLD_SPACE_SIZE_MB}`;
  env.NODE_OPTIONS = existing ? `${existing} ${flag}` : flag;
  return env;
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
