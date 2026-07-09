import { loadDefaultRegistry } from "@workspace/plugins-ast";
import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import { createRequire } from "module";
import { saveCompressedPayload } from "../memory/shared-memory.js";
import { COMPRESSOR_DEFAULTS } from "../constants/index.js";

const require = createRequire(import.meta.url);

export function dumbTextCrusher(code: string): string {
  // Replace { ... } blocks with { /* ... */ } while keeping top-level signatures.
  // A simplified regex approach.
  return code.replace(/\{[\s\S]*?\}/g, COMPRESSOR_DEFAULTS.DUMB_CRUSHER_REPLACEMENT);
}

let parserInitialized = false;

export async function getAstSkeleton(filePath: string, code: string): Promise<string> {
  const id = crypto.randomUUID();
  saveCompressedPayload(id, code);

  let skeleton = code;
  try {
    const { LanguageRegistry, ParsingFunnel, initParser } = await import("@workspace/ast-core");
    const { Parser, Language } = await import("web-tree-sitter");

    if (!parserInitialized) {
      await initParser((scriptName) => {
        try {
          return require.resolve(`web-tree-sitter/${scriptName}`);
        } catch {
          return path.resolve(
            process.cwd(),
            COMPRESSOR_DEFAULTS.WASM_NOT_FOUND_FALLBACK_DIR,
            "web-tree-sitter",
            scriptName
          );
        }
      });
      parserInitialized = true;
    }

    const registry = await loadDefaultRegistry();
    const funnel = new ParsingFunnel(registry);
    const ext = path.extname(filePath);
    const funnelRes = funnel.process(code, filePath, ext);

    if (funnelRes.accepted && funnelRes.mappedExtension) {
      const provider = registry.getProviderForExtension(funnelRes.mappedExtension);
      if (provider) {
        let wasmPath = "";
        try {
          wasmPath = path.resolve(
            require.resolve(COMPRESSOR_DEFAULTS.PKG_TREE_SITTER_WASMS),
            "..",
            COMPRESSOR_DEFAULTS.DIR_OUT,
            provider.wasm_file
          );
        } catch (err) {
          wasmPath = path.resolve(
            process.cwd(),
            COMPRESSOR_DEFAULTS.WASM_NOT_FOUND_FALLBACK_DIR,
            "tree-sitter-wasms",
            COMPRESSOR_DEFAULTS.DIR_OUT,
            provider.wasm_file
          );
        }

        const wasmBytes = await fs.readFile(wasmPath);
        const lang = await Language.load(wasmBytes);
        const parser = new Parser();
        parser.setLanguage(lang);

        if ("initQueries" in provider && typeof (provider as any).initQueries === "function") {
          (provider as any).initQueries(lang);
        }

        const tree = parser.parse(code);
        if (tree) {
          const classes = provider.extractClasses(tree.rootNode);
          const functions = provider.extractFunctions(tree.rootNode);

          const nodes = [...classes, ...functions].sort((a, b) => b.startIndex - a.startIndex);
          // Filter out nodes that are contained within other nodes (to avoid overlapping replacements)
          const topLevelNodes = nodes.filter(
            (n) =>
              !nodes.some(
                (other) =>
                  other !== n && other.startIndex <= n.startIndex && other.endIndex >= n.endIndex
              )
          );

          for (const node of topLevelNodes) {
            const crushed = dumbTextCrusher(node.text);
            skeleton =
              skeleton.substring(0, node.startIndex) + crushed + skeleton.substring(node.endIndex);
          }
        }

        parser.delete();
      }
    }
  } catch (err: any) {
    console.warn(`AST Skeleton generation failed for ${filePath}: ${err.message}`);
    skeleton = dumbTextCrusher(code); // fallback
  }

  return `${COMPRESSOR_DEFAULTS.SKELETON_PREFIX_ID}${id}${COMPRESSOR_DEFAULTS.SKELETON_SUFFIX_ID}${skeleton}`;
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
  const mdRegex = COMPRESSOR_DEFAULTS.MD_CODE_FENCE_REGEX;
  let match;
  while ((match = mdRegex.exec(text)) !== null) {
    // match[1] or match[2] could be the path if it's on the first line
    let path = match[1] || match[2];
    const innerCode = match[3];
    if (!path && innerCode) {
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
    if (innerCode) {
      blocks.push({
        match: match[0],
        index: match.index,
        path: path,
        innerCode: innerCode,
        type: COMPRESSOR_DEFAULTS.TYPE_MARKDOWN,
      });
    }
  }

  // Fast Path: XML-like tags <file path="...">...</file>
  const xmlRegex = COMPRESSOR_DEFAULTS.XML_FILE_TAG_REGEX;
  while ((match = xmlRegex.exec(text)) !== null) {
    blocks.push({
      match: match[0],
      index: match.index,
      path: match[1],
      innerCode: match[2],
      type: COMPRESSOR_DEFAULTS.TYPE_XML,
    });
  }

  return blocks;
}

export async function compressPrompt(
  text: string
): Promise<{ compressedText: string; hasChanges: boolean }> {
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
      if (
        functionCount + classCount > COMPRESSOR_DEFAULTS.MIN_LENGTH_FOR_HEURISTIC &&
        braceCount > 20
      ) {
        // Scheme B: Context Missing
        const id = crypto.randomUUID();
        saveCompressedPayload(id, text);
        const crushed = dumbTextCrusher(text);
        return {
          compressedText:
            `${COMPRESSOR_DEFAULTS.SKELETON_PREFIX_ID}${id}${COMPRESSOR_DEFAULTS.SKELETON_SUFFIX_ID}` +
            crushed,
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

      if (block.type === COMPRESSOR_DEFAULTS.TYPE_MARKDOWN) {
        if (block.path) {
          const skeletonStr = await getAstSkeleton(block.path, block.innerCode);
          replacement = `\`\`\`\n${skeletonStr}\n\`\`\``;
        } else {
          const id = crypto.randomUUID();
          saveCompressedPayload(id, block.match);
          replacement = `\`\`\`\n${COMPRESSOR_DEFAULTS.SKELETON_PREFIX_ID}${id}${COMPRESSOR_DEFAULTS.SKELETON_SUFFIX_ID}${dumbTextCrusher(block.innerCode)}\n\`\`\``;
        }
      } else if (block.type === COMPRESSOR_DEFAULTS.TYPE_XML) {
        if (block.path) {
          const skeletonStr = await getAstSkeleton(block.path, block.innerCode);
          replacement = `<file path="${block.path}">\n${skeletonStr}\n</file>`;
        } else {
          const id = crypto.randomUUID();
          saveCompressedPayload(id, block.match);
          replacement = `<file>\n${COMPRESSOR_DEFAULTS.SKELETON_PREFIX_ID}${id}${COMPRESSOR_DEFAULTS.SKELETON_SUFFIX_ID}${dumbTextCrusher(block.innerCode)}\n</file>`;
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
