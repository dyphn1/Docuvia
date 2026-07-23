import * as path from "path";
import { BasePlatform } from "./base.platform.js";
import {
  AGENT_INSTRUCTIONS,
  AGENT_INSTRUCTIONS_MARKER,
  AGENT_INSTRUCTIONS_END_MARKER,
  AGENTS_MD_FILENAME,
  PLATFORM_NAME_CODEX,
  PLATFORM_SLUG_CODEX,
} from "../constants/init-templates.js";
import { writeOrAppend, removeBlock } from "../utils/fs-utils.js";

/** Codex CLI reads `AGENTS.md` (repo root + nested) as its project instructions file — this is
 *  very often a pre-existing, hand-authored file (this repo's own `AGENTS.md` is one), so writes
 *  only ever touch our own marker block, never the rest of the file. */
export class CodexPlatform extends BasePlatform {
  readonly name = PLATFORM_NAME_CODEX;
  readonly slug = PLATFORM_SLUG_CODEX;

  private agentsMdPath(cwd: string): string {
    return path.join(cwd, AGENTS_MD_FILENAME);
  }

  async installHooks(cwd: string): Promise<void> {
    await writeOrAppend(
      this.agentsMdPath(cwd),
      AGENT_INSTRUCTIONS,
      AGENT_INSTRUCTIONS_MARKER,
    );
  }

  async uninstallHooks(cwd: string): Promise<void> {
    await removeBlock(
      this.agentsMdPath(cwd),
      `<!-- ${AGENT_INSTRUCTIONS_MARKER} -->`,
      `<!-- ${AGENT_INSTRUCTIONS_END_MARKER} -->`,
    );
  }
}
