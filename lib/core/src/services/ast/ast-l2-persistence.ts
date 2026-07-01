import { db } from "@workspace/db";
import { l2NodesTable } from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
import { IAstL2Persistence } from "../../interfaces/ast-ingestion.interfaces.js";
import { FileEvent, IngestionResult, L2ProcessingResult } from "../../types/ast-ingestion.types.js";
import { chunkArray } from "../../utils/array-utils.js";

const BATCH_INSERT_CHUNK = 500;

export class AstL2PersistenceService implements IAstL2Persistence {
  public async processBatchL2Nodes(
    projectId: number,
    fileEvents: FileEvent[],
    result: IngestionResult
  ): Promise<L2ProcessingResult> {
    const filePathToL2Id = new Map<string, number>();
    const pathToL2Id = new Map<string, number>();

    const seenFilePaths = new Set<string>();
    const uniqueFileEvents: FileEvent[] = [];
    for (const fe of fileEvents) {
      if (!seenFilePaths.has(fe.filePath)) {
        seenFilePaths.add(fe.filePath);
        uniqueFileEvents.push(fe);
      }
    }

    const existingL2Nodes = await db
      .select()
      .from(l2NodesTable)
      .where(eq(l2NodesTable.projectId, projectId));

    const nameToL2Ids = new Map<string, number[]>();
    for (const node of existingL2Nodes) {
      nameToL2Ids.set(node.name, [...(nameToL2Ids.get(node.name) || []), node.id]);
      if (node.pathPatterns) {
        const patterns = Array.isArray(node.pathPatterns) ? (node.pathPatterns as string[]) : [];
        for (const p of patterns) {
          pathToL2Id.set(p, node.id);
        }
      }
    }

    const toInsert: FileEvent[] = [];
    for (const fe of uniqueFileEvents) {
      const existingId = pathToL2Id.get(fe.pathPatterns[0]) || pathToL2Id.get(fe.filePath);
      if (existingId) {
        filePathToL2Id.set(fe.filePath, existingId);
      } else {
        const candidates = nameToL2Ids.get(fe.baseName);
        let matched = false;
        if (candidates) {
          for (const candId of candidates) {
            const candNode = existingL2Nodes.find((n) => n.id === candId);
            if (candNode?.pathPatterns) {
              const patterns = Array.isArray(candNode.pathPatterns)
                ? (candNode.pathPatterns as string[])
                : [];
              if (patterns.some((p) => p === fe.pathPatterns[0] || p === fe.filePath)) {
                filePathToL2Id.set(fe.filePath, candId);
                matched = true;
                break;
              }
            }
          }
          if (!matched && candidates.length > 0) {
            filePathToL2Id.set(fe.filePath, candidates[0]);
            matched = true;
          }
        }
        if (!matched) {
          toInsert.push(fe);
        }
      }
    }

    if (toInsert.length > 0) {
      const insertValues = toInsert.map((fe) => ({
        projectId,
        name: fe.baseName,
        type: fe.l2Type,
        aiGenerated: true,
        needsReview: true,
        description: `AST parsed from ${fe.filePath}`,
        pathPatterns: fe.pathPatterns,
      }));

      const chunks = chunkArray(insertValues, BATCH_INSERT_CHUNK);
      for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
        const chunk = chunks[chunkIndex];
        const inserted = await db
          .insert(l2NodesTable)
          .values(chunk)
          .onConflictDoNothing()
          .returning({ id: l2NodesTable.id, name: l2NodesTable.name });

        for (const insertedNode of inserted) {
          const startIdx = chunkIndex * BATCH_INSERT_CHUNK;
          const chunkEvents = toInsert.slice(startIdx, startIdx + BATCH_INSERT_CHUNK);
          const matchingEvent = chunkEvents.find(
            (fe) => fe.baseName === insertedNode.name && !filePathToL2Id.has(fe.filePath)
          );
          if (matchingEvent) {
            filePathToL2Id.set(matchingEvent.filePath, insertedNode.id);
            pathToL2Id.set(matchingEvent.pathPatterns[0], insertedNode.id);
          }
        }
      }

      const unresolvedFiles = toInsert.filter((fe) => !filePathToL2Id.has(fe.filePath));
      if (unresolvedFiles.length > 0) {
        const allPatterns = unresolvedFiles.flatMap((fe) => fe.pathPatterns);
        const conditions = allPatterns.map(
          (p) => sql`${l2NodesTable.pathPatterns}::text LIKE ${`%${p}%`}`
        );
        const combinedCondition =
          conditions.length === 1 ? conditions[0] : sql.join(conditions, sql` OR `);
        const reloaded = await db
          .select()
          .from(l2NodesTable)
          .where(and(eq(l2NodesTable.projectId, projectId), combinedCondition));

        for (const fe of unresolvedFiles) {
          const match = reloaded.find((n) => {
            if (!n.pathPatterns) return false;
            const patterns = Array.isArray(n.pathPatterns) ? (n.pathPatterns as string[]) : [];
            return patterns.some((p) => p === fe.pathPatterns[0] || p === fe.filePath);
          });
          if (match) {
            filePathToL2Id.set(fe.filePath, match.id);
          }
        }
      }

      result.l2Created = toInsert.length;
    }

    return { filePathToL2Id, pathToL2Id };
  }

  public async batchInsertL2Nodes(
    nodes: Array<{
      projectId: number;
      name: string;
      type: "package" | "module" | "pcd";
      aiGenerated: boolean;
      needsReview: boolean;
      description: string;
      pathPatterns: string[];
    }>
  ): Promise<void> {
    const chunks = chunkArray(nodes, BATCH_INSERT_CHUNK);
    for (const chunk of chunks) {
      await db.insert(l2NodesTable).values(chunk).onConflictDoNothing();
    }
  }
}
