import fs from "node:fs";
import readline from "node:readline";
import path from "node:path";
import { db } from "@workspace/db";
import {
  l2NodesTable,
  l3NodesTable,
  nodeLinksTable,
  activityLogTable,
} from "@workspace/db";
import { eq, and, sql, inArray } from "drizzle-orm";
import { logger } from "./logger.js";

/**
 * AST Ingestion Pipeline — Topology Mapping
 *
 * Reads .jsonl skeleton files produced by ast-worker and writes the
 * extracted symbols into the Docuvia knowledge graph (l2_nodes, l3_nodes, node_links).
 *
 * Topology Mapping (Phase 8 — Item 1):
 *   file event   → l2_nodes (type: package | module | pcd, with pathPatterns)
 *   class event  → l3_nodes (nodeType: rule, FQN: dir::Class, under parent L2)
 *   function event → l3_nodes (nodeType: change, FQN: dir::fn, under parent L2)
 *   call / method_call → node_links (depends_on edge from caller → callee)
 *
 * FQN Convention:
 *   L3 nodes use directory-based namespace: `src/utils/helper.ts::MyClass`
 *   This ensures uniqueness across files with same base name in different dirs.
 *
 * L2 Type Classification:
 *   - package: directory containing an index file (index.ts, __init__.py, mod.rs, etc.)
 *   - module: standalone source file
 *   - pcd: pattern-matched cluster (multiple files sharing a glob pattern)
 */

interface AstEvent {
  type: "file" | "class" | "function" | "call" | "method_call";
  path?: string;
  name?: string;
  method?: string;
  object?: string;
  [key: string]: unknown;
}

export interface IngestionResult {
  l2Created: number;
  l3Created: number;
  linksCreated: number;
  errors: string[];
}

// ── Index files that indicate a directory is a "package" ──────────────
const PACKAGE_INDEX_FILES = new Set([
  "index.ts",
  "index.js",
  "index.tsx",
  "index.jsx",
  "__init__.py",
  "mod.rs",
  "lib.rs",
  "main.go",
  "package.java",
  "index.php",
  "index.rb",
]);

/**
 * Derive a Fully Qualified Name for an L3 symbol.
 * Format: `dir1/dir2/file.ext::symbolName`
 * The file part uses forward slashes (normalized) and includes the extension
 * to disambiguate files with the same name in different directories.
 */
function buildFqn(filePath: string, symbolName: string): string {
  const normalized = filePath.split(path.sep).join("/");
  return `${normalized}::${symbolName}`;
}

/**
 * Derive the directory path from a file path (normalized to forward slashes).
 */
function getDirectoryPath(filePath: string): string {
  const normalized = filePath.split(path.sep).join("/");
  const lastSlash = normalized.lastIndexOf("/");
  return lastSlash > 0 ? normalized.substring(0, lastSlash) : ".";
}

/**
 * Classify an L2 node type based on the file path.
 * - package: the file is an index file (marks its directory as a package)
 * - module: a regular source file
 * - pcd: (reserved for future pattern-based clustering)
 */
function classifyL2Type(filePath: string): "package" | "module" | "pcd" {
  const baseName = filePath.split(path.sep).pop() || filePath;
  if (PACKAGE_INDEX_FILES.has(baseName)) {
    return "package";
  }
  return "module";
}

/**
 * Build a path pattern for an L2 node.
 * For a package (index file), the pattern matches all files in that directory.
 * For a module, the pattern is the file itself.
 */
function buildPathPattern(filePath: string, l2Type: string): string[] {
  const normalized = filePath.split(path.sep).join("/");
  if (l2Type === "package") {
    // Index file → pattern covers the directory
    const dirPath = getDirectoryPath(normalized);
    return [`${dirPath}/*`];
  }
  return [normalized];
}

/**
 * Ingest a single .jsonl skeleton file into the database.
 * Each file represents one source file's AST extraction.
 *
 * @param jsonlPath - Path to the .jsonl file produced by ast-worker
 * @param projectId - The project ID to associate nodes with
 */
