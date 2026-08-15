import process from "process";
import crypto from "node:crypto";
import {
  docuviaMemory,
  DocuviaError,
  MemoryKeys,
  HookNames,
  createNoopLogger,
  type HookName,
} from "@workspace/contracts";
import { docuviaApi } from "@workspace/ui-core";
import "../registration.js";
import { ui } from "../ui/wizard.js";
import { createPinoBackedLogger } from "../logging/create-logger.js";
import { UI_MESSAGES } from "../constants/ui-messages.js";

/** `docuvia hooks <subcommand>` (issue #42 §7.4). */
const HOOKS_SUBCOMMANDS = {
  LIST: "list",
  ENABLE: "enable",
  DISABLE: "disable",
  /** Internal-use verb other hooks shell out to for a fast enabled/disabled exit code -- not a
   *  human-facing report (no stdout on the happy path). See `checkHookSubcommand`. */
  CHECK: "check",
} as const;

function isValidHookName(name: string | undefined): name is HookName {
  return !!name && (Object.values(HookNames) as string[]).includes(name);
}

async function listHooksSubcommand(cwd: string): Promise<void> {
  const scopeId = crypto.randomUUID();
  const logger = createPinoBackedLogger();
  docuviaMemory.createScope(scopeId);
  docuviaMemory.set(scopeId, MemoryKeys.WORKSPACE_ROOT, cwd);

  try {
    const config = await docuviaApi.listHooks(scopeId, logger);
    ui.header(UI_MESSAGES.HOOKS_HEADER);
    ui.table(
      [
        { header: UI_MESSAGES.HOOKS_COL_NAME },
        { header: UI_MESSAGES.HOOKS_COL_STATUS },
      ],
      Object.values(HookNames).map((name) => [
        name,
        config[name]
          ? UI_MESSAGES.HOOKS_STATUS_ENABLED
          : UI_MESSAGES.HOOKS_STATUS_DISABLED,
      ]),
    );
  } catch (error: unknown) {
    const message =
      error instanceof DocuviaError || error instanceof Error
        ? error.message
        : String(error);
    ui.error(UI_MESSAGES.HOOKS_LIST_FAIL + message);
    process.exitCode = 1;
  } finally {
    docuviaMemory.deleteScope(scopeId);
  }
}

async function setHookEnabledSubcommand(
  cwd: string,
  hookName: string | undefined,
  enabled: boolean,
): Promise<void> {
  if (!isValidHookName(hookName)) {
    ui.error(
      UI_MESSAGES.HOOKS_INVALID_NAME(hookName, Object.values(HookNames)),
    );
    process.exitCode = 1;
    return;
  }

  const scopeId = crypto.randomUUID();
  const logger = createPinoBackedLogger();
  docuviaMemory.createScope(scopeId);
  docuviaMemory.set(scopeId, MemoryKeys.WORKSPACE_ROOT, cwd);
  docuviaMemory.set(scopeId, MemoryKeys.HOOK_NAME, hookName);
  docuviaMemory.set(scopeId, MemoryKeys.HOOK_ENABLED, enabled);

  try {
    await docuviaApi.setHookEnabled(scopeId, logger);
    ui.success(
      enabled
        ? UI_MESSAGES.HOOKS_ENABLED(hookName)
        : UI_MESSAGES.HOOKS_DISABLED(hookName),
    );
  } catch (error: unknown) {
    const message =
      error instanceof DocuviaError || error instanceof Error
        ? error.message
        : String(error);
    ui.error(UI_MESSAGES.HOOKS_SET_FAIL + message);
    process.exitCode = 1;
  } finally {
    docuviaMemory.deleteScope(scopeId);
  }
}

/**
 * `docuvia hooks check <hookName>` (issue #42 §7.4) -- the fast, already-in-the-CLI check
 * `PRE_PUSH_HOOK_CONTENT`'s `&&` chain shells out to (git-constants.ts) and
 * `run-flush-staged-l3.ts` conceptually mirrors internally. Exit code only: `0` enabled, `1`
 * disabled or an invalid/missing hook name -- no stdout for the happy path, matching a shell
 * `&&` chain's contract. Uses a noop logger (not the real Pino-backed one) so a corrupt-config
 * warn from `readHooksConfig` can never leak console output into that chain. A read failure
 * (missing `.docuvia/`, unreadable file) fails *open* (`exitCode = 0`) -- this verb's whole job is
 * gating an automatic trigger, and it must never be the reason a healthy pipeline stops running
 * (mirrors `PRE_PUSH_HOOK_CONTENT`'s own "never block a push" reliability requirement).
 */
async function checkHookSubcommand(
  cwd: string,
  hookName: string | undefined,
): Promise<void> {
  if (!isValidHookName(hookName)) {
    process.exitCode = 1;
    return;
  }

  const scopeId = crypto.randomUUID();
  docuviaMemory.createScope(scopeId);
  docuviaMemory.set(scopeId, MemoryKeys.WORKSPACE_ROOT, cwd);

  try {
    const config = await docuviaApi.listHooks(scopeId, createNoopLogger());
    process.exitCode = config[hookName] ? 0 : 1;
  } catch {
    process.exitCode = 0;
  } finally {
    docuviaMemory.deleteScope(scopeId);
  }
}

/** `docuvia hooks list|enable|disable|check` (issue #42 §7.4) -- `hookName` is only meaningful
 *  for `enable`/`disable`/`check`; `list` ignores it (mirrors this file's own two-positional
 *  `cli.ts` handler). */
export async function hooksCommand(
  subcommand: string | undefined,
  hookName: string | undefined,
  cwd: string = process.cwd(),
): Promise<void> {
  switch (subcommand) {
    case HOOKS_SUBCOMMANDS.LIST:
      await listHooksSubcommand(cwd);
      return;
    case HOOKS_SUBCOMMANDS.ENABLE:
      await setHookEnabledSubcommand(cwd, hookName, true);
      return;
    case HOOKS_SUBCOMMANDS.DISABLE:
      await setHookEnabledSubcommand(cwd, hookName, false);
      return;
    case HOOKS_SUBCOMMANDS.CHECK:
      await checkHookSubcommand(cwd, hookName);
      return;
    default:
      ui.error(UI_MESSAGES.HOOKS_UNKNOWN_SUBCOMMAND(subcommand));
      process.exitCode = 1;
  }
}
