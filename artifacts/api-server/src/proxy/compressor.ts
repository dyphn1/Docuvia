import crypto from "crypto";
import { saveCompressedPayload } from "../memory/shared-memory.js";

export function dumbTextCrusher(code: string): string {
  // Replace { ... } blocks with { /* ... */ } while keeping top-level signatures.
  // A simplified regex approach.
  return code.replace(/\{[\s\S]*?\}/g, "{ /* ... */ }");
}

export function mockGetAstSkeleton(path: string, code: string): string {
  const id = crypto.randomUUID();
  saveCompressedPayload(id, code);
  return `// [COMPRESSED_SKELETON_ID: ${id}]\n// Skeleton for ${path}\nfunction skeleton() { /* ... */ }`;
}

interface CodeBlock {
  match: string;
  index: number;
  path?: string;
  isHeuristic?: boolean;
  innerCode: string;
  type: "markdown" | "xml";
}

export function extractCodeBlocks(text: string): CodeBlock[] {
  const blocks: CodeBlock[] = [];

  // Fast Path: markdown code fences with optional path
  const mdRegex =
    /```[\w]*\s*(?:<!--\s*([^\n]+)\s*-->|(?:\/\/\s*|#\s*)([\w./-]+))?\s*\n([\s\S]*?)```/g;
  let match;
  while ((match = mdRegex.exec(text)) !== null) {
    // match[1] or match[2] could be the path if it's on the first line
    let path = match[1] || match[2];
    const innerCode = match[3];
    if (!path) {
      // Simple heuristic for path extraction from first line of code block
      const lines = innerCode.split("\n");
      const firstLine = lines[0]?.trim();
      if (firstLine && (firstLine.startsWith("//") || firstLine.startsWith("#"))) {
        const possiblePath = firstLine.replace(/^(\/\/|#)\s*/, "").trim();
        if (possiblePath.includes(".")) {
          path = possiblePath;
        }
      }
    }
    blocks.push({
      match: match[0],
      index: match.index,
      path: path,
      innerCode: innerCode,
      type: "markdown",
    });
  }

  // Fast Path: XML-like tags <file path="...">...</file>
  const xmlRegex = /<file\s+path="([^"]+)">([\s\S]*?)<\/file>/g;
  while ((match = xmlRegex.exec(text)) !== null) {
    blocks.push({
      match: match[0],
      index: match.index,
      path: match[1],
      innerCode: match[2],
      type: "xml",
    });
  }

  return blocks;
}

export function compressPrompt(text: string): { compressedText: string; hasChanges: boolean } {
  let hasChanges = false;
  let compressedText = text;

  // Detect blocks
  const blocks = extractCodeBlocks(text);

  // If blocks are found, we replace them in reverse order to avoid index shifting if we used slicing

  // Fallback: if no fast path blocks are found, check heuristic fallback on the whole text
  if (blocks.length === 0) {
    const lines = text.split("\n");
    if (lines.length > 500) {
      const functionCount = (text.match(/function/g) || []).length;
      const classCount = (text.match(/class/g) || []).length;
      const braceCount = (text.match(/[{}]/g) || []).length;

      // Heuristic threshold
      if (functionCount + classCount > 5 && braceCount > 20) {
        // Scheme B: Context Missing
        const id = crypto.randomUUID();
        saveCompressedPayload(id, text);
        const crushed = dumbTextCrusher(text);
        return {
          compressedText: `// [COMPRESSED_SKELETON_ID: ${id}]\n` + crushed,
          hasChanges: true,
        };
      }
    }
    return { compressedText, hasChanges };
  }

  // Sort blocks by index descending so we can replace them without messing up indices
  blocks.sort((a, b) => b.index - a.index);

  for (const block of blocks) {
    if (block.match.length > 500) {
      hasChanges = true;
      let replacement = block.match;

      if (block.type === "markdown") {
        if (block.path) {
          replacement = `\`\`\`\n${mockGetAstSkeleton(block.path, block.innerCode)}\n\`\`\``;
        } else {
          const id = crypto.randomUUID();
          saveCompressedPayload(id, block.match);
          replacement = `\`\`\`\n// [COMPRESSED_SKELETON_ID: ${id}]\n${dumbTextCrusher(block.innerCode)}\n\`\`\``;
        }
      } else if (block.type === "xml") {
        if (block.path) {
          replacement = `<file path="${block.path}">\n${mockGetAstSkeleton(block.path, block.innerCode)}\n</file>`;
        } else {
          const id = crypto.randomUUID();
          saveCompressedPayload(id, block.match);
          replacement = `<file>\n// [COMPRESSED_SKELETON_ID: ${id}]\n${dumbTextCrusher(block.innerCode)}\n</file>`;
        }
      }

      compressedText =
        compressedText.substring(0, block.index) +
        replacement +
        compressedText.substring(block.index + block.match.length);
    }
  }

  return { compressedText, hasChanges };
}
