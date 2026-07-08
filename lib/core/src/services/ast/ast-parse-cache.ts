import { LRUCache } from "lru-cache";
import { AstParseResponse } from "../../workers/ast-worker.js";
import { IAsxParseCache, CacheMetrics } from "../../interfaces/ast-ingestion.interfaces.js";
import { logger } from "../../utils/logger.js";

/**
 * AstParseCache
 *
 * Implements a content-addressable cache for AST parse results using LRU eviction.
 * - Key: SHA256 hash of content
 * - Value: Full AstParseResponse with metadata
 * - TTL: 1 hour
 * - Max size: 500MB
 * - Tracks: hits, misses, evictions
 */
export class AstParseCache implements IAsxParseCache {
  private cache: LRUCache<string, AstParseResponse>;
  private _metrics: CacheMetrics = { hits: 0, misses: 0, evictions: 0 };
  private previousSize: number = 0;

  constructor(
    maxSizeBytes: number = 500 * 1024 * 1024, // 500MB default
    ttlMs: number = 60 * 60 * 1000 // 1 hour default
  ) {
    // Calculate max items based on average response size (assuming ~50KB per response)
    const avgResponseSizeBytes = 50 * 1024;
    const maxItems = Math.ceil(maxSizeBytes / avgResponseSizeBytes);

    this.cache = new LRUCache<string, AstParseResponse>({
      max: maxItems,
      maxSize: maxSizeBytes,
      sizeCalculation: (item: AstParseResponse) => {
        // Rough estimate of serialized size
        return JSON.stringify(item).length;
      },
      ttl: ttlMs,
      allowStale: false,
    });

    logger.info({ maxItems, maxSizeBytes, ttlMs }, "AstParseCache initialized");
  }

  get(contentHash: string): AstParseResponse | undefined {
    const sizeBefore = this.cache.size;
    const result = this.cache.get(contentHash);
    const sizeAfter = this.cache.size;

    if (result) {
      this._metrics.hits++;
    } else {
      this._metrics.misses++;
    }

    // Detect evictions by size change
    if (sizeBefore > sizeAfter) {
      this._metrics.evictions += sizeBefore - sizeAfter;
    }

    return result;
  }

  set(contentHash: string, result: AstParseResponse): void {
    const sizeBefore = this.cache.size;
    this.cache.set(contentHash, result);
    const sizeAfter = this.cache.size;

    // Detect evictions by size change
    if (sizeBefore > sizeAfter) {
      this._metrics.evictions += sizeBefore - sizeAfter;
    }
  }

  get metrics(): CacheMetrics {
    return {
      hits: this._metrics.hits,
      misses: this._metrics.misses,
      evictions: this._metrics.evictions,
    };
  }

  clear(): void {
    this.cache.clear();
    this._metrics = { hits: 0, misses: 0, evictions: 0 };
  }
}
