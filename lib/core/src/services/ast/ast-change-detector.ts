import fs from "node:fs";
import crypto from "node:crypto";
import { db } from "@workspace/db";
import { projectFilesTable } from "@workspace/db";
import { eq, and, inArray } from "drizzle-orm";
import { IAstChangeDetector } from "../../interfaces/ast-ingestion.interfaces.js";
import { chunkArray } from "../../utils/array-utils.js";

export class AstChangeDetector implements IAstChangeDetector {
  public async computeFileHash(filePath: string): Promise<string | null> {
    try {
      const content = await fs.promises.readFile(filePath, "utf-8");
      return crypto.createHash("sha256").update(content).digest("hex");
    } catch {
      return null;
    }
  }

  public async detectChangedFiles(projectId: number, jsonlPaths: string[]): Promise<Set<string>> {
    const changed = new Set<string>();

    const existingFiles = await db
      .select()
      .from(projectFilesTable)
      .where(
        and(
          eq(projectFilesTable.projectId, projectId),
          inArray(projectFilesTable.filePath, jsonlPaths)
        )
      );

    const hashByPath = new Map<string, string>();
    for (const f of existingFiles) {
      hashByPath.set(f.filePath, f.contentHash);
    }

    const hashChecks = await Promise.all(
      jsonlPaths.map(async (jsonlPath) => {
        const hash = await this.computeFileHash(jsonlPath);
        return { jsonlPath, hash };
      })
    );

    for (const { jsonlPath, hash } of hashChecks) {
      if (!hash) {
        continue;
      }
      const storedHash = hashByPath.get(jsonlPath);
      if (storedHash !== hash) {
        changed.add(jsonlPath);
      }
    }

    return changed;
  }

  public async updateFileHashes(projectId: number, jsonlPaths: string[]): Promise<void> {
    const chunks = chunkArray(jsonlPaths, 500); // BATCH_INSERT_CHUNK
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
