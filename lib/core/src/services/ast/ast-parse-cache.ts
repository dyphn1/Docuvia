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
  private totalItemsAdded: number = 0;

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
    const result = this.cache.get(contentHash);

    if (result) {
      this._metrics.hits++;
    } else {
      this._metrics.misses++;
    }

    return result;
  }

  set(contentHash: string, result: AstParseResponse): void {
    const isNewItem = !this.cache.has(contentHash);
    const itemCountBefore = isNewItem ? this.cache.dump().length : 0;

    this.cache.set(contentHash, result);

    if (isNewItem) {
      const itemCountAfter = this.cache.dump().length;
      // Calculate evictions: if adding 1 new item resulted in fewer items, some were evicted
      // Formula: evicted = before + 1 (new item) - after
      const evictedCount = itemCountBefore + 1 - itemCountAfter;
      if (evictedCount > 0) {
        this._metrics.evictions += evictedCount;
      }
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
