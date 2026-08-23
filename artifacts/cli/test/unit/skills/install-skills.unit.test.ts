import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  installSkills,
  uninstallSkills,
} from "../../../src/skills/install-skills.js";
import { DOCUVIA_SKILL_TEMPLATES } from "../../../src/constants/skill-templates.js";

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "docuvia-skills-test-"));
}

function removeTempDir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

describe("installSkills", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = createTempDir();
  });

  afterEach(() => {
    removeTempDir(tmpDir);
  });

  it("installs all skill files into .claude/skills/docuvia-*/SKILL.md", () => {
    const result = installSkills(tmpDir);

    expect(result.installed).toHaveLength(DOCUVIA_SKILL_TEMPLATES.length);
    expect(result.skipped).toHaveLength(0);

    for (const template of DOCUVIA_SKILL_TEMPLATES) {
      const skillFile = path.join(
        tmpDir,
        ".claude",
        "skills",
        template.dirName,
        "SKILL.md",
      );
      expect(fs.existsSync(skillFile)).toBe(true);
      expect(fs.readFileSync(skillFile, "utf-8")).toBe(template.content);
    }
  });

  it("is idempotent -- second call skips existing skills", () => {
    installSkills(tmpDir);
    const result = installSkills(tmpDir);

    expect(result.installed).toHaveLength(0);
    expect(result.skipped).toHaveLength(DOCUVIA_SKILL_TEMPLATES.length);
  });

  it("creates .claude/skills directory if it does not exist", () => {
    const skillsDir = path.join(tmpDir, ".claude", "skills");
    expect(fs.existsSync(skillsDir)).toBe(false);

    installSkills(tmpDir);

    expect(fs.existsSync(skillsDir)).toBe(true);
  });

  it("does not touch non-docuvia skills already present", () => {
    const existingSkillDir = path.join(
      tmpDir,
      ".claude",
      "skills",
      "my-custom-skill",
    );
    fs.mkdirSync(existingSkillDir, { recursive: true });
    fs.writeFileSync(
      path.join(existingSkillDir, "SKILL.md"),
      "existing content",
    );

    installSkills(tmpDir);

    expect(
      fs.readFileSync(path.join(existingSkillDir, "SKILL.md"), "utf-8"),
    ).toBe("existing content");
  });
});

describe("uninstallSkills", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = createTempDir();
  });

  afterEach(() => {
    removeTempDir(tmpDir);
  });

  it("removes all docuvia-* skill directories", () => {
    installSkills(tmpDir);

    const removed = uninstallSkills(tmpDir);

    expect(removed).toHaveLength(DOCUVIA_SKILL_TEMPLATES.length);
    for (const template of DOCUVIA_SKILL_TEMPLATES) {
      const skillDir = path.join(tmpDir, ".claude", "skills", template.dirName);
      expect(fs.existsSync(skillDir)).toBe(false);
    }
  });

  it("does not remove non-docuvia skills", () => {
    const existingSkillDir = path.join(
      tmpDir,
      ".claude",
      "skills",
      "my-custom-skill",
    );
    fs.mkdirSync(existingSkillDir, { recursive: true });
    fs.writeFileSync(
      path.join(existingSkillDir, "SKILL.md"),
      "existing content",
    );

    installSkills(tmpDir);
    uninstallSkills(tmpDir);

    expect(
      fs.readFileSync(path.join(existingSkillDir, "SKILL.md"), "utf-8"),
    ).toBe("existing content");
  });

  it("returns empty array when .claude/skills directory does not exist", () => {
    const removed = uninstallSkills(tmpDir);
    expect(removed).toHaveLength(0);
  });

  it("is idempotent -- second call returns empty array", () => {
    installSkills(tmpDir);
    uninstallSkills(tmpDir);
    const removed = uninstallSkills(tmpDir);
    expect(removed).toHaveLength(0);
  });
});
