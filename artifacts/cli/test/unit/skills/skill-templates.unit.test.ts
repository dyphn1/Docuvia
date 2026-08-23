import { describe, it, expect } from "vitest";
import {
  DOCUVIA_SKILL_TEMPLATES,
  SKILLS_DIR_NAME,
} from "../../../src/constants/skill-templates.js";

describe("DOCUVIA_SKILL_TEMPLATES", () => {
  it("contains exactly 4 skill templates", () => {
    expect(DOCUVIA_SKILL_TEMPLATES).toHaveLength(4);
  });

  it("has unique dirNames across all templates", () => {
    const dirNames = DOCUVIA_SKILL_TEMPLATES.map((t) => t.dirName);
    expect(new Set(dirNames).size).toBe(dirNames.length);
  });

  it("all dirNames start with docuvia-", () => {
    for (const template of DOCUVIA_SKILL_TEMPLATES) {
      expect(template.dirName).toMatch(/^docuvia-/);
    }
  });

  it("all contents have YAML frontmatter with name and description", () => {
    for (const template of DOCUVIA_SKILL_TEMPLATES) {
      expect(template.content).toMatch(/^---\n/);
      expect(template.content).toContain("name:");
      expect(template.content).toContain("description:");
      expect(template.content).toContain("---\n");
    }
  });

  it("frontmatter name matches dirName", () => {
    for (const template of DOCUVIA_SKILL_TEMPLATES) {
      const frontmatterMatch = template.content.match(/^---\nname:\s*(.+)\n/);
      expect(frontmatterMatch).not.toBeNull();
      expect(frontmatterMatch![1].trim()).toBe(template.dirName);
    }
  });

  it("all contents include docuvia CLI command references", () => {
    for (const template of DOCUVIA_SKILL_TEMPLATES) {
      expect(template.content).toContain("docuvia");
    }
  });

  it("exploring skill references query and impact commands", () => {
    const exploring = DOCUVIA_SKILL_TEMPLATES.find(
      (t) => t.dirName === "docuvia-exploring",
    );
    expect(exploring).toBeDefined();
    expect(exploring!.content).toContain("query");
    expect(exploring!.content).toContain("impact");
  });

  it("impact-analysis skill references impact command", () => {
    const impact = DOCUVIA_SKILL_TEMPLATES.find(
      (t) => t.dirName === "docuvia-impact-analysis",
    );
    expect(impact).toBeDefined();
    expect(impact!.content).toContain("impact");
  });

  it("knowledge-graph skill references query command", () => {
    const kg = DOCUVIA_SKILL_TEMPLATES.find(
      (t) => t.dirName === "docuvia-knowledge-graph",
    );
    expect(kg).toBeDefined();
    expect(kg!.content).toContain("query");
  });

  it("agent-authored skill references analyze --agent-authored", () => {
    const agent = DOCUVIA_SKILL_TEMPLATES.find(
      (t) => t.dirName === "docuvia-agent-authored",
    );
    expect(agent).toBeDefined();
    expect(agent!.content).toContain("--agent-authored");
    expect(agent!.content).toContain("stage");
  });
});

describe("SKILLS_DIR_NAME", () => {
  it("is docuvia", () => {
    expect(SKILLS_DIR_NAME).toBe("docuvia");
  });
});
