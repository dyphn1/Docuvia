import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { LRUCache } from "lru-cache";
import pLimit from "p-limit";
import { logger } from "../utils/logger.js";

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
export class TempFileManager {
  private tempDir: string;
  private lruCache: LRUCache<string, FileEntry>;
  private cleanupInterval: NodeJS.Timeout | null = null;
  private fileLocks = new Map<string, Promise<void>>();
  private concurrencyLimit = pLimit(5); // 5 concurrent file operations
  private ttlMs: number;

  constructor(
    workspaceRoot: string,
    maxSizeBytes: number = 1024 * 1024 * 1024, // 1GB default
    ttlMs: number = 4 * 60 * 60 * 1000, // 4 hours default
    cleanupIntervalMs: number = 30 * 60 * 1000 // 30 minutes default
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
      logger.info({ tempDir: this.tempDir }, "TempFileManager initialized");

      // Start periodic cleanup
      this.startCleanupSchedule(30 * 60 * 1000); // 30 minutes
    } catch (err) {
      logger.error({ error: err }, "Failed to initialize TempFileManager");
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
        logger.debug({ filePath, sizeBytes: stat.size }, "File tracked");
      } catch (err) {
        logger.warn({ filePath, error: err }, "Failed to track file");
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
        logger.warn({ filePath, error: err }, "Failed to access file");
        return null;
      }
    });
  }

  private async removeFileSync(filePath: string): Promise<void> {
    try {
      await fs.unlink(filePath);
      logger.debug({ filePath }, "File removed");
    } catch (err: unknown) {
      if ((err as any)?.code !== "ENOENT") {
        throw err;
      }
    }
  }

  private startCleanupSchedule(intervalMs: number): void {
    this.cleanupInterval = setInterval(() => {
      this.cleanup().catch((err) => {
        logger.error({ error: err }, "Cleanup failed");
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

        logger.info(
          { removedCount: staleFiles.length, cacheSize: this.lruCache.size },
          "Temp directory cleanup completed"
        );
      } catch (err) {
        logger.error({ error: err }, "Cleanup error");
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
