import path from "node:path";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import {
  docuviaFactory,
  TOKENS,
  TIER_B_LANGUAGE_IDS,
  UTF8_ENCODING,
  HASH_ALGO_SHA256,
  ENCODING_HEX,
  type EdgeResolutionCallSite,
  type CallResolutionCanaryRequestMetadata,
  type CallSiteLspResolutionResult,
  createPortableCallSiteKey,
  type EdgeResolutionFileFailure,
  type EdgeResolutionOutcome,
  type EdgeResolutionProviderConfig,
  type CallSiteResolutionRecord,
  type IGitProvider,
  type IGraphStore,
  type ILogger,
  type ResolvedCallEdge,
  type TierBLanguageId,
} from "@workspace/contracts";
import { appendAnalyzeLogLine } from "./analyze-log-writer.js";
import { ANALYZE_EVENTS, ANALYZE_MESSAGES } from "./analyze-messages.js";
import type { TierBQueueEntry } from "./tier-b-queue.js";
import {
  CALL_RESOLUTION_TIER_B_CANARY_POLICY_VERSION,
  isCallResolutionTierBCanary,
  isCertifiedNonCanaryCallSite,
  isCertifiedProvenCallSite,
  resolveCanaryRate,
  type CallResolutionTierBCanaryPolicy,
} from "./call-resolution-tier-b-canary.js";

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
  /** Exact source-bound LSP outcomes, kept separate from compatibility edge aggregation. */
  callSiteResults?: CallSiteLspResolutionResult[];
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
  callResolutionCanary?: CallResolutionTierBCanaryPolicy;
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
  callSiteResults: CallSiteLspResolutionResult[],
): void {
  for (const edge of outcome.edges) edges.push(edge);
  for (const file of outcome.filesProcessed) filesProcessed.push(file);
  for (const failure of outcome.filesFailed) filesFailed.push(failure);
  for (const result of outcome.callSiteResults ?? [])
    callSiteResults.push(result);
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
  const {
    workspaceRoot,
    logger,
    providerConfig,
    store,
    git,
    callResolutionCanary,
  } = deps;
  const registry = docuviaFactory.resolve(TOKENS.EdgeResolutionProviders, {
    logger,
  });

  const edges: ResolvedCallEdge[] = [];
  const filesProcessed: string[] = [];
  const filesFailed: EdgeResolutionFileFailure[] = [];
  const degradedLanguages: DegradedLanguage[] = [];
  const callSiteResults: CallSiteLspResolutionResult[] = [];

  for (const languageId of Object.keys(buckets) as TierBLanguageId[]) {
    const entries = buckets[languageId];
    if (!entries || entries.length === 0) continue;

    // TS-only producer wiring (Finding A/D2's own note: even though the provider config is the
    // real safety gate, querying ast_call_sites for 8 languages whose provider will always
    // discard the answer costs nothing to skip -- defense-in-depth, not a duplicate authority).
    const selected =
      languageId === TIER_B_LANGUAGE_IDS.TYPESCRIPT
        ? await buildCallsByFileForTypescript(
            store,
            git,
            workspaceRoot,
            entries,
            logger,
            callResolutionCanary,
          )
        : {
            callsByFile: undefined,
            skippedFiles: [],
            canaryMetadata: undefined,
          };

    const skippedFileSet = new Set(selected.skippedFiles);
    for (const file of selected.skippedFiles) filesProcessed.push(file);
    const requestEntries = entries.filter(
      (entry) => !skippedFileSet.has(entry.file),
    );
    if (requestEntries.length === 0) continue;

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

    const outcome = await provider.resolveEdges({
      workspaceRoot,
      files: requestEntries.map((e) => e.file),
      callsByFile: selected.callsByFile,
      callResolutionCanary: selected.canaryMetadata,
    });

    mergeOutcomeInto(
      outcome,
      edges,
      filesProcessed,
      filesFailed,
      callSiteResults,
    );
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

  return withCallSiteResults(
    {
      edges,
      filesProcessed,
      filesFailed,
      unavailableReason,
      degradedLanguages,
      fullyDegraded,
      strayLanguageDegraded,
    },
    callSiteResults,
  );
}

function withCallSiteResults(
  outcome: Omit<MergedEdgeResolutionOutcome, "callSiteResults">,
  callSiteResults: CallSiteLspResolutionResult[],
): MergedEdgeResolutionOutcome {
  if (callSiteResults.length === 0) return outcome;
  return { ...outcome, callSiteResults };
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
      .createHash(HASH_ALGO_SHA256)
      .update(content)
      .digest(ENCODING_HEX);
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
  canaryPolicy?: CallResolutionTierBCanaryPolicy,
): Promise<{
  callsByFile: Record<string, EdgeResolutionCallSite[]> | undefined;
  skippedFiles: string[];
  canaryMetadata?: CallResolutionCanaryRequestMetadata;
}> {
  const project = store.projects.getFirst();
  if (!project)
    return {
      callsByFile: undefined,
      skippedFiles: [],
      canaryMetadata: undefined,
    };

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
    return {
      callsByFile: undefined,
      skippedFiles: [],
      canaryMetadata: undefined,
    };
  }

  const sampleRate = canaryPolicy ? resolveCanaryRate(canaryPolicy) : undefined;
  const selection = await selectTypeScriptCallsForFiles({
    files,
    projectId: project.id,
    callSitesByFile,
    store,
    git,
    workspaceRoot,
    canaryPolicy,
    sampleRate,
  });

  logger.info(
    ANALYZE_MESSAGES.TIER_B_FORWARD_SEEDED(
      TIER_B_LANGUAGE_IDS.TYPESCRIPT,
      selection.seeded,
      total,
      selection.staleSkipped,
    ),
  );
  await appendAnalyzeLogLine(workspaceRoot, {
    event: ANALYZE_EVENTS.TIER_B_FORWARD_SEEDED,
    languageId: TIER_B_LANGUAGE_IDS.TYPESCRIPT,
    seeded: selection.seeded,
    total,
    staleSkipped: selection.staleSkipped,
  });

  const canaryMetadata = canaryPolicy
    ? makeCanaryMetadata(
        sampleRate ?? resolveCanaryRate(canaryPolicy),
        selection.selectedKeysBySignature,
        selection.overriddenKeysBySignature,
      )
    : undefined;
  if (canaryMetadata) {
    await appendAnalyzeLogLine(workspaceRoot, {
      event: ANALYZE_EVENTS.TIER_B_CALL_RESOLUTION_CANARY,
      ...canaryMetadata,
      skippedFiles: [...selection.skippedFiles].sort(),
    });
  }

  return {
    callsByFile: selection.seeded > 0 ? selection.callsByFile : undefined,
    skippedFiles: selection.skippedFiles,
    canaryMetadata,
  };
}

