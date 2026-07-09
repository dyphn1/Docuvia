import * as vscode from "vscode";
import { parse as parseYaml } from "yaml";
import { v4 as uuidv4 } from "uuid";

import { L1Template } from "../types.js";
import {
  L1_TEMPLATES,
  ProjectType,
  PKG_JSON_DEPENDENCIES,
  PKG_JSON_DEV_DEPENDENCIES,
  PKG_JSON_WORKSPACES,
  KEYWORD_PNPM_WORKSPACE,
  MSG_ONTOLOGY_SYSTEM_PROMPT_YAML_ONLY,
  MSG_ONTOLOGY_USER_PROMPT_REFINE,
  MSG_ONTOLOGY_SYSTEM_PROMPT_DYNAMIC,
  MSG_ONTOLOGY_USER_PROMPT_DYNAMIC,
  MSG_ONTOLOGY_DYNAMIC_FAIL,
} from "../constants/index.js";

// ─── Project type detection ───────────────────────────────────────────────────

export function detectProjectTypes(
  readmeContent: string,
  pkgJson: Record<string, unknown>
): L1Template[] {
  const readmeLower = readmeContent.toLowerCase();

  const allDeps = new Set<string>([
    ...Object.keys((pkgJson[PKG_JSON_DEPENDENCIES] as object) ?? {}),
    ...Object.keys((pkgJson[PKG_JSON_DEV_DEPENDENCIES] as object) ?? {}),
  ]);

  // Score each template
  const scores = L1_TEMPLATES.map((template) => {
    let score = 0;
    // Monorepo gets a massive boost if workspaces are present
    if (
      template.projectType === ProjectType.Monorepo &&
      (pkgJson[PKG_JSON_WORKSPACES] || readmeLower.includes(KEYWORD_PNPM_WORKSPACE))
    ) {
      score += 10;
    }

    for (const kw of template.keywords) {
      if (readmeLower.includes(kw)) {
        score += 1;
      }
      if (allDeps.has(kw)) {
        score += 2; // dependency match is stronger signal
      }
    }
    return { template, score };
  });

  const matched = scores.filter((s) => s.score >= 2).sort((a, b) => b.score - a.score);
  return matched.map((m) => m.template);
}

// ─── LM tag refinement ────────────────────────────────────────────────────────

export function formatYamlAsTable(yamlString: string): string {
  try {
    const tags = parseYaml(yamlString);
    if (!Array.isArray(tags)) {
      return `\`\`\`yaml\n${yamlString}\n\`\`\``;
    }

    let table = "| Name | Description |\n|---|---|\n";
    for (const tag of tags) {
      if (tag.name && tag.description) {
        table += `| **${tag.name}** | ${tag.description} |\n`;
      }
    }
    return table;
  } catch {
    // Fallback to raw YAML if parsing fails
    return `\`\`\`yaml\n${yamlString}\n\`\`\``;
  }
}

export async function refineTagsWithLM(
  templates: L1Template[],
  readmeContent: string,
  model: vscode.LanguageModelChat,
  token: vscode.CancellationToken
): Promise<string> {
  const readmeExcerpt = readmeContent.slice(0, 1500);

  const combinedTags = templates.flatMap((t) => t.tags);
  // Deduplicate by slug
  const uniqueTags = Array.from(new Map(combinedTags.map((item) => [item.slug, item])).values());
  const projectTypesLabel = templates.map((t) => t.label).join(" + ");

  const messages = [
    vscode.LanguageModelChatMessage.Assistant(MSG_ONTOLOGY_SYSTEM_PROMPT_YAML_ONLY),
    vscode.LanguageModelChatMessage.User(
      MSG_ONTOLOGY_USER_PROMPT_REFINE.replace("{0}", projectTypesLabel)
        .replace("{1}", readmeExcerpt)
        .replace("{2}", JSON.stringify(uniqueTags, null, 2))
    ),
  ];

  try {
    const response = await model.sendRequest(messages, {}, token);
    let yaml = "";
    for await (const part of response.text) {
      yaml += part;
    }
    return yaml
      .replace(/^```ya?ml\n?/i, "")
      .replace(/\n?```$/, "")
      .trim();
  } catch {
    return await buildRawYaml(templates[0]);
  }
}

export async function buildRawYaml(template: L1Template): Promise<string> {
  return template.tags
    .map((tag) =>
      [
        `- id: "${uuidv4()}"`,
        `  slug: "${tag.slug}"`,
        `  name: "${tag.name}"`,
        `  description: "${tag.description}"`,
      ].join("\n")
    )
    .join("\n");
}

export async function generateTagsDynamically(
  readmeContent: string,
  pkgJson: Record<string, unknown>,
  model: vscode.LanguageModelChat,
  token: vscode.CancellationToken
): Promise<string | undefined> {
  const readmeExcerpt = readmeContent.slice(0, 1500);
  const allDeps = Object.keys({
    ...((pkgJson[PKG_JSON_DEPENDENCIES] as object) ?? {}),
    ...((pkgJson[PKG_JSON_DEV_DEPENDENCIES] as object) ?? {}),
  }).join(", ");

  const messages = [
    vscode.LanguageModelChatMessage.Assistant(MSG_ONTOLOGY_SYSTEM_PROMPT_DYNAMIC),
    vscode.LanguageModelChatMessage.User(
      MSG_ONTOLOGY_USER_PROMPT_DYNAMIC.replace("{0}", allDeps || "None").replace(
        "{1}",
        readmeExcerpt
      )
    ),
  ];

  try {
    const response = await model.sendRequest(messages, {}, token);
    let yaml = "";
    for await (const part of response.text) {
      yaml += part;
    }
    return yaml
      .replace(/^```ya?ml\n?/i, "")
      .replace(/\n?```$/, "")
      .trim();
  } catch (err) {
    console.error(MSG_ONTOLOGY_DYNAMIC_FAIL, err);
    return undefined;
  }
}
