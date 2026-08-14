import path from "node:path";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import {
  docuviaFactory,
  TOKENS,
  TIER_B_LANGUAGE_IDS,
  UTF8_ENCODING,
  type EdgeResolutionCallSite,
  type EdgeResolutionFileFailure,
  type EdgeResolutionOutcome,
  type EdgeResolutionProviderConfig,
  type IGitProvider,
  type IGraphStore,
  type ILogger,
  type ResolvedCallEdge,
  type TierBLanguageId,
} from "@workspace/contracts";
import { appendAnalyzeLogLine } from "./analyze-log-writer.js";
import { ANALYZE_EVENTS, ANALYZE_MESSAGES } from "./analyze-messages.js";
import type { TierBQueueEntry } from "./tier-b-queue.js";

/** Content-hash fallback algorithm for a live file not covered by a clean git blob hash (D5's
 *  staleness guard) -- mirrors `run-delta-ingestion.ts`'s own local consts, which themselves
 *  mirror `FileDiscoveryService`'s manual-hash path (`lib/core`'s internal encoding constants
 *  aren't part of `@workspace/core`'s public surface, so each `lib/ui-core` caller that needs
 *  this defines its own copy of the same two literals rather than reaching into `lib/core`
 *  internals). */
const CONTENT_HASH_ALGORITHM = "sha256";
const CONTENT_HASH_DIGEST_ENCODING = "hex";

/** Per-language honest-degradation fidelity (multi-language-lsp-support plan, Finding F) --
 *  additive alongside the aggregate `unavailableReason` below. */
export interface DegradedLanguage {
  languageId: string;
  reason: string;
}

/** Merged result of dispatching a Tier B batch's language buckets to their respective providers
 *  (Finding A/B/F) -- same field shape as the single-provider `EdgeResolutionOutcome` plus
 *  `degradedLanguages`, so existing consumers of `edges`/`filesProcessed`/`filesFailed`/
 *  `unavailableReason` keep working unmodified. */
export interface MergedEdgeResolutionOutcome {
  edges: ResolvedCallEdge[];
  filesProcessed: string[];
  filesFailed: EdgeResolutionFileFailure[];
  /** Set when at least one queued language's provider could not run at all -- every degraded
   *  language's reason, joined into one human-readable string (Finding F: aggregate, for the
   *  existing single-scalar `degradedReason` consumers). Since issue #33 this is only set when the
   *  batch is genuinely degraded as a whole (every queued language's bucket degraded
   *  -- `fullyDegraded`): a stray secondary-bucket degradation (another language bucket ran fine)
   *  keeps the run healthy in aggregate and is surfaced via `degradedLanguages` +
   *  `strayLanguageDegraded` instead. */
  unavailableReason?: string;
  /** Per-language fidelity behind `unavailableReason` above (Finding F) -- consumed by JSONL
   *  logging and `doctor`'s per-language diagnostic. Always present, empty when nothing degraded. */
  degradedLanguages: DegradedLanguage[];
  /** Issue #33: true when every language bucket that had queued files this batch degraded (its
   *  provider couldn't run at all / none registered). Distinguishes a genuinely-stuck whole-batch
   *  environment outage from a stray secondary-bucket degradation -- only a fully-degraded batch
   *  is exempt from the zero-progress watchdog streak (`run-tier-b-batch.ts`). */
  fullyDegraded: boolean;
  /** Issue #33: true when at least one language degraded while another language bucket in the same
   *  batch ran fine (e.g. ripgrep's single bundled `.rb` Homebrew formula degrading the ruby
   *  bucket while the 100-file rust bucket processed normally). The aggregate `unavailableReason`
   *  is deliberately NOT set in this shape -- the run made meaningful progress, so reporting it
   *  "degraded" because of one unrelated file is misleading (the degraded language is still
   *  recorded in `degradedLanguages` for per-language diagnostics). */
  strayLanguageDegraded: boolean;
}

