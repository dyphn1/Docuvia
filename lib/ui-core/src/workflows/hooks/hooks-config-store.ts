import fs from "fs/promises";
import path from "path";
import {
  DOCUVIA_DIR_NAME,
  HOOKS_CONFIG_FILE_NAME,
  DEFAULT_HOOKS_CONFIG,
  HookNames,
  UTF8_ENCODING,
  type HookName,
  type HooksConfig,
  type ILogger,
} from "@workspace/contracts";

const HOOKS_CONFIG_STORE_MESSAGES = {
  CORRUPT_FILE: (filePath: string) =>
    `Could not parse ${filePath} -- falling back to the default hooks config`,
} as const;

function resolveHooksConfigPath(workspaceRoot: string): string {
  return path.join(workspaceRoot, DOCUVIA_DIR_NAME, HOOKS_CONFIG_FILE_NAME);
}

/** A file whose top-level JSON value isn't a plain object (e.g. `[]`, `"oops"`, `42`) is treated
 *  the same as unparseable JSON -- neither is a shape `readHooksConfig` can trust. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * `docuvia hooks list/enable/disable`'s persistence read (issue #42 §7.1/§7.3) -- a plain,
 * dependency-free `fs` read (no `docuviaFactory` token needed; mirrors `remove-docuvia-dir.ts`'s
 * explicit precedent), since two of the three hooks this config gates are raw, standalone
 * platform scripts (`.claude/hooks/docuvia-hook.js`, the pre-push shell hook) that cannot open
 * SQLite or spawn a second `npx docuvia` process on every call without a real, continuous latency
 * cost (`context-injection` fires on every Grep/Glob/Bash/Read).
 *
 * Never throws: a missing file means "never configured yet" (`DEFAULT_HOOKS_CONFIG`); an
 * unparseable or wrong-shape file warns and falls back to the same defaults rather than crashing
 * or silently overwriting a file this function can't trust (mirrors `claude.platform.ts`'s
 * `readProjectSettingsFile`'s `aborted` pattern, adapted to "return defaults" here since a *read*
 * must always produce some answer, unlike a write that can simply decline). A valid file missing
 * one of the three keys (e.g. written by an older Docuvia version, or a hook added in a later
 * release than the one that wrote this file) has the gap filled in from `DEFAULT_HOOKS_CONFIG` --
 * forward-compatible with a hook added later.
 */
export async function readHooksConfig(
  workspaceRoot: string,
  logger: ILogger,
): Promise<HooksConfig> {
  const filePath = resolveHooksConfigPath(workspaceRoot);

  let raw: string;
  try {
    raw = await fs.readFile(filePath, UTF8_ENCODING);
  } catch {
    return { ...DEFAULT_HOOKS_CONFIG };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    logger.warn(HOOKS_CONFIG_STORE_MESSAGES.CORRUPT_FILE(filePath));
    return { ...DEFAULT_HOOKS_CONFIG };
  }
  if (!isPlainObject(parsed)) {
    logger.warn(HOOKS_CONFIG_STORE_MESSAGES.CORRUPT_FILE(filePath));
    return { ...DEFAULT_HOOKS_CONFIG };
  }

  const merged: HooksConfig = { ...DEFAULT_HOOKS_CONFIG };
  for (const hookName of Object.values(HookNames)) {
    const value = (parsed as Record<string, unknown>)[hookName];
    if (typeof value === "boolean") merged[hookName] = value;
  }
  return merged;
}

/**
 * Read-modify-write the whole file (issue #42 §7.3) -- reads via `readHooksConfig` first, so a
 * corrupt/missing file self-heals to "defaults plus this one change" rather than erroring;
 * creates `.docuvia/` first (`mkdir(recursive: true)`) in case `docuvia hooks enable/disable`
 * runs before `docuvia init` ever has.
 */
export async function writeHookEnabled(
  workspaceRoot: string,
  hookName: HookName,
  enabled: boolean,
  logger: ILogger,
): Promise<void> {
  const current = await readHooksConfig(workspaceRoot, logger);
  const next: HooksConfig = { ...current, [hookName]: enabled };

  await fs.mkdir(path.join(workspaceRoot, DOCUVIA_DIR_NAME), {
    recursive: true,
  });
  await fs.writeFile(
    resolveHooksConfigPath(workspaceRoot),
    `${JSON.stringify(next, null, 2)}\n`,
    UTF8_ENCODING,
  );
}
