import * as path from "path";
import { BasePlatform } from "./base.platform.js";
import {
  AGENT_INSTRUCTIONS,
  AGENT_INSTRUCTIONS_MARKER,
  GITHUB_DIR,
  COPILOT_INSTRUCTIONS_FILENAME,
  CLAUDE_MD_FILENAME,
  WINDSURF_RULES_FILENAME,
  CURSOR_RULES_FILENAME,
  LLMS_TXT_FILENAME,
  PLATFORM_NAME_MARKDOWN_AGENTS,
} from "../constants/init-templates.js";
import { writeOrAppend } from "../utils/fs-utils.js";

export class GenericMarkdownPlatform extends BasePlatform {
  readonly name = PLATFORM_NAME_MARKDOWN_AGENTS;

  async configure(cwd: string, _allowGlobalMcpConfig?: boolean): Promise<void> {
    const targetPaths = [
      path.join(cwd, GITHUB_DIR, COPILOT_INSTRUCTIONS_FILENAME), // GitHub Copilot
      path.join(cwd, CLAUDE_MD_FILENAME), // Claude Desktop / Generic Markdown
      path.join(cwd, WINDSURF_RULES_FILENAME),
      path.join(cwd, CURSOR_RULES_FILENAME), // Fallback for non-hook Cursor modes
      path.join(cwd, LLMS_TXT_FILENAME), // Standard LLM Crawler text
    ];

    for (const targetPath of targetPaths) {
      await writeOrAppend(targetPath, AGENT_INSTRUCTIONS, AGENT_INSTRUCTIONS_MARKER);
    }
  }
}
