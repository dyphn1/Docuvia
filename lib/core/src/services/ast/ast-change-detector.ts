import fs from "node:fs";
import crypto from "node:crypto";
import { db } from "@workspace/db";
import { projectFilesTable, l2NodesTable } from "@workspace/db";
import { eq, and, inArray } from "drizzle-orm";
import {
  IAstChangeDetector,
  FileIngestRequest,
} from "../../interfaces/ast-ingestion.interfaces.js";
import { chunkArray } from "../../utils/array-utils.js";
import { logger } from "../../utils/logger.js";

export class AstChangeDetector implements IAstChangeDetector {
  public async computeFileHash(filePath: string): Promise<string | null> {
    try {
      const content = await fs.promises.readFile(filePath, "utf-8");
      return crypto.createHash("sha256").update(content).digest("hex");
    } catch {
      return null;
    }
  }

  public async detectChangedFiles(
    projectId: number,
    requests: FileIngestRequest[]
  ): Promise<Set<string>> {
    const changed = new Set<string>();
    const currentPaths = requests.map((r) => r.filePath);

    // 1. Process explicit renames first
    for (const req of requests) {
      if (req.oldPath && req.oldPath !== req.filePath) {
        logger.info(
          { oldPath: req.oldPath, newPath: req.filePath, projectId },
          "Processing explicit file rename. Inheriting history."
        );

        await db
          .update(projectFilesTable)
          .set({ filePath: req.filePath, lastParsedAt: new Date() })
          .where(
            and(
              eq(projectFilesTable.projectId, projectId),
              eq(projectFilesTable.filePath, req.oldPath)
            )
          );

        await db
          .update(l2NodesTable)
          .set({ name: req.filePath })
          .where(and(eq(l2NodesTable.projectId, projectId), eq(l2NodesTable.name, req.oldPath)));

        changed.add(req.filePath);
      }
    }

    if (currentPaths.length === 0) return changed;

    // 2. Fetch existing hashes for all current paths
    const existingFiles = await db
      .select()
      .from(projectFilesTable)
      .where(
        and(
          eq(projectFilesTable.projectId, projectId),
          inArray(projectFilesTable.filePath, currentPaths)
        )
      );

    const hashByPath = new Map<string, string>();
    for (const f of existingFiles) {
      hashByPath.set(f.filePath, f.contentHash || "");
    }

    // 3. Compare content hashes to find modified files
    const hashChecks = await Promise.all(
      requests.map(async (req) => {
        const hash = await this.computeFileHash(req.filePath);
        return { filePath: req.filePath, hash };
      })
    );

    for (const { filePath, hash } of hashChecks) {
      if (!hash) continue;

      if (!changed.has(filePath)) {
        const storedHash = hashByPath.get(filePath);
        if (storedHash !== hash) {
          changed.add(filePath);
        }
      }
    }

    return changed;
  }

  public async updateFileHashes(projectId: number, jsonlPaths: string[]): Promise<void> {
    const chunks = chunkArray(jsonlPaths, 500);
    for (const chunk of chunks) {
      const hashChecks = await Promise.all(
        chunk.map(async (filePath) => {
          const hash = await this.computeFileHash(filePath);
          return { projectId, filePath, hash };
        })
      );

      const values = hashChecks
        .filter((v) => v.hash !== null)
        .map((v) => ({
          projectId: v.projectId,
          filePath: v.filePath,
          contentHash: v.hash!,
          lastParsedAt: new Date(),
        }));

      if (values.length > 0) {
        await db.insert(projectFilesTable).values(values).onConflictDoNothing();
      }
    }
  }
}
