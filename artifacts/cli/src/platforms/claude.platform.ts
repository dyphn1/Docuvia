import * as fs from "fs/promises";
import * as path from "path";
import process from "process";
import { BasePlatform } from "./base.platform.js";
import { ui } from "../ui/wizard.js";
import { UI_MESSAGES } from "../constants/ui-messages.js";
import {
  CLAUDE_DIR,
  CLAUDE_HOOKS_DIR,
  CLAUDE_PLUGIN_HOOKS_DIR,
  CLAUDE_PROJECT_HOOKS_DIR,
  DOCUVIA_HOOK_JS,
  HOOKS_JSON,
  DOCUVIA_HOOK_JS_FILENAME,
  HOOKS_CONFIG_FILENAME,
  SETTINGS_JSON_FILENAME,
  HOOK_EVENT_PRE_TOOL_USE,
  CLAUDE_DESKTOP_CONFIG_FILENAME,
  MCP_SERVER_ALIAS,
  PLATFORM_NAME_CLAUDE,
  PLATFORM_SLUG_CLAUDE,
  NPX_COMMAND,
  NPX_YES_FLAG,
  DOCUVIA_MCP_LAUNCH_ARGS,
  DOCUVIA_WORKSPACE_ROOT_ENV_VAR,
} from "../constants/init-templates.js";
import { UTF8_ENCODING } from "@workspace/contracts";
import { writeOrAppend } from "../utils/fs-utils.js";

const NODE_PLATFORM_WIN32 = "win32";
const NODE_PLATFORM_DARWIN = "darwin";
const MACOS_LIBRARY_DIR = "Library";
const MACOS_APPLICATION_SUPPORT_DIR = "Application Support";
const XDG_CONFIG_DIR = ".config";
const ERRNO_ENOENT = "ENOENT";

async function removeClaudeHookFile(claudeHooksPath: string): Promise<void> {
  try {
    await fs.unlink(path.join(claudeHooksPath, DOCUVIA_HOOK_JS_FILENAME));
    ui.success(
      `${UI_MESSAGES.UNINSTALL_REMOVED_FILE_PREFIX}${DOCUVIA_HOOK_JS_FILENAME}`,
    );
  } catch {
    // Best-effort removal — file may not exist.
  }
}

/** Removes the shared hooks config file, but only if it still matches Docuvia's stock content. */
async function removeClaudeHooksConfig(
  claudeHooksPath: string,
): Promise<boolean> {
  const hooksJsonPath = path.join(claudeHooksPath, HOOKS_CONFIG_FILENAME);
  try {
    const content = await fs.readFile(hooksJsonPath, UTF8_ENCODING);
    if (
      content.trim() ===
      HOOKS_JSON.replace(/\$\{HOOKS_DIR\}/g, CLAUDE_PLUGIN_HOOKS_DIR).trim()
    ) {
      await fs.unlink(hooksJsonPath);
      return true;
    }
  } catch {
    // Best-effort removal — file may not exist or be unreadable.
  }
  return false;
}

async function removeClaudeHooksDirIfEmpty(
  claudeHooksPath: string,
): Promise<void> {
  try {
    await fs.rmdir(claudeHooksPath);
  } catch {
    // Best-effort removal — directory may be non-empty or already gone.
  }
}

/** Builds the single PreToolUse hook entry ClaudePlatform merges into the project-level
 *  `.claude/settings.json` (roadmap item 26) — the same shape/matcher/timeout as the plugin-style
 *  `hooks.json` entry, just pointed at `${CLAUDE_PROJECT_DIR}/...` instead of
 *  `${CLAUDE_PLUGIN_ROOT}/...`, since only the former resolves in a plain (non-plugin) checkout. */
function buildDocuviaProjectHookEntry(): Record<string, unknown> {
  const projectHooksJson = HOOKS_JSON.replace(
    /\${HOOKS_DIR}/g,
    CLAUDE_PROJECT_HOOKS_DIR,
  );
  const parsed = JSON.parse(projectHooksJson) as Record<
    string,
    Record<string, unknown>[]
  >;
  return parsed[HOOK_EVENT_PRE_TOOL_USE][0];
}

/** Extracts the (fully resolved, un-templated) command string off a hook entry built by
 *  buildDocuviaProjectHookEntry — used both to detect an already-installed entry (merge) and to
 *  identify Docuvia's own entry for removal (prune), so both sides always agree on what "Docuvia's
 *  hook" means. */
function docuviaProjectHookCommand(hookEntry: Record<string, unknown>): string {
  const hooks = hookEntry.hooks;
  const command = Array.isArray(hooks)
    ? (hooks[0] as Record<string, unknown> | undefined)?.command
    : undefined;
  return typeof command === "string" ? command : "";
}

/** True if a `hooks.PreToolUse[]` entry already carries a hook whose command matches `command`. */
function preToolUseEntryHasCommand(
  entry: Record<string, unknown>,
  command: string,
): boolean {
  const entryHooks = entry?.hooks;
  return (
    Array.isArray(entryHooks) &&
    (entryHooks as Record<string, unknown>[]).some(
      (h) => h?.command === command,
    )
  );
}