interface TypeScriptCallSelectionResult {
  callsByFile: Record<string, EdgeResolutionCallSite[]>;
  skippedFiles: string[];
  selectedKeysBySignature: Map<string, string[]>;
  overriddenKeysBySignature: Map<string, string[]>;
  seeded: number;
  staleSkipped: number;
}

async function selectTypeScriptCallsForFiles(input: {
  files: string[];
  projectId: number;
  callSitesByFile: Map<string, EdgeResolutionCallSite[]>;
  store: IGraphStore;
  git: IGitProvider;
  workspaceRoot: string;
  canaryPolicy?: CallResolutionTierBCanaryPolicy;
  sampleRate: number | undefined;
}): Promise<TypeScriptCallSelectionResult> {
  const storedHashes = new Map(
    input.store.files
      .getAllHashes()
      .map((hash) => [hash.filePath, hash.contentHash]),
  );
  const { dirtyFiles, blobHashes } = await resolveGitHashInputs(
    input.git,
    input.workspaceRoot,
  );
  const result: TypeScriptCallSelectionResult = {
    callsByFile: {},
    skippedFiles: [],
    selectedKeysBySignature: new Map(),
    overriddenKeysBySignature: new Map(),
    seeded: 0,
    staleSkipped: 0,
  };

  for (const file of input.files) {
    const fileSelection = await selectTypeScriptCallsForFile(
      input,
      file,
      storedHashes,
      dirtyFiles,
      blobHashes,
    );
    if (!fileSelection) continue;
    if (fileSelection.stale) {
      result.staleSkipped++;
      continue;
    }

    const { selection } = fileSelection;
    mergeSignatureKeyGroups(
      result.selectedKeysBySignature,
      selection.selectedKeysBySignature,
    );
    mergeSignatureKeyGroups(
      result.overriddenKeysBySignature,
      selection.overriddenKeysBySignature,
    );
    if (selection.allSitesOverridden) {
      result.skippedFiles.push(file);
    } else {
      result.callsByFile[file] = selection.forwarded;
    }
    result.seeded++;
  }

  return result;
}

