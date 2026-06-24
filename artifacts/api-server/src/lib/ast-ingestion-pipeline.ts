import fs from "node:fs";
import readline from "node:readline";
import { db } from "@workspace/db";
import {
  l2NodesTable,
  l3NodesTable,
  nodeLinksTable,
  activityLogTable,
} from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
import { logger } from "./logger.js";

/**
 * AST Ingestion Pipeline
 *
 * Reads .jsonl skeleton files produced by ast-worker and writes the
 * extracted symbols into the Docuvia knowledge graph (l2_nodes, l3_nodes, node_links).
 *
 * Mapping:
 *   file event   → l2_nodes (type: module)
 *   class event  → l3_nodes (nodeType: rule, under parent file L2)
 *   function event → l3_nodes (nodeType: change, under parent file L2)
 *   call / method_call → node_links (depends_on edge from caller → callee)
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
  const nameToL3Id = new Map<string, number>();
  const baseNameToL2Id = new Map<string, number>();

  // Track all L3 nodes created in this file for link resolution
  const allL3Nodes: { id: number; name: string; l2NodeId: number }[] = [];

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
        const baseName = filePath.split(/[/\\]/).pop() || filePath;

        // Check if an L2 node already exists for this file
        const [existing] = await db
          .select()
          .from(l2NodesTable)
          .where(
            and(
              eq(l2NodesTable.projectId, projectId),
              eq(l2NodesTable.name, baseName)
            )
          );

        if (existing) {
          currentL2Id = existing.id;
          baseNameToL2Id.set(baseName, existing.id);
        } else {
          const [newNode] = await db
            .insert(l2NodesTable)
            .values({
              projectId,
              name: baseName,
              type: "module",
              aiGenerated: true,
              needsReview: true,
              description: `AST parsed from ${filePath}`,
            })
            .returning();

          currentL2Id = newNode.id;
          baseNameToL2Id.set(baseName, newNode.id);
          result.l2Created++;
        }
      }

      // ── Class → L3 Node ─────────────────────────────────────────
      if (event.type === "class" && currentL2Id !== null) {
        const className = event.name as string;
        if (!className) continue;

        const [newL3] = await db
          .insert(l3NodesTable)
          .values({
            l2NodeId: currentL2Id,
            title: className,
            nodeType: "rule",
            aiGenerated: true,
            source: "ast",
            content: `Class definition: ${className}`,
          })
          .returning();

        nameToL3Id.set(className, newL3.id);
        allL3Nodes.push({ id: newL3.id, name: className, l2NodeId: currentL2Id });
        result.l3Created++;
      }

      // ── Function → L3 Node ──────────────────────────────────────
      if (event.type === "function" && currentL2Id !== null) {
        const fnName = event.name as string;
        if (!fnName) continue;

        const [newL3] = await db
          .insert(l3NodesTable)
          .values({
            l2NodeId: currentL2Id,
            title: fnName,
            nodeType: "change",
            aiGenerated: true,
            source: "ast",
            content: `Function definition: ${fnName}`,
          })
          .returning();

        nameToL3Id.set(fnName, newL3.id);
        allL3Nodes.push({ id: newL3.id, name: fnName, l2NodeId: currentL2Id });
        result.l3Created++;
      }

      // ── Call / Method Call → Node Link ──────────────────────────
      if (event.type === "call" || event.type === "method_call") {
        if (allL3Nodes.length === 0) continue;

        const callName = (event.name || event.method || "") as string;
        if (!callName) continue;

        // The last function/class defined in this file is the caller
        const caller = allL3Nodes[allL3Nodes.length - 1];

        // Try to resolve the callee: first by full name, then by method name
        let targetL3Id = nameToL3Id.get(callName);

        // If not found locally, try to find an L2 node with the same name
        // (e.g., a call to a class constructor or module-level function)
        if (!targetL3Id) {
          const parts = callName.split("::");
          const simpleName = parts[parts.length - 1];
          targetL3Id = nameToL3Id.get(simpleName);
        }

        // If still not found, try to match against an L2 node (cross-file reference)
        if (!targetL3Id) {
          const [targetL2] = await db
            .select()
            .from(l2NodesTable)
            .where(
              and(
                eq(l2NodesTable.projectId, projectId),
                eq(l2NodesTable.name, callName.split("::").pop() || callName)
              )
            );
          if (targetL2) {
            // Create a link from caller L3 → target L2 (cross-file dependency)
            try {
              await db
                .insert(nodeLinksTable)
                .values({
                  sourceNodeId: caller.l2NodeId,
                  targetNodeId: targetL2.id,
                  linkType: "depends_on",
                })
                .onConflictDoNothing();
              result.linksCreated++;
            } catch (linkErr: any) {
              // Ignore duplicate link errors
              if (!linkErr.message?.includes("duplicate")) {
                result.errors.push(`Link error: ${linkErr.message}`);
              }
            }
            continue;
          }
        }

        if (targetL3Id && targetL3Id !== caller.id) {
          try {
            await db
              .insert(nodeLinksTable)
              .values({
                sourceNodeId: caller.l2NodeId,
                targetNodeId: caller.l2NodeId,
                linkType: "depends_on",
              })
              .onConflictDoNothing();
            // Note: node_links references l2_nodes, so for L3-to-L3 calls
            // we create an L2-level dependency (caller's module → callee's module)
            // For now we log the call event as a self-referencing dependency at L2
            result.linksCreated++;
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