export interface ResolveEdgesForLanguageBucketsDeps {
  workspaceRoot: string;
  logger: ILogger;
  providerConfig?: EdgeResolutionProviderConfig;
  /** Issue #11 plan A, Slice 3: source of Tier A's persisted call-site positions
   *  (`store.callSites`) for the TypeScript bucket's forward-resolution seed. */
  store: IGraphStore;
  /** Slice 3's D5 staleness guard: `listTrackedFilesWithBlobHash`/`listUntrackedFiles`/
   *  `listModifiedFiles` reproduce the exact same clean-vs-dirty hash decision
   *  `FileDiscoveryService` made when it wrote `project_files.content_hash` in the first place
   *  (a hybrid git-blob-sha/content-sha256 scheme, not a single hash function) -- see
   *  `buildCallsByFileForTypescript`'s own doc comment for why a plain sha256-of-disk comparison
   *  would silently report every clean, unmodified file "stale" and defeat the whole flip. */
  git: IGitProvider;
}

/** Merges one provider's outcome into the batch accumulators with bounded loops instead of
 *  `push(...hugeArray)` spreads -- an uncapped `--lsp-timeout=0` full-repo batch can return
 *  >~125k edges from a single bucket, and V8 throws `RangeError: Maximum call stack size
 *  exceeded` when such an array is spread into a function call (uncapped batch regression).  */
function mergeOutcomeInto(
  outcome: EdgeResolutionOutcome,
  edges: ResolvedCallEdge[],
  filesProcessed: string[],
  filesFailed: EdgeResolutionFileFailure[],
): void {
  for (const edge of outcome.edges) edges.push(edge);
  for (const file of outcome.filesProcessed) filesProcessed.push(file);
  for (const failure of outcome.filesFailed) filesFailed.push(failure);
}

/** Issue #33: classify the batch's degradation shape and derive its aggregate `unavailableReason`.
 *  A degradation is "stray" when some other language bucket in the same batch ran fine -- the run
 *  as a whole made progress, so the aggregate `degraded`/`unavailableReason` must not claim the
 *  whole run failed over an unrelated bucket (ripgrep: 1 bundled .rb formula degrading the ruby
 *  bucket while 100 rust files processed normally). `fullyDegraded` is the complement -- every
 *  attemptable bucket's provider couldn't run, which is what exempts a batch from the zero-progress
 *  watchdog streak (`run-tier-b-batch.ts`).
 */
function classifyDegradation(
  buckets: Partial<Record<TierBLanguageId, TierBQueueEntry[]>>,
  degradedLanguages: DegradedLanguage[],
): {
  unavailableReason?: string;
  fullyDegraded: boolean;
  strayLanguageDegraded: boolean;
} {
  const degradedLanguageIds = new Set(
    degradedLanguages.map((d) => d.languageId),
  );
  const attemptedLanguageIds = (
    Object.keys(buckets) as TierBLanguageId[]
  ).filter((languageId) => (buckets[languageId]?.length ?? 0) > 0);
  const fullyDegraded =
    attemptedLanguageIds.length > 0 &&
    attemptedLanguageIds.every((languageId) =>
      degradedLanguageIds.has(languageId),
    );
  const strayLanguageDegraded = degradedLanguages.length > 0 && !fullyDegraded;
  if (strayLanguageDegraded || degradedLanguages.length === 0) {
    return {
      unavailableReason: undefined,
      fullyDegraded,
      strayLanguageDegraded,
    };
  }
  // Finding F: exactly one degraded language keeps that provider's own reason string verbatim
  // (byte-identical to the pre-registry single-provider outcome, since a single-language slice
  // only ever has one bucket) -- only >1 degraded languages in the same batch get the
  // "languageId: reason" join, since then a bare reason string would be ambiguous about which
  // language it came from.
  const unavailableReason =
    degradedLanguages.length === 1
      ? degradedLanguages[0].reason
      : degradedLanguages.map((d) => `${d.languageId}: ${d.reason}`).join("; ");
  return { unavailableReason, fullyDegraded, strayLanguageDegraded };
}

/**
 * Tier B's per-language dispatch/merge (multi-language-lsp-support plan, Finding A/B/F),
 * replacing `run-tier-b-batch.ts`'s old single-provider call: resolves the
 * `TOKENS.EdgeResolutionProviders` registry once, then runs each non-empty language bucket's
 * provider in turn and merges the outcomes. A bucket whose language has no registered provider
 * degrades honestly (never throws) exactly like an unavailable provider would -- this cannot
 * happen today (Slice 0's dispatch table and registry both only know about `typescript`) but
 * keeps the merge defensive for a later slice that adds a dispatch entry before its provider
 * ships.
 */
