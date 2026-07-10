import { ENCODING_HEX, ENCODING_BASE64, HASH_ALGO_SHA256, HASH_ALGO_MD5 } from "@workspace/core";
import fs from "node:fs";
import crypto from "node:crypto";
import { db } from "@workspace/db";
import { projectFilesTable, l2NodesTable } from "@workspace/db";
import { eq, and, inArray, sql } from "drizzle-orm";
import {
  IAstChangeDetector,
  FileIngestRequest,
  FileChangeDetectionResult,
} from "../../interfaces/ast-ingestion.interfaces.js";
import { chunkArray } from "../../utils/array-utils.js";
import { logger } from "../../utils/logger.js";

export class AstChangeDetector implements IAstChangeDetector {
  public async computeFileHash(filePath: string): Promise<string | null> {
    try {
      const content = await fs.promises.readFile(filePath, "utf-8");
      return crypto.createHash(HASH_ALGO_SHA256).update(content).digest(ENCODING_HEX);
    } catch {
      return null;
    }
  }

  public async detectChangedFiles(
    projectId: number,
    requests: FileIngestRequest[]
  ): Promise<FileChangeDetectionResult> {
    const changed = new Set<string>();
    const hashes = new Map<string, string>();
    const duplicates = new Map<string, string[]>();
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

    if (currentPaths.length === 0) return { changed, hashes, duplicates };

    // 2. Fetch existing hashes for all current paths, chunked to stay under
    // Postgres's bound-parameter limit on large repos.
    const pathChunks = chunkArray(currentPaths, 500);
    const existingFiles = (
      await Promise.all(
        pathChunks.map((chunk) =>
          db
            .select()
            .from(projectFilesTable)
            .where(
              and(
                eq(projectFilesTable.projectId, projectId),
                inArray(projectFilesTable.filePath, chunk)
              )
            )
        )
      )
    ).flat();

    const hashByPath = new Map<string, string>();
    for (const f of existingFiles) {
      hashByPath.set(f.filePath, f.contentHash || "");
    }

    // 3. Compute hashes for all current files and track duplicates
    const hashChecks = await Promise.all(
      requests.map(async (req) => {
        const hash = await this.computeFileHash(req.filePath);
        return { filePath: req.filePath, hash };
      })
    );

    for (const { filePath, hash } of hashChecks) {
      if (!hash) continue;

      // Track hash mapping
      hashes.set(filePath, hash);

      // Track duplicates
      if (!duplicates.has(hash)) {
        duplicates.set(hash, []);
      }
      duplicates.get(hash)!.push(filePath);

      // Detect changes
      if (!changed.has(filePath)) {
        const storedHash = hashByPath.get(filePath);
        if (storedHash !== hash) {
          changed.add(filePath);
        }
      }
    }

    logger.info(
      {
        projectId,
        changedCount: changed.size,
        totalCount: currentPaths.length,
        duplicateGroups: duplicates.size,
      },
      "File change detection complete"
    );

    return { changed, hashes, duplicates };
  }

  public async detectChangedFilesLegacy(
    projectId: number,
    requests: FileIngestRequest[]
  ): Promise<Set<string>> {
    const result = await this.detectChangedFiles(projectId, requests);
    return result.changed;
  }

  public async updateFileHashes(projectId: number, jsonlPaths: string[]): Promise<void> {
    if (jsonlPaths.length === 0) return;

    // Compute hashes for all files in a single pass
    const hashChecks = await Promise.all(
      jsonlPaths.map(async (filePath) => {
        const hash = await this.computeFileHash(filePath);
        return { projectId, filePath, hash };
      })
    );

    // Prepare values for batch upsert
    const values = hashChecks
      .filter((v) => v.hash !== null)
      .map((v) => ({
        projectId: v.projectId,
        filePath: v.filePath,
        contentHash: v.hash!,
        lastParsedAt: new Date(),
      }));

    if (values.length === 0) return;

    // Single batch upsert operation: update if exists, insert if not
    await db
      .insert(projectFilesTable)
      .values(values)
      .onConflictDoUpdate({
        target: [projectFilesTable.projectId, projectFilesTable.filePath],
        set: {
          contentHash: sql`excluded.content_hash`,
          lastParsedAt: sql`excluded.last_parsed_at`,
        },
      });
  }
}