type TypeScriptCallFileSelection =
  { stale: true } | { stale: false; selection: FileCallSiteSelection };

async function selectTypeScriptCallsForFile(
  input: Parameters<typeof selectTypeScriptCallsForFiles>[0],
  file: string,
  storedHashes: Map<string, string | null>,
  dirtyFiles: ReadonlySet<string>,
  blobHashes: ReadonlyMap<string, string>,
): Promise<TypeScriptCallFileSelection | undefined> {
  const callSites = input.callSitesByFile.get(file);
  if (!callSites || callSites.length === 0) return undefined;

  const storedHash = storedHashes.get(file);
  const liveHash = await resolveLiveContentHash(
    input.workspaceRoot,
    file,
    dirtyFiles,
    blobHashes,
  );
  if (!storedHash || !liveHash || storedHash !== liveHash)
    return { stale: true };

  const resolutions = input.canaryPolicy
    ? (input.store.callSiteResolutions?.getForFile(input.projectId, file) ?? [])
    : [];
  return {
    stale: false,
    selection: selectFileCallSites(
      file,
      callSites,
      storedHash,
      liveHash,
      resolutions,
      input.canaryPolicy,
      input.sampleRate,
    ),
  };
}

function callSitePositionKey(startLine: number, startColumn: number): string {
  return `${startLine}\u0000${startColumn}`;
}

/** The stored key must match every portable identity component on the same current source hash.
 *  Malformed or legacy rows simply stay on Tier B. */
function isPortableIdentityBound(
  resolution: CallSiteResolutionRecord,
): boolean {
  try {
    return (
      createPortableCallSiteKey({
        filePath: resolution.filePath,
        sourceContentHash: resolution.sourceContentHash,
        startLine: resolution.startLine,
        startColumn: resolution.startColumn,
        calleeKind: resolution.calleeKind,
        calleeName: resolution.calleeName,
      }) === resolution.callSiteKey
    );
  } catch {
    return false;
  }
}

function countCallSitesByPosition(
  callSites: EdgeResolutionCallSite[],
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const callSite of callSites) {
    const position = callSitePositionKey(
      callSite.startLine,
      callSite.startColumn,
    );
    counts.set(position, (counts.get(position) ?? 0) + 1);
  }
  return counts;
}

interface FileCallSiteSelection {
  forwarded: EdgeResolutionCallSite[];
  allSitesOverridden: boolean;
  selectedKeysBySignature: Map<string, string[]>;
  overriddenKeysBySignature: Map<string, string[]>;
}