export async function ingestAstJsonl(
  jsonlPath: string,
  projectId: number
): Promise<IngestionResult> {
  const result: IngestionResult = {
    l2Created: 0,
    l3Created: 0,
    linksCreated: 0,
    errors: [],
  };

  const fileStream = fs.createReadStream(jsonlPath, { encoding: "utf-8" });
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

  let currentL2Id: number | null = null;
  let currentFilePath: string | null = null;

  // FQN → L3 ID mapping for link resolution within this file
  const fqnToL3Id = new Map<string, number>();

  // Simple name → L3 ID (fallback for unqualified calls)
  const nameToL3Id = new Map<string, number>();

  // Track all L3 nodes created in this file for link resolution
  const allL3Nodes: { id: number; name: string; fqn: string; l2NodeId: number }[] = [];

  // Collect all L2 and L3 inserts for batch processing
  const pendingL2Inserts: Array<{
    projectId: number;
    name: string;
    type: "package" | "module" | "pcd";
    aiGenerated: boolean;
    needsReview: boolean;
    description: string;
    pathPatterns: string[];
  }> = [];

  // Track which file paths we've already processed in this run
  const processedFilePaths = new Set<string>();

  for await (const line of rl) {
    if (!line.trim()) continue;

    let event: AstEvent;
    try {
      event = JSON.parse(line) as AstEvent;
    } catch (err: any) {
      result.errors.push(`JSON parse error: ${err.message}`);
      continue;
    }

    try {
      // ── File → L2 Node ──────────────────────────────────────────
      if (event.type === "file") {
        const filePath = event.path as string;
        if (!filePath) {
          result.errors.push("File event missing path");
          continue;
        }
        currentFilePath = filePath;

        // Skip if we've already processed this file in this batch
        if (processedFilePaths.has(filePath)) continue;
        processedFilePaths.add(filePath);

        const baseName = filePath.split(/[/\\]/).pop() || filePath;
        const dirPath = getDirectoryPath(filePath);
        const l2Type = classifyL2Type(filePath);
        const pathPatterns = buildPathPattern(filePath, l2Type);

        // Check if an L2 node already exists for this file (by path pattern match)
        const existingNodes = await db
          .select()
          .from(l2NodesTable)
          .where(
            and(
              eq(l2NodesTable.projectId, projectId),
              eq(l2NodesTable.name, baseName)
            )
          );

        // Find the best match: prefer one with matching path pattern
        let matchedL2 = existingNodes.find((n) => {
          if (!n.pathPatterns) return false;
          const patterns = Array.isArray(n.pathPatterns) ? n.pathPatterns as string[] : [];
          return patterns.some((p) => p === pathPatterns[0] || p === filePath);
        });

        // If no pattern match, use the first one with the same base name
        if (!matchedL2 && existingNodes.length > 0) {
          matchedL2 = existingNodes[0];
        }

        if (matchedL2) {
          currentL2Id = matchedL2.id;
        } else {
          const [newNode] = await db
            .insert(l2NodesTable)
            .values({
              projectId,
              name: baseName,
              type: l2Type,
              aiGenerated: true,
              needsReview: true,
              description: `AST parsed from ${filePath}`,
              pathPatterns,
            })
            .returning();

          currentL2Id = newNode.id;
          result.l2Created++;
        }
      }

      // ── Class → L3 Node ─────────────────────────────────────────
      if (event.type === "class" && currentL2Id !== null) {
        const className = event.name as string;
        if (!className) continue;

        const filePath = currentFilePath || "unknown";
        const fqn = buildFqn(filePath, className);

        const [newL3] = await db
          .insert(l3NodesTable)
          .values({
            l2NodeId: currentL2Id,
            title: className,
            nodeType: "rule",
            aiGenerated: true,
            source: "ast",
            content: `Class definition: ${fqn}`,
          })
          .returning();

        fqnToL3Id.set(fqn, newL3.id);
        nameToL3Id.set(className, newL3.id);
        allL3Nodes.push({ id: newL3.id, name: className, fqn, l2NodeId: currentL2Id });
        result.l3Created++;
      }

      // ── Function → L3 Node ──────────────────────────────────────
      if (event.type === "function" && currentL2Id !== null) {
        const fnName = event.name as string;
        if (!fnName) continue;

        const filePath = currentFilePath || "unknown";
        const fqn = buildFqn(filePath, fnName);

        const [newL3] = await db
          .insert(l3NodesTable)
          .values({
            l2NodeId: currentL2Id,
            title: fnName,
            nodeType: "change",
            aiGenerated: true,
            source: "ast",
            content: `Function definition: ${fqn}`,
          })
          .returning();

        fqnToL3Id.set(fqn, newL3.id);
        nameToL3Id.set(fnName, newL3.id);
        allL3Nodes.push({ id: newL3.id, name: fnName, fqn, l2NodeId: currentL2Id });
        result.l3Created++;
      }

      // ── Call / Method Call → Node Link ──────────────────────────
      if (event.type === "call" || event.type === "method_call") {
        if (allL3Nodes.length === 0) continue;

        const callName = (event.name || event.method || "") as string;
        if (!callName) continue;

        // The last function/class defined in this file is the caller
        const caller = allL3Nodes[allL3Nodes.length - 1];

        // Try to resolve the callee by FQN first, then by simple name
        let targetL3Id = fqnToL3Id.get(callName) || nameToL3Id.get(callName);

        // If not found locally, try to resolve via scope map format (module::symbol)
        if (!targetL3Id) {
          const parts = callName.split("::");
          if (parts.length >= 2) {
            // Try the full call name as FQN
            targetL3Id = fqnToL3Id.get(callName);
            // Try just the symbol name (last part)
            if (!targetL3Id) {
              const simpleName = parts[parts.length - 1];
              targetL3Id = nameToL3Id.get(simpleName);
            }
          }
        }

        // If still not found, try cross-file resolution via DB
        if (!targetL3Id) {
          const simpleName = callName.split("::").pop()?.split(".").pop() || callName;
          const [targetL3] = await db
            .select()
            .from(l3NodesTable)
            .where(eq(l3NodesTable.title, simpleName))
            .limit(1);

          if (targetL3) {
            targetL3Id = targetL3.id;
          }
        }

        if (targetL3Id && targetL3Id !== caller.id) {
          try {
            // node_links references l2_nodes, so we create an L2-level dependency
            // from caller's module to the callee's module
            const [targetL3Node] = await db
              .select()
              .from(l3NodesTable)
              .where(eq(l3NodesTable.id, targetL3Id))
              .limit(1);

            if (targetL3Node && targetL3Node.l2NodeId !== caller.l2NodeId) {
              await db
                .insert(nodeLinksTable)
                .values({
                  sourceNodeId: caller.l2NodeId,
                  targetNodeId: targetL3Node.l2NodeId,
                  linkType: "depends_on",
                })
                .onConflictDoNothing();
              result.linksCreated++;
            }
          } catch (linkErr: any) {
            if (!linkErr.message?.includes("duplicate")) {
              result.errors.push(`Link error: ${linkErr.message}`);
            }
          }
        }
      }
    } catch (err: any) {
      result.errors.push(`Event processing error (${event.type}): ${err.message}`);
    }
  }

  // Log activity
  if (result.l2Created > 0 || result.l3Created > 0) {
    await db.insert(activityLogTable).values({
      type: "tag_added",
      description: `AST ingestion: ${result.l2Created} modules, ${result.l3Created} symbols, ${result.linksCreated} links`,
      projectId,
    });
  }

  logger.info(
    { projectId, jsonlPath, result },
    "AST ingestion completed"
  );

  return result;
}

/**
 * Ingest multiple .jsonl files (batch processing for a project).
 * Processes files sequentially to maintain consistent L2/L3 name resolution.
 */
export async function ingestAstBatch(
  jsonlPaths: string[],
  projectId: number
): Promise<IngestionResult> {
  const aggregated: IngestionResult = {
    l2Created: 0,
    l3Created: 0,
    linksCreated: 0,
    errors: [],
  };

  for (const path of jsonlPaths) {
    try {
      const result = await ingestAstJsonl(path, projectId);
      aggregated.l2Created += result.l2Created;
      aggregated.l3Created += result.l3Created;
      aggregated.linksCreated += result.linksCreated;
      aggregated.errors.push(...result.errors);
    } catch (err: any) {
      aggregated.errors.push(`Failed to ingest ${path}: ${err.message}`);
    }
  }

  return aggregated;
}
