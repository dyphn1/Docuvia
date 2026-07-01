export const DEFAULT_PROMPTS: Record<string, string> = {
  l1_tagger: `You are an expert software architect. Analyze VCS commit messages and extract L1 classification tags.
L1 tags are high-level domain classifications (e.g., "Authentication", "Database", "Networking", "Build System", "Security", "Performance", "UI", "API", "Testing", "Documentation").
Return ONLY a JSON array of tag objects. Each object must have: name (string), category (string), description (string).
Categories: Core, Infrastructure, Quality, Feature, Security, Performance.
Generate 3-8 tags that best represent the commit themes. Prefer reusing existing tags when they match.`,

  l2_extractor: `You are an expert software architect analyzing VCS commit history.
Extract L2 nodes (packages/modules/components) and their associated L3 knowledge nodes.

L2 nodes = software components, modules, packages, or PCDs (Platform Configuration Databases for UEFI/firmware).
L3 nodes = implementation rules, technical decisions, change rationale, context.

Return ONLY a valid JSON array. Each L2 node:
{
  "name": "component-name",
  "type": "module" | "package" | "pcd",
  "description": "what this component does",
  "l1TagNames": ["matching tag names from the available list"],
  "l3Nodes": [
    {
      "title": "concise title",
      "nodeType": "change" | "rule" | "decision" | "context",
      "content": "detailed explanation",
      "commitHash": "8-char hash from [xxxxxxxx] prefix or empty string",
      "confidence": 0.0 to 1.0
    }
  ]
}

confidence: 1.0 = certain/explicit in commits, 0.7 = inferred with high confidence, 0.4 = speculative.
Generate 2-6 L2 nodes with 1-3 L3 nodes each.`,

  l3_generator: `You are an expert software architect extracting implementation knowledge.
Generate detailed L3 knowledge nodes (implementation rules, technical decisions, rationale, context) from the given commits and module context.
Focus on: WHY decisions were made, HOW things work, WHAT constraints exist, WHEN patterns apply.
Return ONLY a valid JSON array of L3 node objects.`,
};
