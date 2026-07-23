import * as path from "path";
import { BasePlatform } from "./base.platform.js";
import {
  AGENT_INSTRUCTIONS,
  AGENT_INSTRUCTIONS_MARKER,
  AGENT_INSTRUCTIONS_END_MARKER,
  GITHUB_DIR,
  COPILOT_INSTRUCTIONS_FILENAME,
  PLATFORM_NAME_COPILOT,
  PLATFORM_SLUG_COPILOT,
} from "../constants/init-templates.js";
import { writeOrAppend, removeBlock } from "../utils/fs-utils.js";

export class CopilotPlatform extends BasePlatform {
  readonly name = PLATFORM_NAME_COPILOT;
  readonly slug = PLATFORM_SLUG_COPILOT;

  private instructionsPath(cwd: string): string {
    return path.join(cwd, GITHUB_DIR, COPILOT_INSTRUCTIONS_FILENAME);
  }

  async installHooks(cwd: string): Promise<void> {
    await writeOrAppend(
      this.instructionsPath(cwd),
      AGENT_INSTRUCTIONS,
      AGENT_INSTRUCTIONS_MARKER,
    );
  }

  async uninstallHooks(cwd: string): Promise<void> {
    await removeBlock(
      this.instructionsPath(cwd),
      `<!-- ${AGENT_INSTRUCTIONS_MARKER} -->`,
      `<!-- ${AGENT_INSTRUCTIONS_END_MARKER} -->`,
    );
  }
}