export async function resolveEdgesForLanguageBuckets(
  buckets: Partial<Record<TierBLanguageId, TierBQueueEntry[]>>,
  deps: ResolveEdgesForLanguageBucketsDeps,
): Promise<MergedEdgeResolutionOutcome> {
  const { workspaceRoot, logger, providerConfig, store, git } = deps;
  const registry = docuviaFactory.resolve(TOKENS.EdgeResolutionProviders, {
    logger,
  });

  const edges: ResolvedCallEdge[] = [];
  const filesProcessed: string[] = [];
  const filesFailed: EdgeResolutionFileFailure[] = [];
  const degradedLanguages: DegradedLanguage[] = [];

  for (const languageId of Object.keys(buckets) as TierBLanguageId[]) {
    const entries = buckets[languageId];
    if (!entries || entries.length === 0) continue;

    const buildProvider = registry[languageId];
    if (!buildProvider) {
      degradedLanguages.push({
        languageId,
        reason: `no LSP provider registered for language "${languageId}"`,
      });
      continue;
    }

    const provider = buildProvider();
    if (providerConfig) provider.configure(providerConfig);

    // TS-only producer wiring (Finding A/D2's own note: even though the provider config is the
    // real safety gate, querying ast_call_sites for 8 languages whose provider will always
    // discard the answer costs nothing to skip -- defense-in-depth, not a duplicate authority).
    const callsByFile =
      languageId === TIER_B_LANGUAGE_IDS.TYPESCRIPT
        ? await buildCallsByFileForTypescript(
            store,
            git,
            workspaceRoot,
            entries,
            logger,
          )
        : undefined;

    const outcome = await provider.resolveEdges({
      workspaceRoot,
      files: entries.map((e) => e.file),
      callsByFile,
    });

    mergeOutcomeInto(outcome, edges, filesProcessed, filesFailed);
    if (outcome.unavailableReason) {
      degradedLanguages.push({
        languageId,
        reason: outcome.unavailableReason,
      });
    }
  }

  // Issue #33's aggregate shape: see `classifyDegradation`.
  const { unavailableReason, fullyDegraded, strayLanguageDegraded } =
    classifyDegradation(buckets, degradedLanguages);

  return {
    edges,
    filesProcessed,
    filesFailed,
    unavailableReason,
    degradedLanguages,
    fullyDegraded,
    strayLanguageDegraded,
  };
}

/** Normalizes a path to forward slashes for comparison against `IGitProvider`'s posix-keyed maps
 *  (`git ls-files`/status output is always posix, even on Windows) -- mirrors
 *  `lsp-edge-provider-base.ts`'s own `toNodeKey`. Queue entries (`TierBQueueEntry.file`) are
 *  already posix in practice, but this guards against a silent all-stale false negative (every
 *  file "stale-skipped" because the git-map lookup missed on a backslash) rather than assuming it. */
function toPosixPath(filePath: string): string {
  return filePath.split("\\").join("/");
}

/** D5's live-hash side: reproduces the exact same clean-vs-dirty decision
 *  `FileDiscoveryService.resolveFileOutcome`/`readFileForHashing` made when `project_files
 *  .content_hash` was first written -- a clean, git-tracked file's stored hash is the *git blob
 *  sha* (`git ls-files --stage`), not a content hash of any kind; only a dirty (modified or
 *  untracked) file's stored hash is a manual sha256-of-disk-content. Comparing a plain
 *  sha256-of-disk hash against every file's stored hash (ignoring this hybrid scheme) would make
 *  the guard report every clean, unmodified file "stale" and silently defeat the whole flip (the
 *  common case for a fresh `docuvia analyze --escalate-to-lsp` run against a clean checkout) --
 *  see this plan's own advisor consultation on this exact gap. Returns `undefined` when the file
 *  can't be read (deleted since queued, permissions, ...) -- treated as stale by the caller (safe
 *  direction: falls through to the reverse path for that one file, per D5). */
async function resolveLiveContentHash(
  workspaceRoot: string,
  file: string,
  dirtyFiles: ReadonlySet<string>,
  blobHashes: ReadonlyMap<string, string>,
): Promise<string | undefined> {
  const posixFile = toPosixPath(file);
  if (!dirtyFiles.has(posixFile) && blobHashes.has(posixFile)) {
    return blobHashes.get(posixFile);
  }
  try {
    const content = await fs.readFile(
      path.join(workspaceRoot, file),
      UTF8_ENCODING,
    );
    return crypto
      .createHash(CONTENT_HASH_ALGORITHM)
      .update(content)
      .digest(CONTENT_HASH_DIGEST_ENCODING);
  } catch {
    return undefined;
  }
}