function selectFileCallSites(
  file: string,
  callSites: EdgeResolutionCallSite[],
  storedHash: string,
  liveHash: string,
  resolutions: CallSiteResolutionRecord[],
  policy: CallResolutionTierBCanaryPolicy | undefined,
  sampleRate: number | undefined,
): FileCallSiteSelection {
  if (!hasCompleteResolutionCoverage(callSites, resolutions)) {
    return {
      forwarded: callSites.map((callSite) =>
        policy ? { ...callSite, verificationMode: "tier-b" } : callSite,
      ),
      allSitesOverridden: false,
      selectedKeysBySignature: new Map(),
      overriddenKeysBySignature: new Map(),
    };
  }

  const counts = countCallSitesByPosition(callSites);
  const indexedResolutions = indexResolutionsByPosition(resolutions);
  const selectedKeysBySignature = new Map<string, string[]>();
  const overriddenKeysBySignature = new Map<string, string[]>();
  const forwarded: EdgeResolutionCallSite[] = [];
  let allSitesOverridden = policy !== undefined && callSites.length > 0;

  for (const callSite of callSites) {
    const resolution = findCurrentResolutionForCallSite(
      callSite,
      file,
      storedHash,
      liveHash,
      counts,
      indexedResolutions,
    );
    const selection = selectCallSite(
      callSite,
      resolution,
      liveHash,
      policy,
      sampleRate,
    );
    if (selection.overriddenKey) {
      pushSignatureKey(
        overriddenKeysBySignature,
        selection.overriddenKey.ruleSignature,
        selection.overriddenKey.callSiteKey,
      );
      continue;
    }

    allSitesOverridden = false;
    forwarded.push(selection.callSite);
    if (selection.canaryKey) {
      pushSignatureKey(
        selectedKeysBySignature,
        selection.canaryKey.ruleSignature,
        selection.canaryKey.callSiteKey,
      );
    }
  }

  return {
    forwarded,
    allSitesOverridden,
    selectedKeysBySignature,
    overriddenKeysBySignature,
  };
}

function hasCompleteResolutionCoverage(
  callSites: EdgeResolutionCallSite[],
  resolutions: CallSiteResolutionRecord[],
): boolean {
  if (callSites.length !== resolutions.length) return false;

  const callSitePositions = new Set<string>();
  for (const callSite of callSites) {
    const position = callSitePositionKey(
      callSite.startLine,
      callSite.startColumn,
    );
    if (callSitePositions.has(position)) return false;
    callSitePositions.add(position);
  }

  const resolutionPositions = new Set<string>();
  for (const resolution of resolutions) {
    const position = callSitePositionKey(
      resolution.startLine,
      resolution.startColumn,
    );
    if (resolutionPositions.has(position) || !callSitePositions.has(position))
      return false;
    resolutionPositions.add(position);
  }

  return true;
}

function indexResolutionsByPosition(
  resolutions: CallSiteResolutionRecord[],
): Map<string, CallSiteResolutionRecord[]> {
  const indexed = new Map<string, CallSiteResolutionRecord[]>();
  for (const resolution of resolutions) {
    const position = callSitePositionKey(
      resolution.startLine,
      resolution.startColumn,
    );
    const rows = indexed.get(position) ?? [];
    rows.push(resolution);
    indexed.set(position, rows);
  }
  return indexed;
}

function findCurrentResolutionForCallSite(
  callSite: EdgeResolutionCallSite,
  file: string,
  storedHash: string,
  liveHash: string,
  callSiteCounts: Map<string, number>,
  indexedResolutions: Map<string, CallSiteResolutionRecord[]>,
): CallSiteResolutionRecord | undefined {
  const position = callSitePositionKey(
    callSite.startLine,
    callSite.startColumn,
  );
  const candidates = indexedResolutions.get(position) ?? [];
  if (callSiteCounts.get(position) !== 1 || candidates.length !== 1)
    return undefined;

  const resolution = candidates[0];
  if (resolution.filePath !== file) return undefined;
  if (resolution.sourceContentHash !== storedHash) return undefined;
  if (resolution.sourceContentHash !== liveHash || resolution.isStale)
    return undefined;
  if (!resolution.ruleSignature.trim()) return undefined;
  return isPortableIdentityBound(resolution) ? resolution : undefined;
}

interface CallSiteSelection {
  callSite: EdgeResolutionCallSite;
  canaryKey?: Pick<CallSiteResolutionRecord, "callSiteKey" | "ruleSignature">;
  overriddenKey?: Pick<
    CallSiteResolutionRecord,
    "callSiteKey" | "ruleSignature"
  >;
}