/** Reads `.claude/settings.json` best-effort. ENOENT yields a fresh `{}` (proceed). Any other
 *  read/parse failure warns and yields `aborted: true` — a file we can't safely parse is never
 *  overwritten. */
async function readProjectSettingsFile(
  settingsPath: string,
): Promise<{ settings: any; aborted: boolean }> {
  try {
    const content = await fs.readFile(settingsPath, UTF8_ENCODING);
    return { settings: JSON.parse(content), aborted: false };
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code !== ERRNO_ENOENT) {
      ui.warn(
        `${UI_MESSAGES.FS_READ_ERROR}${settingsPath} (${(err as NodeJS.ErrnoException)?.code ?? UI_MESSAGES.FS_READ_ERROR_UNKNOWN_CODE}); leaving it untouched`,
      );
      return { settings: {}, aborted: true };
    }
    return { settings: {}, aborted: false };
  }
}

/** Merges Docuvia's PreToolUse hook entry into Claude Code's project-level `.claude/settings.json`
 *  (roadmap item 26 — `${CLAUDE_PROJECT_DIR}` resolves here today, unlike the plugin-only
 *  `${CLAUDE_PLUGIN_ROOT}` in hooks.json). Unlike our own dedicated hooks.json, this file is
 *  commonly user-owned/shared, so every other top-level key and every other PreToolUse matcher is
 *  left untouched, and a file that can't be safely parsed is never overwritten. Idempotent: safe
 *  to call on every `docuvia init`. */
async function mergeDocuviaHookIntoProjectSettings(
  settingsPath: string,
  hookEntry: Record<string, unknown>,
): Promise<void> {
  const { settings, aborted } = await readProjectSettingsFile(settingsPath);
  if (aborted) return;

  settings.hooks = settings.hooks ?? {};
  if (
    settings.hooks[HOOK_EVENT_PRE_TOOL_USE] !== undefined &&
    !Array.isArray(settings.hooks[HOOK_EVENT_PRE_TOOL_USE])
  ) {
    ui.warn(
      UI_MESSAGES.FS_UNEXPECTED_SHAPE(HOOK_EVENT_PRE_TOOL_USE, settingsPath),
    );
    return;
  }
  settings.hooks[HOOK_EVENT_PRE_TOOL_USE] =
    settings.hooks[HOOK_EVENT_PRE_TOOL_USE] ?? [];
  const preToolUse: Record<string, unknown>[] =
    settings.hooks[HOOK_EVENT_PRE_TOOL_USE];

  const command = docuviaProjectHookCommand(hookEntry);
  if (preToolUse.some((entry) => preToolUseEntryHasCommand(entry, command))) {
    return;
  }

  preToolUse.push(hookEntry);

  await fs.mkdir(path.dirname(settingsPath), { recursive: true });
  await fs.writeFile(
    settingsPath,
    `${JSON.stringify(settings, null, 2)}\n`,
    UTF8_ENCODING,
  );
}

/** Mirror-image of mergeDocuviaHookIntoProjectSettings — prunes only the PreToolUse entry whose
 *  command matches `command` from `.claude/settings.json`, leaving every other top-level key and
 *  hook matcher untouched. Best-effort: any read/parse failure means "nothing safe to prune,"
 *  silently returns rather than throwing or overwriting a file it can't trust. */
async function pruneDocuviaHookFromProjectSettings(
  settingsPath: string,
  command: string,
): Promise<void> {
  let settings: any;
  try {
    const content = await fs.readFile(settingsPath, UTF8_ENCODING);
    settings = JSON.parse(content);
  } catch {
    return;
  }

  const preToolUse = settings?.hooks?.[HOOK_EVENT_PRE_TOOL_USE];
  if (!Array.isArray(preToolUse)) return;

  const filtered = preToolUse.filter(
    (entry: Record<string, unknown>) =>
      !preToolUseEntryHasCommand(entry, command),
  );
  if (filtered.length === preToolUse.length) return;

  if (filtered.length === 0) {
    delete settings.hooks[HOOK_EVENT_PRE_TOOL_USE];
  } else {
    settings.hooks[HOOK_EVENT_PRE_TOOL_USE] = filtered;
  }
  if (Object.keys(settings.hooks).length === 0) {
    delete settings.hooks;
  }

  if (Object.keys(settings).length === 0) {
    await fs.unlink(settingsPath);
    ui.success(
      UI_MESSAGES.UNINSTALL_REMOVED_FILE_PREFIX + SETTINGS_JSON_FILENAME,
    );
    return;
  }

  await fs.writeFile(
    settingsPath,
    `${JSON.stringify(settings, null, 2)}\n`,
    UTF8_ENCODING,
  );
  ui.success(
    UI_MESSAGES.UNINSTALL_REMOVED_HOOK_FROM_SETTINGS_PREFIX + settingsPath,
  );
}

