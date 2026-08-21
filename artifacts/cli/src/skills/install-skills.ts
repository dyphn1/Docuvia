/**
 * Installs `docuvia-*` skill files into the project's `.claude/skills/` directory (issue #50,
 * roadmap item 30). Each skill is a self-contained `SKILL.md` with YAML frontmatter that
 * Claude Code (and other MCP-compatible agents) pick up automatically.
 *
 * Installation is opt-in via `docuvia init --skills` -- not baked into every `init` run,
 * per the self-installable/uninstallable requirement in the roadmap.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import {
  DOCUVIA_SKILL_TEMPLATES,
  type SkillTemplate,
} from "../constants/skill-templates.js";

const CLAUDE_SKILLS_DIR = ".claude/skills";

export interface SkillInstallResult {
  installed: string[];
  skipped: string[];
}

// Installs all Docuvia skill files into the workspace's .claude/skills/ directory.
// Skills that already exist (same dirName) are skipped -- this is idempotent.
export function installSkills(workspaceRoot: string): SkillInstallResult {
  const skillsBase = path.join(workspaceRoot, CLAUDE_SKILLS_DIR);
  const installed: string[] = [];
  const skipped: string[] = [];

  for (const template of DOCUVIA_SKILL_TEMPLATES) {
    const result = installSingleSkill(skillsBase, template);
    if (result === "installed") {
      installed.push(template.dirName);
    } else {
      skipped.push(template.dirName);
    }
  }

  return { installed, skipped };
}

// Removes all docuvia-* skill directories from .claude/skills/.
// Only directories whose name starts with "docuvia-" are touched.
export function uninstallSkills(workspaceRoot: string): string[] {
  const skillsBase = path.join(workspaceRoot, CLAUDE_SKILLS_DIR);
  const removed: string[] = [];

  if (!fs.existsSync(skillsBase)) {
    return removed;
  }

  const entries = fs.readdirSync(skillsBase, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith("docuvia-")) {
      continue;
    }

    const skillDir = path.join(skillsBase, entry.name);
    fs.rmSync(skillDir, { recursive: true, force: true });
    removed.push(entry.name);
  }

  return removed;
}

function installSingleSkill(
  skillsBase: string,
  template: SkillTemplate,
): "installed" | "skipped" {
  const skillDir = path.join(skillsBase, template.dirName);
  const skillFile = path.join(skillDir, "SKILL.md");

  if (fs.existsSync(skillFile)) {
    return "skipped";
  }

  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(skillFile, template.content, "utf-8");

  return "installed";
}
