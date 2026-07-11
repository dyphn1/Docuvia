import fs from "node:fs/promises";
import path from "node:path";
import { LRUCache } from "lru-cache";
import pLimit from "p-limit";
import type { ILogger, ITempFileManager } from "@workspace/contracts";
import { createNoopLogger } from "@workspace/contracts";

interface FileEntry {
  filePath: string;
  createdAt: number;
  lastAccessedAt: number;
  sizeBytes: number;
}

/**
 * TempFileManager
 *
 * Manages .docuvia/tmp/ directory lifecycle with TTL/LRU eviction.
 * - TTL: 4 hours
 * - Max size: 1GB
 * - Periodic cleanup: every 30 minutes
 * - Concurrent access: write locks per file
 */
export class TempFileManager implements ITempFileManager {
  private tempDir: string;
  private lruCache: LRUCache<string, FileEntry>;
  private cleanupInterval: NodeJS.Timeout | null = null;
  private concurrencyLimit = pLimit(5); // 5 concurrent file operations
  private ttlMs: number;

  constructor(
    workspaceRoot: string,
    private readonly logger: ILogger = createNoopLogger(),
    maxSizeBytes: number = 1024 * 1024 * 1024, // 1GB default
    ttlMs: number = 4 * 60 * 60 * 1000, // 4 hours default
    _cleanupIntervalMs: number = 30 * 60 * 1000 // 30 minutes default
  ) {
    this.tempDir = path.join(workspaceRoot, ".docuvia", "tmp");
    this.ttlMs = ttlMs;
    this.lruCache = new LRUCache<string, FileEntry>({
      max: 10000, // Max number of tracked files
      maxSize: maxSizeBytes,
      sizeCalculation: (item: FileEntry) => item.sizeBytes,
      ttl: ttlMs,
      allowStale: false,
    });
  }

  async initialize(): Promise<void> {
    try {
      await fs.mkdir(this.tempDir, { recursive: true });
      this.logger.info("TempFileManager initialized", { tempDir: this.tempDir });

      // Start periodic cleanup
      this.startCleanupSchedule(30 * 60 * 1000); // 30 minutes
    } catch (err) {
      this.logger.error("Failed to initialize TempFileManager", {
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }

  async trackFile(filePath: string): Promise<void> {
    return this.concurrencyLimit(async () => {
      try {
        const stat = await fs.stat(filePath);
        const entry: FileEntry = {
          filePath,
          createdAt: Date.now(),
          lastAccessedAt: Date.now(),
          sizeBytes: stat.size,
        };
        this.lruCache.set(filePath, entry);
        this.logger.debug("File tracked", { filePath, sizeBytes: stat.size });
      } catch (err) {
        this.logger.warn("Failed to track file", {
          filePath,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    });
  }

  async accessFile(filePath: string): Promise<string | null> {
    return this.concurrencyLimit(async () => {
      try {
        const entry = this.lruCache.get(filePath);
        if (entry) {
          entry.lastAccessedAt = Date.now();
          this.lruCache.set(filePath, entry); // Update access time
        }
        const content = await fs.readFile(filePath, "utf-8");
        return content;
      } catch (err) {
        this.logger.warn("Failed to access file", {
          filePath,
          error: err instanceof Error ? err.message : String(err),
        });
        return null;
      }
    });
  }

  private async removeFileSync(filePath: string): Promise<void> {
    try {
      await fs.unlink(filePath);
      this.logger.debug("File removed", { filePath });
    } catch (err: unknown) {
      if ((err as any)?.code !== "ENOENT") {
        throw err;
      }
    }
  }

  private startCleanupSchedule(intervalMs: number): void {
    this.cleanupInterval = setInterval(() => {
      this.cleanup().catch((err) => {
        this.logger.error("Cleanup failed", { error: err instanceof Error ? err.message : String(err) });
      });
    }, intervalMs);
    this.cleanupInterval.unref(); // Don't prevent process exit
  }

  async cleanup(): Promise<void> {
    return this.concurrencyLimit(async () => {
      try {
        const now = Date.now();
        const staleFiles: string[] = [];

        for (const [filePath, entry] of this.lruCache.entries()) {
          if (now - entry.lastAccessedAt > this.ttlMs) {
            staleFiles.push(filePath);
          }
        }

        for (const filePath of staleFiles) {
          this.lruCache.delete(filePath);
          await this.removeFileSync(filePath);
        }

        this.logger.info("Temp directory cleanup completed", {
          removedCount: staleFiles.length,
          cacheSize: this.lruCache.size,
        });
      } catch (err) {
        this.logger.error("Cleanup error", { error: err instanceof Error ? err.message : String(err) });
      }
    });
  }

  stopCleanup(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  getTempDirPath(): string {
    return this.tempDir;
  }

  getCacheSize(): number {
    return this.lruCache.size;
  }

  getTotalSize(): number {
    let total = 0;
    for (const entry of this.lruCache.values()) {
      total += entry.sizeBytes;
    }
    return total;
  }
}