/** IFCE-002: Docuvia never writes machine-global state. Print a reminder naming the path
 *  instead of reading/editing Claude Desktop's own config file outside the repository. */
function printMcpServerRemovalReminder(claudeConfigDir: string): void {
  const claudeMcpPath = path.join(
    claudeConfigDir,
    CLAUDE_DESKTOP_CONFIG_FILENAME,
  );
  ui.info(
    `${UI_MESSAGES.UNINSTALL_CLAUDE_MCP_MANUAL_REMINDER} (${claudeMcpPath}).`,
  );
}

function resolveClaudeDesktopConfigDir(): string {
  if (process.platform === NODE_PLATFORM_WIN32) {
    return path.join(process.env.APPDATA || "", PLATFORM_NAME_CLAUDE);
  }
  if (process.platform === NODE_PLATFORM_DARWIN) {
    return path.join(
      process.env.HOME || "",
      MACOS_LIBRARY_DIR,
      MACOS_APPLICATION_SUPPORT_DIR,
      PLATFORM_NAME_CLAUDE,
    );
  }
  return path.join(
    process.env.HOME || "",
    XDG_CONFIG_DIR,
    PLATFORM_NAME_CLAUDE,
  );
}

export class ClaudePlatform extends BasePlatform {
  readonly name = PLATFORM_NAME_CLAUDE;
  readonly slug = PLATFORM_SLUG_CLAUDE;

  async installHooks(cwd: string): Promise<void> {
    await this.configureHooks(cwd);
    this.printMcpServerSnippet(cwd);
  }

  /** IFCE-002: Docuvia never writes machine-global state. Print the snippet the user would need
   *  to add to Claude Desktop's own config and let them copy-paste it, instead of editing a file
   *  outside the repository. */
  private printMcpServerSnippet(cwd: string): void {
    const claudeConfigDir = resolveClaudeDesktopConfigDir();
    if (!claudeConfigDir) return;
    const claudeMcpPath = path.join(
      claudeConfigDir,
      CLAUDE_DESKTOP_CONFIG_FILENAME,
    );

    const snippet = JSON.stringify(
      {
        mcpServers: {
          [MCP_SERVER_ALIAS]: {
            command: NPX_COMMAND,
            args: [NPX_YES_FLAG, ...DOCUVIA_MCP_LAUNCH_ARGS],
            env: { [DOCUVIA_WORKSPACE_ROOT_ENV_VAR]: cwd },
          },
        },
      },
      null,
      2,
    );

    ui.info(
      `${UI_MESSAGES.INIT_CLAUDE_MCP_MANUAL_SNIPPET} (${claudeMcpPath}):\n${snippet}`,
    );
  }

  private async configureHooks(cwd: string): Promise<void> {
    const claudeHooksPath = path.join(cwd, CLAUDE_HOOKS_DIR);
    await fs.mkdir(claudeHooksPath, { recursive: true });
    await fs.writeFile(
      path.join(claudeHooksPath, DOCUVIA_HOOK_JS_FILENAME),
      DOCUVIA_HOOK_JS,
      {
        mode: 0o755,
      },
    );

    let claudeHooksConfig = HOOKS_JSON.replace(
      /\${HOOKS_DIR}/g,
      CLAUDE_PLUGIN_HOOKS_DIR,
    );
    await writeOrAppend(
      path.join(claudeHooksPath, HOOKS_CONFIG_FILENAME),
      claudeHooksConfig,
      DOCUVIA_HOOK_JS_FILENAME,
    );

    // Roadmap item 26: also register a project-level hook via `.claude/settings.json`, since
    // `${CLAUDE_PROJECT_DIR}` (unlike the plugin-only `${CLAUDE_PLUGIN_ROOT}` above) resolves in a
    // plain checkout today.
    await mergeDocuviaHookIntoProjectSettings(
      path.join(cwd, CLAUDE_DIR, SETTINGS_JSON_FILENAME),
      buildDocuviaProjectHookEntry(),
    );
  }

  async uninstallHooks(cwd: string): Promise<void> {
    const claudeHooksPath = path.join(cwd, CLAUDE_HOOKS_DIR);

    await removeClaudeHookFile(claudeHooksPath);

    const removedHookJson = await removeClaudeHooksConfig(claudeHooksPath);
    if (removedHookJson) {
      await removeClaudeHooksDirIfEmpty(claudeHooksPath);
    }

    try {
      await pruneDocuviaHookFromProjectSettings(
        path.join(cwd, CLAUDE_DIR, SETTINGS_JSON_FILENAME),
        docuviaProjectHookCommand(buildDocuviaProjectHookEntry()),
      );
    } catch {
      // Best-effort prune — mirrors the cleanup steps above, never blocks the rest of uninstall.
    }

    const claudeConfigDir = resolveClaudeDesktopConfigDir();
    if (claudeConfigDir) {
      printMcpServerRemovalReminder(claudeConfigDir);
    }
  }
}
