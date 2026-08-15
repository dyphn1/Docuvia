import type { HookName, HooksConfig, ILogger } from "@workspace/contracts";
import { readHooksConfig, writeHookEnabled } from "./hooks-config-store.js";

/**
 * Thin wrapper around `hooks-config-store.ts` (issue #42 §7.3) -- `docuvia-api.ts`'s
 * `listHooks`/`setHookEnabled` call into this, mirroring every other capability's
 * Orchestration-layer shape, even though the underlying read/write is a couple of lines each.
 */
export async function listHooks(
  workspaceRoot: string,
  logger: ILogger,
): Promise<HooksConfig> {
  return readHooksConfig(workspaceRoot, logger);
}

/** Writes the toggle, then re-reads the full config so the caller (the CLI's `hooks
 *  enable/disable` command) can print a confirming summary of every hook's state, not just the
 *  one that changed. */
export async function setHookEnabled(
  workspaceRoot: string,
  hookName: HookName,
  enabled: boolean,
  logger: ILogger,
): Promise<HooksConfig> {
  await writeHookEnabled(workspaceRoot, hookName, enabled, logger);
  return readHooksConfig(workspaceRoot, logger);
}
