import * as path from "path";
import { BasePlatform } from "./base.platform.js";
import {
  AGENT_INSTRUCTIONS,
  AGENT_INSTRUCTIONS_MARKER,
  AGENT_INSTRUCTIONS_END_MARKER,
  HERMES_MD_FILENAME,
  PLATFORM_NAME_HERMES,
  PLATFORM_SLUG_HERMES,
} from "../constants/init-templates.js";
import { writeOrAppend, removeBlock } from "../utils/fs-utils.js";

/** Hermes Agent loads exactly one project context file per session, first match wins:
 *  `.hermes.md` -> `AGENTS.md` -> `CLAUDE.md` -> `.cursorrules`. Writing to the highest-priority
 *  `.hermes.md` guarantees Docuvia's instructions are seen even when `AGENTS.md`/`CLAUDE.md` are
 *  owned by another selected platform (or simply absent). */
export class HermesPlatform extends BasePlatform {
  readonly name = PLATFORM_NAME_HERMES;
  readonly slug = PLATFORM_SLUG_HERMES;

  private hermesMdPath(cwd: string): string {
    return path.join(cwd, HERMES_MD_FILENAME);
  }

  async installHooks(cwd: string): Promise<void> {
    await writeOrAppend(
      this.hermesMdPath(cwd),
      AGENT_INSTRUCTIONS,
      AGENT_INSTRUCTIONS_MARKER,
    );
  }

  async uninstallHooks(cwd: string): Promise<void> {
    await removeBlock(
      this.hermesMdPath(cwd),
      `<!-- ${AGENT_INSTRUCTIONS_MARKER} -->`,
      `<!-- ${AGENT_INSTRUCTIONS_END_MARKER} -->`,
    );
  }
}
