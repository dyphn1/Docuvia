import * as fs from "fs/promises";
import * as path from "path";
import { BasePlatform } from "./base.platform.js";
import { ui } from "../ui/wizard.js";
import { UI_MESSAGES } from "../constants/ui-messages.js";
import {
  AGENT_INSTRUCTIONS,
  AGENT_INSTRUCTIONS_MARKER,
  CONTINUE_RULES_DIR,
  CONTINUE_RULES_FILENAME,
  PLATFORM_NAME_CONTINUE,
  PLATFORM_SLUG_CONTINUE,
} from "../constants/init-templates.js";
import { writeOrAppend } from "../utils/fs-utils.js";

/** Continue auto-loads every markdown file under `.continue/rules/` as a rule
 *  (docs.continue.dev/customize/deep-dives/rules) — unlike the other platforms, Docuvia is the
 *  sole author of `docuvia.md`, so uninstall can unlink the whole file directly instead of
 *  slicing out a marker block. `.continue/` itself is never touched: it's Continue's directory,
 *  not Docuvia's, and may hold the user's own rules. */
export class ContinuePlatform extends BasePlatform {
  readonly name = PLATFORM_NAME_CONTINUE;
  readonly slug = PLATFORM_SLUG_CONTINUE;

  private rulesDir(cwd: string): string {
    return path.join(cwd, CONTINUE_RULES_DIR);
  }

  private rulesFilePath(cwd: string): string {
    return path.join(this.rulesDir(cwd), CONTINUE_RULES_FILENAME);
  }

  async installHooks(cwd: string): Promise<void> {
    await writeOrAppend(
      this.rulesFilePath(cwd),
      AGENT_INSTRUCTIONS,
      AGENT_INSTRUCTIONS_MARKER,
    );
  }

  async uninstallHooks(cwd: string): Promise<void> {
    try {
      await fs.unlink(this.rulesFilePath(cwd));
      ui.success(
        `${UI_MESSAGES.UNINSTALL_REMOVED_FILE_PREFIX}${CONTINUE_RULES_FILENAME}`,
      );
    } catch {
      // Best-effort removal — file may not exist.
      return;
    }

    try {
      await fs.rmdir(this.rulesDir(cwd));
    } catch {
      // Best-effort — directory may hold the user's own rules, or already be gone.
    }
  }
}
