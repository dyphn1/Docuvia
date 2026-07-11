import type { AstParseResponse } from "../workers/ast-worker.js";

/**
 * Extracted from old Docuvia's `interfaces/ast-ingestion.interfaces.ts` — that file bundled
 * this cache contract together with ~8 unrelated L2/L3/edge-persistence ingestion interfaces
 * (each with their own heavy `types/ast-ingestion.types.ts` dependency chain) that nothing in
 * the `init` pilot touches. `AstWorkerPool`'s optional `cache` constructor parameter is the
 * only consumer here, so only its two supporting types are ported.
 */
export interface CacheMetrics {
  hits: number;
  misses: number;
  evictions: number;
}

export interface IAsxParseCache {
  get(contentHash: string): AstParseResponse | undefined;
  set(contentHash: string, result: AstParseResponse): void;
  metrics: CacheMetrics;
  clear(): void;
}
