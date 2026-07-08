import * as path from "path";
import { BasePlatform } from "./base.platform.js";
import { AGENT_INSTRUCTIONS, GITHUB_DIR } from "../constants/init-templates.js";
import { writeOrAppend } from "../utils/fs-utils.js";

export class GenericMarkdownPlatform extends BasePlatform {
  readonly name = "Markdown Agents";

  async configure(cwd: string): Promise<void> {
    // GitHub Copilot
    await writeOrAppend(
      path.join(cwd, GITHUB_DIR, "copilot-instructions.md"),
      AGENT_INSTRUCTIONS,
      "docuvia:start"
    );

    // Claude Desktop / Generic Markdown
    await writeOrAppend(path.join(cwd, "CLAUDE.md"), AGENT_INSTRUCTIONS, "docuvia:start");

    // Windsurf
    await writeOrAppend(path.join(cwd, ".windsurfrules"), AGENT_INSTRUCTIONS, "docuvia:start");

    // Cursor Rules (Fallback for non-hook Cursor modes)
    await writeOrAppend(path.join(cwd, ".cursorrules"), AGENT_INSTRUCTIONS, "docuvia:start");

    // Standard LLM Crawler text
    await writeOrAppend(path.join(cwd, "llms.txt"), AGENT_INSTRUCTIONS, "docuvia:start");
  }
}
