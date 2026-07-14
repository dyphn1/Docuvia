/** Progress/result messages for the `analyze` workflow. */
export const ANALYZE_MESSAGES = {
  ANALYZING: "Analyzing project...",
  EXTRACTING: (targetPath: string) =>
    `Extracting decisions from ${targetPath}...`,
  FILES_DROPPED: (count: number) =>
    `Dropped ${count} file(s) from decision extraction (file-count/byte cap)`,
} as const;

/**
 * System prompt for the focused decision-extraction LLM call — verbatim port of old Docuvia's
 * `DEFAULT_PROMPTS.path_decision_extractor` (`d:\GitHub\Docuvia\lib\core\src\utils\prompts.ts`).
 */
export const DECISION_EXTRACTION_SYSTEM_PROMPT = `You are an expert software architect reviewing source code directly (not commit history).
Extract concrete implementation decisions, architectural rules, notable constraints, and rationale that are evident from the code itself — not speculative commentary.
Return ONLY a valid JSON array. Each item:
{ "title": "concise title", "nodeType": "change" | "rule" | "decision" | "context", "content": "detailed explanation grounded in what the code actually does", "confidence": 0.0 to 1.0 }
If the code contains no decision-worthy content, return an empty array — do not fabricate entries.
OUTPUT MUST BE VALID JSON ONLY. NO MARKDOWN WRAPPERS. DO NOT OUTPUT \`\`\`json.`;
