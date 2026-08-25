import {
  aggregateCallResolution,
  GitConstants,
  type CallResolutionStats,
  type IGraphStore,
} from "@workspace/contracts";

/** Issue #221: persistence for the Tier A call-site resolution counters
 *  `IGraphPersister.persist()` returns, shared by `init`, `analyze`'s full-ingestion branch
 *  (both own the whole map -- they reparse everything) and `analyze`'s delta ingestion (which
 *  upserts just the re-parsed files and drops deleted files' entries). Kept as a per-file JSON
 *  map under one `docuvia_meta` key rather than aggregate-only so a delta run can update its
 *  slice without stale-file contamination: a deleted file's entry is removed in the same write
 *  that removes its nodes (`persistDelta`'s `toDelete` set), mirroring
 *  `ast_call_sites`' delete-then-reinsert symmetry. */

export interface StoredCallResolution {
  byFile: Record<string, CallResolutionStats>;
}

export function serializeCallResolution(
  byFile: Record<string, CallResolutionStats>,
): string {
  const stored: StoredCallResolution = { byFile };
  return JSON.stringify(stored);
}

export function readCallResolution(
  store: IGraphStore,
): Record<string, CallResolutionStats> {
  const raw = store.meta.get(GitConstants.META_KEY_CALL_RESOLUTION_STATS);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Partial<StoredCallResolution>;
    return parsed.byFile ?? {};
  } catch {
    // Corrupt/unparseable value -- treat as absent rather than failing the caller; the next
    // full ingestion replaces it wholesale anyway.
    return {};
  }
}

function writeCallResolution(
  store: IGraphStore,
  byFile: Record<string, CallResolutionStats>,
): void {
  if (Object.keys(byFile).length === 0) return;
  store.meta.set(
    GitConstants.META_KEY_CALL_RESOLUTION_STATS,
    serializeCallResolution(byFile),
  );
}

/** Full-ingestion/init variant: the run reparsed every tracked file, so the previous map is
 *  replaced wholesale (no merge -- stale entries cannot survive a full pass). No-op when the
 *  run produced no call-site data at all (e.g. a repo with zero extractable calls), leaving any
 *  prior map untouched rather than wiping it with an empty one. */
export function stampFullCallResolution(
  store: IGraphStore,
  byFile: Record<string, CallResolutionStats>,
): void {
  if (Object.keys(byFile).length === 0) return;
  writeCallResolution(store, byFile);
}

/** Delta-ingestion variant: upserts the re-parsed files' entries and removes deleted files'
 *  entries, then writes the merged map back. */
export function mergeDeltaCallResolution(
  store: IGraphStore,
  reparsedByFile: Record<string, CallResolutionStats>,
  deletedFiles: Iterable<string>,
): void {
  const merged = readCallResolution(store);
  for (const file of deletedFiles) {
    delete merged[file];
  }
  for (const [file, stats] of Object.entries(reparsedByFile)) {
    merged[file] = stats;
  }
  writeCallResolution(store, merged);
}

/** Repo-wide totals over the stored per-file map (exposed for callers that want the aggregate
 *  without re-deriving it). */
export function aggregateStoredCallResolution(store: IGraphStore): {
  byFile: Record<string, CallResolutionStats>;
  total: CallResolutionStats;
} {
  const byFile = readCallResolution(store);
  return { byFile, total: aggregateCallResolution(byFile) };
}