/** Resolves the three git primitives D5's live-hash side needs, once per call (not per file) --
 *  mirrors `FileDiscoveryService.scanViaGit`'s own batch-not-per-file shape. Outside a git
 *  repository (or on any git failure), every file is conservatively treated as dirty (forces the
 *  sha256-of-disk path for all of them) -- the same fallback `FileDiscoveryService` itself takes
 *  (its own glob-fallback path also treats every file as dirty and stores sha256 hashes), so the
 *  comparison stays internally consistent rather than comparing two different hash schemes. */
async function resolveGitHashInputs(
  git: IGitProvider,
  workspaceRoot: string,
): Promise<{ dirtyFiles: Set<string>; blobHashes: Map<string, string> }> {
  try {
    const [blobHashes, untracked, modified] = await Promise.all([
      git.listTrackedFilesWithBlobHash(workspaceRoot),
      git.listUntrackedFiles(workspaceRoot),
      git.listModifiedFiles(workspaceRoot),
    ]);
    const dirtyFiles = new Set([...untracked, ...modified]);
    return { dirtyFiles, blobHashes };
  } catch {
    return { dirtyFiles: new Set(), blobHashes: new Map() };
  }
}

/**
 * Builds the TypeScript bucket's `callsByFile` seed (Phase 2, issue #11 plan A Slice 3) from
 * Tier A's persisted `ast_call_sites` rows, gated by D5's staleness guard. Returns `undefined`
 * when there is nothing safe to seed (no project row yet, zero persisted call sites for this
 * batch's files, or every file with call sites turned out stale) -- `undefined` is
 * indistinguishable from "Tier A hasn't populated ast_call_sites yet" to `processOneFile`'s own
 * fallback, which is exactly the intended degrade-to-reverse behavior (D5/D6).
 */
async function buildCallsByFileForTypescript(
  store: IGraphStore,
  git: IGitProvider,
  workspaceRoot: string,
  entries: TierBQueueEntry[],
  logger: ILogger,
): Promise<Record<string, EdgeResolutionCallSite[]> | undefined> {
  const project = store.projects.getFirst();
  if (!project) return undefined;

  const files = entries.map((e) => e.file);
  const callSitesByFile = store.callSites.getForFiles(project.id, files);

  const total = files.length;
  if (callSitesByFile.size === 0) {
    logger.info(
      ANALYZE_MESSAGES.TIER_B_FORWARD_SEEDED(
        TIER_B_LANGUAGE_IDS.TYPESCRIPT,
        0,
        total,
        0,
      ),
    );
    await appendAnalyzeLogLine(workspaceRoot, {
      event: ANALYZE_EVENTS.TIER_B_FORWARD_SEEDED,
      languageId: TIER_B_LANGUAGE_IDS.TYPESCRIPT,
      seeded: 0,
      total,
      staleSkipped: 0,
    });
    return undefined;
  }

  const storedHashes = new Map(
    store.files.getAllHashes().map((h) => [h.filePath, h.contentHash]),
  );
  const { dirtyFiles, blobHashes } = await resolveGitHashInputs(
    git,
    workspaceRoot,
  );

  const callsByFile: Record<string, EdgeResolutionCallSite[]> = {};
  let seeded = 0;
  let staleSkipped = 0;

  for (const file of files) {
    const callSites = callSitesByFile.get(file);
    if (!callSites || callSites.length === 0) continue;

    const storedHash = storedHashes.get(file);
    const liveHash = await resolveLiveContentHash(
      workspaceRoot,
      file,
      dirtyFiles,
      blobHashes,
    );

    if (!storedHash || !liveHash || storedHash !== liveHash) {
      staleSkipped++;
      continue;
    }

    callsByFile[file] = callSites;
    seeded++;
  }

  logger.info(
    ANALYZE_MESSAGES.TIER_B_FORWARD_SEEDED(
      TIER_B_LANGUAGE_IDS.TYPESCRIPT,
      seeded,
      total,
      staleSkipped,
    ),
  );
  await appendAnalyzeLogLine(workspaceRoot, {
    event: ANALYZE_EVENTS.TIER_B_FORWARD_SEEDED,
    languageId: TIER_B_LANGUAGE_IDS.TYPESCRIPT,
    seeded,
    total,
    staleSkipped,
  });

  return seeded > 0 ? callsByFile : undefined;
}