function selectCallSite(
  callSite: EdgeResolutionCallSite,
  resolution: CallSiteResolutionRecord | undefined,
  sourceContentHash: string,
  policy: CallResolutionTierBCanaryPolicy | undefined,
  sampleRate: number | undefined,
): CallSiteSelection {
  const nonCanarySelection = selectCertifiedNonCanary(
    callSite,
    resolution,
    sourceContentHash,
    policy,
  );
  if (nonCanarySelection) return nonCanarySelection;
  if (!resolution || !policy || sampleRate === undefined) {
    return selectTierBOnlyCallSite(callSite, policy);
  }
  return selectPotentialCanaryCallSite(
    callSite,
    resolution,
    sourceContentHash,
    policy,
    sampleRate,
  );
}

function selectCertifiedNonCanary(
  callSite: EdgeResolutionCallSite,
  resolution: CallSiteResolutionRecord | undefined,
  sourceContentHash: string,
  policy: CallResolutionTierBCanaryPolicy | undefined,
): CallSiteSelection | undefined {
  if (
    !resolution ||
    !isCertifiedNonCanaryCallSite(resolution, sourceContentHash, policy)
  ) {
    return undefined;
  }
  return { callSite, overriddenKey: resolution };
}

function selectTierBOnlyCallSite(
  callSite: EdgeResolutionCallSite,
  policy: CallResolutionTierBCanaryPolicy | undefined,
): CallSiteSelection {
  return {
    callSite: policy ? { ...callSite, verificationMode: "tier-b" } : callSite,
  };
}

function selectPotentialCanaryCallSite(
  callSite: EdgeResolutionCallSite,
  resolution: CallSiteResolutionRecord,
  sourceContentHash: string,
  policy: CallResolutionTierBCanaryPolicy,
  sampleRate: number,
): CallSiteSelection {
  const isCanary =
    isCertifiedProvenCallSite(resolution, sourceContentHash, policy) &&
    isCallResolutionTierBCanary(
      resolution.callSiteKey,
      resolution.ruleSignature,
      resolution.resolutionClass,
      sampleRate,
    );
  return {
    callSite: {
      ...callSite,
      callSiteKey: resolution.callSiteKey,
      ruleSignature: resolution.ruleSignature,
      resolutionClass: resolution.resolutionClass,
      verificationPolicyVersion: CALL_RESOLUTION_TIER_B_CANARY_POLICY_VERSION,
      sourceContentHash: resolution.sourceContentHash,
      ...(resolution.selectedTargetNodeKey
        ? { expectedTargetNodeKey: resolution.selectedTargetNodeKey }
        : {}),
      verificationMode: isCanary ? "canary" : "tier-b",
    },
    ...(isCanary ? { canaryKey: resolution } : {}),
  };
}

function mergeSignatureKeyGroups(
  target: Map<string, string[]>,
  incoming: Map<string, string[]>,
): void {
  for (const [signature, keys] of incoming) {
    for (const key of keys) pushSignatureKey(target, signature, key);
  }
}

function pushSignatureKey(
  grouped: Map<string, string[]>,
  signature: string,
  callSiteKey: string,
): void {
  const keys = grouped.get(signature) ?? [];
  keys.push(callSiteKey);
  grouped.set(signature, keys);
}

function makeCanaryMetadata(
  sampleRate: number,
  selected: Map<string, string[]>,
  overridden: Map<string, string[]>,
): CallResolutionCanaryRequestMetadata {
  const toRecord = (groups: Map<string, string[]>): Record<string, string[]> =>
    Object.fromEntries(
      [...groups.entries()]
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([signature, keys]) => [signature, [...keys].sort()]),
    );
  return {
    policyVersion: CALL_RESOLUTION_TIER_B_CANARY_POLICY_VERSION,
    sampleRate,
    stratification: "rule-signature",
    hashInputFields: ["callSiteKey", "ruleSignature", "resolutionClass"],
    selectedCallSiteKeysByRuleSignature: toRecord(selected),
    ruleOverriddenCallSiteKeysByRuleSignature: toRecord(overridden),
  };
}
