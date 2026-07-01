import path from "node:path";
import { db } from "@workspace/db";
import { l2NodesTable, nodeLinksTable, activityLogTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { IAstEdgePersistence } from "../../interfaces/ast-ingestion.interfaces.js";
import {
  ImportEvent,
  CallEvent,
  ContractEvent,
  IngestionResult,
} from "../../types/ast-ingestion.types.js";
import { chunkArray } from "../../utils/array-utils.js";
import { logger } from "../../utils/logger.js";

const BATCH_INSERT_CHUNK = 500;

export class AstEdgePersistenceService implements IAstEdgePersistence {
  private getDirectoryPath(filePath: string): string {
    const normalized = filePath.split(path.sep).join("/");
    const lastSlash = normalized.lastIndexOf("/");
    return lastSlash > 0 ? normalized.substring(0, lastSlash) : ".";
  }

  public async processBatchLinks(
    projectId: number,
    importEvents: ImportEvent[],
    callEvents: CallEvent[],
    contractEvents: ContractEvent[],
    filePathToL2Id: Map<string, number>,
    pathToL2Id: Map<string, number>,
    fqnToL3Id: Map<string, number>,
    contractEndpointToL3Id: Map<string, number>,
    nameToL3Id: Map<string, number>,
    l3IdToL2Id: Map<number, number>,
    contractPathToL2Id: Map<string, number>,
    result: IngestionResult
  ): Promise<void> {
    const endpointEvents = contractEvents.filter((e) => !!e.method);
    const existingL2Nodes = await db
      .select()
      .from(l2NodesTable)
      .where(eq(l2NodesTable.projectId, projectId));
    const nameToL2Ids = new Map<string, number[]>();
    for (const node of existingL2Nodes) {
      nameToL2Ids.set(node.name, [...(nameToL2Ids.get(node.name) || []), node.id]);
    }

    const pendingLinks: Array<{
      sourceNodeId: number;
      targetNodeId: number;
      linkType: "depends_on" | "calls";
    }> = [];
    const seenLinks = new Set<string>();

    function queueLink(
      sourceNodeId: number,
      targetNodeId: number,
      linkType: "depends_on" | "calls"
    ): void {
      if (sourceNodeId === targetNodeId) return;
      const key = `${sourceNodeId}:${targetNodeId}:${linkType}`;
      if (seenLinks.has(key)) return;
      seenLinks.add(key);
      pendingLinks.push({ sourceNodeId, targetNodeId, linkType });
    }

    for (const imp of importEvents) {
      const sourceL2Id = filePathToL2Id.get(imp.importerFilePath);
      if (!sourceL2Id) continue;

      let targetL2Id: number | null = null;
      const currentDir = this.getDirectoryPath(imp.importerFilePath);

      if (imp.source.startsWith("./") || imp.source.startsWith("../")) {
        const resolvedPath = path.resolve(currentDir, imp.source);
        for (const [pattern, id] of pathToL2Id) {
          if (pattern.includes(resolvedPath) || resolvedPath.includes(pattern.replace("/*", ""))) {
            targetL2Id = id;
            break;
          }
        }
        if (!targetL2Id) {
          const extensions = [
            ".ts",
            ".tsx",
            ".js",
            ".jsx",
            ".py",
            ".rs",
            ".go",
            ".java",
            ".rb",
            ".php",
            ".cs",
          ];
          for (const ext of extensions) {
            const candidate = resolvedPath + ext;
            for (const [pattern, id] of pathToL2Id) {
              if (pattern.includes(candidate) || candidate.includes(pattern.replace("/*", ""))) {
                targetL2Id = id;
                break;
              }
            }
            if (targetL2Id) break;
          }
        }
      } else {
        for (const [pattern, id] of pathToL2Id) {
          if (pattern.includes(imp.source)) {
            targetL2Id = id;
            break;
          }
        }
      }

      if (targetL2Id && targetL2Id !== sourceL2Id) {
        queueLink(sourceL2Id, targetL2Id, "depends_on");
      }
    }

    for (const call of callEvents) {
      const callerL2Id = filePathToL2Id.get(call.callerFilePath);
      if (!callerL2Id) continue;

      let targetL3Id = fqnToL3Id.get(call.name) || nameToL3Id.get(call.name);

      if (!targetL3Id) {
        const parts = call.name.split("::");
        if (parts.length >= 2) {
          targetL3Id = fqnToL3Id.get(call.name);
          if (!targetL3Id) {
            const simpleName = parts[parts.length - 1];
            targetL3Id = nameToL3Id.get(simpleName);
          }
        }
      }

      if (!targetL3Id) {
        const simpleName = call.name.split("::").pop()?.split(".").pop() || call.name;
        targetL3Id = nameToL3Id.get(simpleName);
      }

      if (targetL3Id) {
        const targetL2Id = l3IdToL2Id.get(targetL3Id);
        if (targetL2Id && targetL2Id !== callerL2Id) {
          queueLink(callerL2Id, targetL2Id, "calls");
        }
      }
    }

    if (endpointEvents.length > 0) {
      for (const ep of endpointEvents) {
        if (!ep.consumers || ep.consumers.length === 0) continue;
        const contractL2Id = contractPathToL2Id.get(ep.filePath);
        if (!contractL2Id) continue;

        for (const consumerHint of ep.consumers) {
          let consumerL2Id: number | null = null;

          for (const [pattern, id] of pathToL2Id) {
            if (
              pattern.includes(consumerHint) ||
              consumerHint.includes(pattern.replace("/*", ""))
            ) {
              consumerL2Id = id;
              break;
            }
          }

          if (!consumerL2Id) {
            const candidates = nameToL2Ids.get(consumerHint);
            if (candidates && candidates.length > 0) {
              consumerL2Id = candidates[0];
            }
          }

          if (!consumerL2Id) {
            const l3Id = nameToL3Id.get(consumerHint);
            if (l3Id) {
              consumerL2Id = l3IdToL2Id.get(l3Id) || null;
            }
          }

          if (consumerL2Id && consumerL2Id !== contractL2Id) {
            queueLink(consumerL2Id, contractL2Id, "calls");
          }
        }
      }
    }

    if (pendingLinks.length > 0) {
      try {
        result.linksCreated = await this.batchInsertLinks(pendingLinks);
      } catch (batchErr: any) {
        result.errors.push(`Batch link insert error: ${batchErr.message}`);
      }
    }

    if (result.l2Created > 0 || result.l3Created > 0 || result.contractsCreated > 0) {
      await db.insert(activityLogTable).values({
        type: "tag_added",
        description: `AST ingestion: ${result.l2Created} modules, ${result.l3Created} symbols, ${result.linksCreated} links, ${result.contractsCreated} contracts`,
        projectId,
      });
    }

    logger.info({ projectId, result }, "AST ingestion completed (batch optimized)");
  }

  public async batchInsertLinks(
    links: Array<{
      sourceNodeId: number;
      targetNodeId: number;
      linkType: "depends_on" | "calls";
    }>
  ): Promise<number> {
    if (links.length === 0) return 0;
    const chunks = chunkArray(links, BATCH_INSERT_CHUNK);
    let inserted = 0;
    for (const chunk of chunks) {
      await db.insert(nodeLinksTable).values(chunk).onConflictDoNothing();
      inserted += chunk.length;
    }
    return inserted;
  }
}
