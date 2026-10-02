/** Replays Phase 0 ScopeResolver baselines over the pinned System-1 corpus. */
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { performance } from "node:perf_hooks";
import { execFileSync, spawn } from "node:child_process";
import ts from "typescript";
import {
  MAX_FILE_SIZE_BYTES,
  isDiscoverableSourceFile,
  type ParsedAstFileResult,
} from "../../lib/contracts/src/index.js";
import { isSnapshotPath } from "../../lib/core/src/semantic/collection/semantic-snapshot-hash.js";
import { AstProcessingService } from "../../lib/core/src/ast/ast-processing.service.js";
import { AstWorkerPool } from "../../lib/core/src/ast/ast-worker-pool.js";
import { ScopeResolver } from "../../lib/core/src/graph/scope-resolver.js";
import {
  buildParsedSymbolNodeKeyIndex,
  assertExactSampleCoverage,
  classifyReceiver,
  matchParsedCallAtPosition,
  nodeKeyForResolverTarget,
  nodeKeyForParsedDeclarationAtPosition,
  nodeKeyForSourceFunction,
  registerScopeResolverFiles,
  resolveScopeResolverProposal,
  summarizeBaselineRows,
  type BaselineCallRow,
  type BaselineLabel,
  type ReceiverCategory,
  type ReplayCallSite,
  type ScopeResolverTarget,
  type ScopeResolverLike,
} from "./phase0-tiered-call-resolution-replay.mts";
import {
  mapCallExpressionAtPosition,
  portableCallSiteKey,
  type CallSitePositionMapping,
} from "./phase0-tiered-call-resolution-support.mts";
import {
  assertClean,
  describeRevision,
  hashSnapshot,
  materializeSnapshot,
  git,
} from "./snapshot.mts";
import { freeMemoryPercent } from "./memory-guard.mts";
import { offlineEnv, writeJson } from "./run-support.mts";
import { DOCUVIA_CLI } from "./tier-a.mts";
import { readTierAGraph } from "./tier-a.mts";
import { system1RequestId } from "../../lib/core/src/semantic/system1/system1-state-builder.js";
import {
  preflightSnapshotPaths,
  readSnapshotSourceFile,
} from "./phase0-snapshot-safety.mts";
import {
  resolveSystem1DeterministicQueries,
  System1QuerySourceIndex,
  type System1QueryResult,
  type System1QueryState,
  type System1QueryResults,
} from "./system1-query-routing-rules.mts";
import {
  replayPartialSemanticRows,
  type PartialSemanticReplayProjectSummary,
  type PartialSemanticReplayRow,
} from "./phase0-partial-semantic-replay.mts";

const ROOT = path.resolve(import.meta.dirname, "../..");
const DEFAULT_REPOSITORIES = path.join(os.homedir(), "Desktop", "GitHub");
const CORPUS_DIRECTORY = path.join(
  ROOT,
  "evaluate/results/semantic-corpus/v1/run-c",
);
const OUTPUT_DIRECTORY = path.join(
  ROOT,
  "evaluate/results/semantic-corpus/v1/phase0-tiered-call-resolution",
);
const DEFAULT_TIER_A_HEAP_MB = 4096;
const JSONL_SUFFIX = "\n";
const RSS_SAMPLE_MS = 250;
const MEASUREMENT_SOURCE_FILES = [
  "scripts/semantic-corpus/phase0-tiered-call-resolution-runner.mts",
  "scripts/semantic-corpus/phase0-tiered-call-resolution-replay.mts",
  "scripts/semantic-corpus/phase0-tiered-call-resolution-support.mts",
  "scripts/semantic-corpus/phase0-snapshot-safety.mts",
  "scripts/semantic-corpus/phase0-partial-semantic-replay.mts",
  "scripts/semantic-corpus/phase0-partial-semantic.mts",
  "scripts/semantic-corpus/snapshot.mts",
  "scripts/semantic-corpus/tier-a.mts",
  "scripts/semantic-corpus/run-support.mts",
  "scripts/semantic-corpus/memory-guard.mts",
  "scripts/semantic-corpus/system1-query-routing-rules.mts",
  "lib/core/src/ast/ast-processing.service.ts",
  "lib/core/src/ast/ast-worker-pool.ts",
  "lib/core/src/ast/ast-worker.ts",
  "lib/core/src/graph/scope-resolver.ts",
  "lib/core/src/graph/persist-ast-graph.ts",
  "lib/core/src/semantic/collection/semantic-snapshot-hash.ts",
  "lib/core/src/semantic/system1/system1-state-builder.ts",
  "lib/core/src/graph/node-key.ts",
  "lib/core/src/discovery/file-discovery.service.ts",
  "lib/contracts/src/constants/source-files.ts",
  "lib/contracts/src/constants/paths.ts",
  "lib/contracts/src/interfaces/ast.interfaces.ts",
  "lib/core/src/utils/language-detection.ts",
  "pnpm-lock.yaml",
].sort();

interface CorpusSnapshotSpec {
  readonly snapshotId: string;
  readonly repoId: string;
  readonly family: string;
  readonly sourceDir: string;
  readonly revision: string;
  readonly subtree: string | null;
}

interface CollectionSnapshot {
  readonly snapshotId: string;
  readonly repoId: string;
  readonly family: string;
  readonly revision: string;
  readonly subtree: string | null;
  readonly snapshotHash: string;
  readonly tierA: { readonly durationMs: number };
}

interface LabeledCorpusSample {
  readonly sampleId: string;
  readonly source: {
    readonly repoId: string;
    readonly repoFamily: string;
    readonly revision: string;
    readonly projectId: string;
    readonly callSiteId: string;
    readonly snapshotHash: string;
    readonly duplicateGroup: string;
    readonly split: string;
  };
  readonly candidates: readonly { readonly targetId: string }[];
  readonly oracle: {
    readonly status: string;
    readonly targetIds: readonly string[];
  };
  readonly review: {
    readonly status: string;
    readonly positiveTargetIds: readonly string[];
    readonly negativeTargetIds?: readonly string[];
    readonly evidenceRefs?: readonly string[];
  };
}

/** The only corpus data available during source mapping and resolver replay. */
interface SourceOnlyCorpusSample {
  readonly sampleId: string;
  readonly source: LabeledCorpusSample["source"];
}

interface CorpusManifest {
  readonly schemaVersion: number;
  readonly samples: readonly SourceOnlyCorpusSample[];
}

interface CorpusSource {
  readonly sampleId: string;
  readonly repoId: string;
  readonly repoFamily: string;
  readonly revision: string;
  readonly snapshotId: string;
  readonly subtree: string | null;
  readonly snapshotHash: string;
  readonly projectId: string;
  readonly split: string;
  readonly duplicateGroup: string;
  readonly callSiteId: string;
}

interface SourceCallSiteRow extends CorpusSource {
  readonly callSiteKey: string | null;
  readonly filePath: string;
  readonly line: number;
  /** Canonical zero-based UTF-16 code-unit column supplied by the corpus/AstWorker. */
  readonly column: number;
  readonly columnUtf16: number | null;
  readonly offsetUtf16: number | null;
  readonly calleeKind: string | null;
  readonly calleeName: string | null;
  readonly receiverText: string | null;
  readonly receiverCategory: ReceiverCategory;
  readonly positionStatus: "unique" | "excluded";
  readonly exclusionReason?: string;
}

interface ScopeResolverBaselineRow extends BaselineCallRow {
  readonly callSiteKey: string | null;
  readonly snapshotId: string;
  readonly filePath: string;
  readonly line: number;
  /** Canonical zero-based UTF-16 code-unit column supplied by the corpus/AstWorker. */
  readonly column: number;
  readonly receiverCategory: ReceiverCategory;
  readonly callShape: string;
  readonly resolverPath: "member" | "bare" | "unsupported" | null;
  readonly resolverTargetRef: ScopeResolverTarget | null;
  readonly resolverLatencyMs: number | null;
  readonly callerNodeKey: string | null;
  readonly graphEdgeStatus:
    "linked" | "self-discarded" | "no-target" | "not-run";
}

interface LabelSidecarRow extends CorpusSource {
  readonly candidateTargetIds: readonly string[];
  readonly positiveTargetIds: readonly string[];
  readonly negativeTargetIds: readonly string[];
  readonly oracleStatus: string;
  readonly oracleTargetIds: readonly string[];
  readonly reviewStatus: string;
  readonly evidenceRefs: readonly string[];
}

interface ThisMemberBaselineRow {
  readonly sampleId: string;
  readonly callSiteKey: string | null;
  readonly snapshotId: string;
  readonly repoId: string;
  readonly repoFamily: string;
  readonly revision: string;
  readonly subtree: string | null;
  readonly snapshotHash: string;
  readonly filePath: string;
  readonly line: number;
  readonly column: number;
  readonly columnUtf16: number | null;
  readonly offsetUtf16: number | null;
  readonly calleeKind: string;
  readonly calleeName: string;
  readonly receiverText: string;
  readonly receiverCategory: ReceiverCategory;
  readonly positionStatus: "unique" | "excluded";
  readonly exclusionReason?: string;
  readonly scopeResolverStatus: string;
  readonly resolverTargetRef: ScopeResolverTarget | null;
  readonly resolverTargetId: string | null;
  readonly resolverLatencyMs: number | null;
}

interface DeterministicQueryBaselineRow extends SourceCallSiteRow {
  readonly evidenceKind: "phase0-deterministic-query-baseline-only";
  readonly requestId: string;
  readonly queryState: "evaluated" | "no-state" | "position-excluded" | "error";
  readonly queryStateReason: string | null;
  readonly q1: System1QueryResult;
  readonly q2: System1QueryResult;
  readonly q3: System1QueryResult;
  readonly cascade: System1QueryResults["cascade"];
  readonly latencyMs: number | null;
}

interface PartialSemanticProjectEvidence {
  readonly snapshotId: string;
  readonly projectId: string;
  readonly status: string;
  readonly inputSiteCount: number;
  readonly queriedSiteCount: number;
  readonly failedSiteCount: number;
  readonly typescriptVersion: string | null;
  readonly languageServiceMode: "PartialSemantic";
  readonly configHash: string | null;
  readonly compilerOptions: {
    readonly noResolve: true;
    readonly types: readonly [];
  };
  readonly rootFileCount: number;
  readonly programFileCount: number;
  readonly startupMs: number | null;
  readonly readyMs: number | null;
  readonly error?: string;
}

interface PartialSemanticScoringRow {
  readonly sampleId: string;
  readonly snapshotId: string;
  readonly callSiteKey: string | null;
  readonly evidenceKind: "tier-b0-measurement-only";
  readonly status: string;
  readonly positionStatus: "unique" | "excluded";
  readonly callShape: string;
  readonly receiverCategory: ReceiverCategory;
  readonly repoFamily: string;
  readonly split: string;
  readonly duplicateGroup: string;
  readonly mappingStatuses: readonly {
    readonly status:
      | "mapped"
      | "external"
      | "no-symbol-name"
      | "no-source-span"
      | "not-found"
      | "ambiguous"
      | "not-in-persisted-graph";
    readonly targetId?: string;
  }[];
  readonly mappedDefinitionTargetIds: readonly string[];
  readonly top1TargetId: string | null;
  readonly latencyMs: number | null;
}

interface SourceFileContent {
  readonly hash: string;
  readonly code: string | null;
  readonly exclusionReason?: string;
}

interface SnapshotIntegrityExclusion {
  readonly path: string;
  readonly reason: string;
}

interface SnapshotRunSummary {
  readonly snapshotStatus: "measured" | "excluded";
  readonly snapshotIntegrityExclusions: readonly SnapshotIntegrityExclusion[];
  readonly preflightTrackedPaths: number;
  readonly preflightSafePaths: number;
  readonly snapshotId: string;
  readonly repoId: string;
  readonly revision: string;
  readonly subtree: string | null;
  readonly expectedSnapshotHash: string;
  readonly measuredSnapshotHash: string | null;
  readonly trackedSourceFiles: number;
  readonly oversizedSourceFiles: readonly {
    readonly path: string;
    readonly sizeBytes: number;
  }[];
  readonly parsedFiles: number;
  readonly parseFailures: number;
  readonly corpusRows: number;
  readonly mappedCorpusRows: number;
  readonly excludedCorpusRows: number;
  readonly parsedCallSites: number;
  readonly scopeResolver: {
    readonly resolved: number;
    readonly unresolved: number;
    readonly unsupported: number;
    readonly unmappedTarget: number;
    readonly p50Ms: number | null;
    readonly p95Ms: number | null;
    readonly totalMs: number;
  };
  readonly corpusResolverMs: number;
  readonly graphProjection: {
    readonly predictedCallEdges: number;
    readonly persistedCallEdges: number;
    readonly matchingCallEdges: number;
    readonly predictedOnly: number;
    readonly persistedOnly: number;
    readonly exactMatch: boolean;
  } | null;
  readonly partialSemanticWallMs: number | null;
  readonly partialSemanticProjectCount: number;
  readonly partialSemanticProjectErrors: number;
  readonly byReceiverCategory: Readonly<Record<string, ReceiverCounts>>;
  readonly thisMemberCensus: {
    readonly sites: number;
    readonly mapped: number;
    readonly excluded: number;
    readonly resolved: number;
    readonly unresolved: number;
    readonly unsupported: number;
  };
  readonly priorTierAWallMs: number;
  readonly measuredTierAWallMs: number | null;
  readonly tierAWallRatio: number | null;
  readonly tierAChildPeakRssBytes: number | null;
  readonly parseWallMs: number | null;
  readonly replayWallMs: number | null;
  readonly freeMemoryPercentAtStart: number;
}

interface ReceiverCounts {
  readonly sites: number;
  readonly resolved: number;
  readonly unresolved: number;
  readonly unsupported: number;
  readonly unmappedTarget: number;
  readonly resolverMs: number;
}

interface RunOptions {
  readonly repositoriesDirectory: string;
  readonly outputDirectory: string;
  readonly tierAHeapMb: number;
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function measurementImplementationFingerprint(): string {
  const digest = createHash("sha256");
  for (const relativePath of MEASUREMENT_SOURCE_FILES) {
    digest.update(relativePath).update("\0");
    digest.update(readFileSync(path.join(ROOT, relativePath)));
    digest.update("\0");
  }
  return digest.digest("hex");
}

function readJson<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, "utf8")) as T;
}

function writeJsonLines(filePath: string, rows: readonly unknown[]): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp-${process.pid}`;
  writeFileSync(
    temporary,
    rows.map((row) => JSON.stringify(row)).join(JSONL_SUFFIX) + JSONL_SUFFIX,
    "utf8",
  );
  renameSync(temporary, filePath);
}

export function appendRows<T>(target: T[], rows: readonly T[]): void {
  for (const row of rows) target.push(row);
}

function readManifest(): {
  readonly corpus: CorpusManifest;
  readonly spec: { readonly snapshots: readonly CorpusSnapshotSpec[] };
  readonly report: { readonly snapshots: readonly CollectionSnapshot[] };
  readonly files: Readonly<Record<string, string>>;
} {
  const manifestPath = path.join(CORPUS_DIRECTORY, "corpus-manifest.json");
  const collectionPath = path.join(CORPUS_DIRECTORY, "collection-report.json");
  const specPath = path.join(
    ROOT,
    "evaluate/semantic-corpus/corpus-spec.v1.json",
  );
  const corpusBytes = readFileSync(manifestPath);
  const corpus = JSON.parse(
    corpusBytes.toString("utf8"),
    (key: string, value: unknown) =>
      key === "candidates" || key === "oracle" || key === "review"
        ? undefined
        : value,
  ) as CorpusManifest;
  const spec = readJson<{ snapshots: readonly CorpusSnapshotSpec[] }>(specPath);
  const report = readJson<{ snapshots: readonly CollectionSnapshot[] }>(
    collectionPath,
  );
  const files = {
    corpusManifestSha256: sha256(corpusBytes),
    collectionReportSha256: sha256(readFileSync(collectionPath)),
    corpusSpecSha256: sha256(readFileSync(specPath)),
  };
  if (corpus.samples.length === 0)
    throw new Error("Pinned corpus has no samples.");
  return { corpus, spec, report, files };
}

function readSystem1States(): {
  readonly states: Map<string, System1QueryState>;
  readonly files: Readonly<Record<string, string>>;
} {
  const states = new Map<string, System1QueryState>();
  const files: Record<string, string> = {};
  for (const split of ["train", "calibration", "temporal", "test"]) {
    const statesPath = path.join(
      ROOT,
      `evaluate/results/semantic-corpus/v1/system1-dataset-v2/${split}-state.jsonl`,
    );
    try {
      const bytes = readFileSync(statesPath);
      files[`${split}StateSha256`] = sha256(bytes);
      const lines = bytes.toString("utf8").split(/\r?\n/).filter(Boolean);
      for (const line of lines) {
        const state = JSON.parse(line) as System1QueryState;
        const requestId = state.request.requestId;
        if (states.has(requestId))
          throw new Error(`Duplicate System1 state request ${requestId}.`);
        states.set(requestId, state);
      }
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.startsWith("Duplicate System1")
      )
        throw error;
      if (
        error instanceof Error &&
        "code" in error &&
        (error as NodeJS.ErrnoException).code === "ENOENT"
      ) {
        files[`${split}StateSha256`] = "missing";
        continue;
      }
      throw error;
    }
  }
  return { states, files };
}

function sourceSnapshotKey(source: {
  readonly repoId: string;
  readonly revision: string;
  readonly snapshotHash: string;
}): string {
  return `${source.repoId}\0${source.revision}\0${source.snapshotHash}`;
}

export function isTrackedSafetyRelevantPath(filePath: string): boolean {
  return isSnapshotPath(filePath) || isDiscoverableSourceFile(filePath);
}

function readCallSiteId(value: string): {
  readonly filePath: string;
  readonly line: number;
  readonly column: number;
} {
  const match = /^(.*):(\d+):(\d+)$/.exec(value);
  if (!match) throw new Error(`Malformed callSiteId: ${value}`);
  return {
    filePath: match[1].replaceAll("\\", "/"),
    line: Number(match[2]),
    column: Number(match[3]),
  };
}

function scriptKind(filePath: string): ts.ScriptKind {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".tsx") return ts.ScriptKind.TSX;
  if (extension === ".jsx") return ts.ScriptKind.JSX;
  if ([".js", ".mjs", ".cjs"].includes(extension)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

function terminalCalleeName(
  call: ts.CallExpression,
  sourceFile: ts.SourceFile,
): string | null {
  if (ts.isIdentifier(call.expression)) return call.expression.text;
  if (ts.isPropertyAccessExpression(call.expression))
    return call.expression.name.text;
  if (ts.isElementAccessExpression(call.expression))
    return call.expression.argumentExpression?.getText(sourceFile) ?? null;
  return null;
}

function parsePositionedMapping(
  source: SourceCallSiteRow,
  sourceFile: ts.SourceFile | undefined,
  sourceText: string | null,
): CallSitePositionMapping | null {
  if (!sourceFile || sourceText === null) return null;
  return mapCallExpressionAtPosition(
    sourceFile,
    sourceText,
    source.line,
    source.column,
  );
}

function sourceMetadata(
  sample: SourceOnlyCorpusSample,
  snapshot: CollectionSnapshot,
): CorpusSource {
  return {
    sampleId: sample.sampleId,
    repoId: sample.source.repoId,
    repoFamily: sample.source.repoFamily,
    revision: sample.source.revision,
    snapshotId: snapshot.snapshotId,
    subtree: snapshot.subtree,
    snapshotHash: sample.source.snapshotHash,
    projectId: sample.source.projectId,
    split: sample.source.split,
    duplicateGroup: sample.source.duplicateGroup,
    callSiteId: sample.source.callSiteId,
  };
}

function labelMetadata(
  sample: LabeledCorpusSample,
  snapshot: CollectionSnapshot,
): LabelSidecarRow {
  return {
    ...sourceMetadata(sample, snapshot),
    candidateTargetIds: sample.candidates.map(
      (candidate) => candidate.targetId,
    ),
    positiveTargetIds: [...sample.review.positiveTargetIds],
    negativeTargetIds: [...(sample.review.negativeTargetIds ?? [])],
    oracleStatus: sample.oracle.status,
    oracleTargetIds: [...sample.oracle.targetIds],
    reviewStatus: sample.review.status,
    evidenceRefs: [...(sample.review.evidenceRefs ?? [])],
  };
}

function labelsBySample(
  rows: readonly LabelSidecarRow[],
): Map<string, BaselineLabel> {
  return new Map(
    rows.map((row) => [
      row.sampleId,
      {
        candidateTargetIds: row.candidateTargetIds,
        positiveTargetIds: row.positiveTargetIds,
      },
    ]),
  );
}

function sourceFilesForSnapshot(
  snapshotRoot: string,
  samples: readonly SourceOnlyCorpusSample[],
  fileHashes: ReadonlyMap<string, string>,
): {
  readonly discovered: Array<{ file: string; hash: string; code: string }>;
  readonly sourceFiles: ReadonlyMap<string, SourceFileContent>;
  readonly sourceCodeByFile: ReadonlyMap<string, string>;
  readonly trackedSourceFileCount: number;
} {
  const samplePaths = new Set(
    samples.map((sample) => readCallSiteId(sample.source.callSiteId).filePath),
  );
  const discovered: Array<{ file: string; hash: string; code: string }> = [];
  const sourceFiles = new Map<string, SourceFileContent>();
  const sourceCodeByFile = new Map<string, string>();
  let trackedSourceFileCount = 0;
  const trackedFiles = git(snapshotRoot, ["ls-files", "-z"])
    .split("\0")
    .filter(Boolean)
    .sort();

  for (const file of trackedFiles) {
    if (!isDiscoverableSourceFile(file)) continue;
    trackedSourceFileCount++;
    const pinnedHash = fileHashes.get(file);
    const inspected = readSnapshotSourceFile(
      snapshotRoot,
      file,
      MAX_FILE_SIZE_BYTES,
    );
    if (inspected.status === "excluded") {
      if (samplePaths.has(file))
        sourceFiles.set(file, {
          hash: pinnedHash ?? "",
          code: null,
          exclusionReason: inspected.reason,
        });
      continue;
    }
    const { bytes } = inspected;
    // Some uppercase TS/JS extensions are discoverable by the parser but omitted by the
    // case-sensitive snapshot manifest matcher. Keep their call-site identity content-bound.
    const hash = pinnedHash ?? sha256(bytes);
    const code = bytes.toString("utf8");
    sourceCodeByFile.set(file, code);
    discovered.push({ file, hash, code });
    if (samplePaths.has(file)) sourceFiles.set(file, { hash, code });
  }
  for (const file of samplePaths)
    if (!sourceFiles.has(file))
      sourceFiles.set(file, {
        hash: "",
        code: null,
        exclusionReason: "source-file-not-discoverable-or-not-tracked",
      });
  return {
    discovered,
    sourceFiles,
    sourceCodeByFile,
    trackedSourceFileCount,
  };
}

function sourceRowsForSnapshot(
  samples: readonly SourceOnlyCorpusSample[],
  snapshot: CollectionSnapshot,
  parsedByFile: ReadonlyMap<string, ParsedAstFileResult>,
  sourceFiles: ReadonlyMap<string, SourceFileContent>,
  resolver: ScopeResolver,
  nodeKeyIndex: ReturnType<typeof buildParsedSymbolNodeKeyIndex>,
  snapshotExclusionReason?: string,
): {
  readonly sourceRows: SourceCallSiteRow[];
  readonly baselineRows: ScopeResolverBaselineRow[];
  readonly resolverMs: number;
} {
  const sourceFileCache = new Map<string, ts.SourceFile>();
  const sourceRows: SourceCallSiteRow[] = [];
  const baselineRows: ScopeResolverBaselineRow[] = [];
  let resolverMs = 0;

  for (const sample of samples) {
    const metadata = sourceMetadata(sample, snapshot);
    const position = readCallSiteId(sample.source.callSiteId);
    const parsedFile = parsedByFile.get(position.filePath);
    const source = sourceFiles.get(position.filePath);
    let sourceFile: ts.SourceFile | undefined;
    if (source?.code !== null && source?.code !== undefined) {
      sourceFile = sourceFileCache.get(position.filePath);
      if (!sourceFile) {
        sourceFile = ts.createSourceFile(
          position.filePath,
          source.code,
          ts.ScriptTarget.Latest,
          true,
          scriptKind(position.filePath),
        );
        sourceFileCache.set(position.filePath, sourceFile);
      }
    }

    const positionMapping = parsePositionedMapping(
      {
        ...metadata,
        filePath: position.filePath,
        line: position.line,
        column: position.column,
        callSiteKey: null,
        columnUtf16: null,
        offsetUtf16: null,
        calleeKind: null,
        calleeName: null,
        receiverText: null,
        receiverCategory: "unknown",
        positionStatus: "excluded",
      },
      sourceFile,
      source?.code ?? null,
    );

    // `parsedByFile` scopes the worker call set to this exact path before coordinate matching.
    const match = parsedFile
      ? matchParsedCallAtPosition(
          parsedFile.data.calls ?? [],
          position.line,
          position.column,
        )
      : ({
          status: "excluded",
          reason: source?.exclusionReason ?? "source-file-not-parsed",
        } as const);

    let exclusionReason: string | undefined;
    if (!source?.code)
      exclusionReason = source?.exclusionReason ?? "source-file-not-available";
    else if (positionMapping?.status === "excluded")
      exclusionReason = positionMapping.reason;
    else if (match.status === "excluded") exclusionReason = match.reason;

    const rawCall = match.status === "unique" ? match.call : undefined;
    if (
      rawCall &&
      positionMapping?.status === "unique" &&
      rawCall.calleeName &&
      terminalCalleeName(positionMapping.callExpression, sourceFile!) !==
        null &&
      rawCall.calleeName !==
        terminalCalleeName(positionMapping.callExpression, sourceFile!)
    )
      exclusionReason = "worker-call-callee-name-mismatch";
    if (snapshotExclusionReason) exclusionReason = snapshotExclusionReason;

    const uniquePosition =
      !exclusionReason && rawCall && positionMapping?.status === "unique";
    const callSiteKey =
      rawCall && source?.hash
        ? portableCallSiteKey({
            filePath: position.filePath,
            fileContentHash: source.hash,
            row: position.line,
            columnUtf16: position.column,
            calleeKind: rawCall.calleeKind ?? "unknown",
            calleeName: rawCall.calleeName ?? rawCall.targetFunction,
          })
        : null;
    const imports = parsedFile?.data.imports ?? [];
    const locals = new Set([
      ...(parsedFile?.data.functions ?? []).map((item) => item.name),
      ...(parsedFile?.data.classes ?? []).map((item) => item.name),
      ...(parsedFile?.data.variables ?? []).map((item) => item.name),
    ]);
    const classification = rawCall
      ? classifyReceiver(rawCall, imports, locals)
      : {
          receiverCategory: "unknown" as const,
          resolverRouteHint: "none" as const,
        };
    const sourceRow: SourceCallSiteRow = {
      ...metadata,
      callSiteKey,
      filePath: position.filePath,
      line: position.line,
      column: position.column,
      columnUtf16:
        positionMapping?.status === "unique"
          ? positionMapping.position.columnUtf16
          : null,
      offsetUtf16:
        positionMapping?.status === "unique"
          ? positionMapping.position.offsetUtf16
          : null,
      calleeKind: rawCall?.calleeKind ?? null,
      calleeName: rawCall?.calleeName ?? null,
      receiverText: rawCall?.receiverText ?? null,
      receiverCategory: classification.receiverCategory,
      positionStatus: uniquePosition ? "unique" : "excluded",
      ...(uniquePosition
        ? {}
        : {
            exclusionReason: exclusionReason ?? "position-not-uniquely-mapped",
          }),
    };
    sourceRows.push(sourceRow);

    let scopeResolverStatus: ScopeResolverBaselineRow["scopeResolverStatus"] =
      "not-run";
    let resolverPath: ScopeResolverBaselineRow["resolverPath"] = null;
    let resolverTargetRef: ScopeResolverTarget | null = null;
    let resolverTargetId: string | null = null;
    let resolverLatencyMs: number | null = null;
    let callerNodeKey: string | null = null;
    let graphEdgeStatus: ScopeResolverBaselineRow["graphEdgeStatus"] =
      "not-run";
    // Preserve the product's actual Tier A proposal even when this corpus coordinate is
    // excluded from TypeScript evaluation. The exclusion remains explicit in the source row.
    if (rawCall) {
      const started = performance.now();
      const proposal = resolveScopeResolverProposal(
        resolver,
        position.filePath,
        rawCall,
      );
      resolverLatencyMs = performance.now() - started;
      resolverMs += resolverLatencyMs;
      resolverPath = proposal.resolverPath;
      if (proposal.status === "unsupported") {
        scopeResolverStatus = "unsupported";
        graphEdgeStatus = "no-target";
      } else if (proposal.status === "unresolved") {
        scopeResolverStatus = "unresolved";
        graphEdgeStatus = "no-target";
      } else {
        resolverTargetRef = proposal.target;
        resolverTargetId = nodeKeyForResolverTarget(
          nodeKeyIndex,
          proposal.target,
        );
        callerNodeKey = nodeKeyForSourceFunction(
          nodeKeyIndex,
          position.filePath,
          rawCall.sourceFunction,
        );
        scopeResolverStatus = resolverTargetId ? "resolved" : "unmapped-target";
        graphEdgeStatus = !resolverTargetId
          ? "no-target"
          : resolverTargetId === callerNodeKey
            ? "self-discarded"
            : "linked";
      }
    }
    baselineRows.push({
      sampleId: sample.sampleId,
      repoFamily: sample.source.repoFamily,
      split: sample.source.split,
      duplicateGroup: sample.source.duplicateGroup,
      callShape: rawCall?.calleeKind ?? "unknown",
      positionStatus: sourceRow.positionStatus,
      scopeResolverStatus,
      resolverTargetId,
      callSiteKey,
      snapshotId: snapshot.snapshotId,
      filePath: position.filePath,
      line: position.line,
      column: position.column,
      receiverCategory: classification.receiverCategory,
      resolverPath,
      resolverTargetRef,
      resolverLatencyMs,
      callerNodeKey,
      graphEdgeStatus,
    });
  }
  return { sourceRows, baselineRows, resolverMs };
}

function replayDeterministicQueries(
  sourceRows: readonly SourceCallSiteRow[],
  statesByRequestId: ReadonlyMap<string, System1QueryState>,
  sourceIndex: System1QuerySourceIndex,
): {
  readonly rows: DeterministicQueryBaselineRow[];
  readonly latencies: number[];
} {
  const rows: DeterministicQueryBaselineRow[] = [];
  const latencies: number[] = [];
  const abstain = (reason: string): System1QueryResult => ({
    status: "abstain",
    reason,
  });
  for (const source of sourceRows) {
    const requestId = system1RequestId(source.sampleId);
    const state = statesByRequestId.get(requestId);
    let queryState: DeterministicQueryBaselineRow["queryState"];
    let queryStateReason: string | null = null;
    let results: Omit<System1QueryResults, "cascade"> | null = null;
    let latencyMs: number | null = null;
    if (!state) {
      queryState = "no-state";
      queryStateReason = "no-system1-state";
    } else if (
      source.positionStatus !== "unique" ||
      source.columnUtf16 === null
    ) {
      queryState = "position-excluded";
      queryStateReason = source.exclusionReason ?? "source-position-excluded";
    } else {
      try {
        const started = performance.now();
        const resolved = resolveSystem1DeterministicQueries(
          state,
          sourceIndex,
          { line: source.line, column: source.columnUtf16 },
        );
        latencyMs = performance.now() - started;
        latencies.push(latencyMs);
        queryState = "evaluated";
        results = resolved;
      } catch {
        queryState = "error";
        queryStateReason = "deterministic-query-error";
      }
    }
    const unresolved = queryStateReason ?? "no-query-commit";
    rows.push({
      ...source,
      evidenceKind: "phase0-deterministic-query-baseline-only",
      requestId,
      queryState,
      queryStateReason,
      q1: results?.q1 ?? abstain(unresolved),
      q2: results?.q2 ?? abstain(unresolved),
      q3: results?.q3 ?? abstain(unresolved),
      cascade: results?.cascade ?? {
        status: "abstain",
        reason: "no-query-commit",
      },
      latencyMs,
    });
  }
  return { rows, latencies };
}

function deterministicMetricRows(
  rows: readonly DeterministicQueryBaselineRow[],
  query: "q1" | "q2" | "q3" | "cascade",
): BaselineCallRow[] {
  return rows.map((row) => {
    const result = row[query];
    const committed = result.status === "commit";
    return {
      sampleId: row.sampleId,
      repoFamily: row.repoFamily,
      split: row.split,
      duplicateGroup: row.duplicateGroup,
      receiverCategory: row.receiverCategory,
      callShape: row.calleeKind ?? "unknown",
      positionStatus: row.positionStatus,
      scopeResolverStatus:
        row.queryState !== "evaluated"
          ? "not-run"
          : committed
            ? "resolved"
            : "unresolved",
      resolverTargetId: committed ? result.targetId : null,
    };
  });
}

function scorePartialSemanticRows(
  rows: readonly PartialSemanticReplayRow[],
  sourcesBySample: ReadonlyMap<string, SourceCallSiteRow>,
  nodeKeyIndex: ReturnType<typeof buildParsedSymbolNodeKeyIndex>,
  persistedNodeKeys: ReadonlySet<string>,
): PartialSemanticScoringRow[] {
  return rows.map((row) => {
    const source = sourcesBySample.get(row.sampleId);
    if (!source)
      throw new Error(
        `PartialSemantic row has no source row: ${row.sampleId}.`,
      );
    const mappingStatuses: PartialSemanticScoringRow["mappingStatuses"][number][] =
      [];
    const mappedDefinitionTargetIds: string[] = [];
    for (const definition of row.definitions) {
      if (definition.external) {
        mappingStatuses.push({ status: "external" });
        continue;
      }
      if (!definition.symbolName) {
        mappingStatuses.push({ status: "no-symbol-name" });
        continue;
      }
      if (definition.startLine === null) {
        mappingStatuses.push({ status: "no-source-span" });
        continue;
      }
      const match = nodeKeyForParsedDeclarationAtPosition(
        nodeKeyIndex,
        definition.filePath,
        definition.symbolName,
        definition.startLine,
        definition.containerName,
      );
      if (match.status === "ambiguous") {
        mappingStatuses.push({ status: "ambiguous" });
        continue;
      }
      if (match.status === "not-found") {
        mappingStatuses.push({ status: "not-found" });
        continue;
      }
      if (!persistedNodeKeys.has(match.nodeKey)) {
        mappingStatuses.push({ status: "not-in-persisted-graph" });
        continue;
      }
      mappingStatuses.push({ status: "mapped", targetId: match.nodeKey });
      mappedDefinitionTargetIds.push(match.nodeKey);
    }
    return {
      sampleId: row.sampleId,
      snapshotId: row.snapshotId,
      callSiteKey: row.callSiteKey,
      evidenceKind: "tier-b0-measurement-only",
      status: row.status,
      positionStatus: source.positionStatus,
      callShape: source.calleeKind ?? "unknown",
      receiverCategory: source.receiverCategory,
      repoFamily: source.repoFamily,
      split: source.split,
      duplicateGroup: source.duplicateGroup,
      mappingStatuses,
      mappedDefinitionTargetIds,
      top1TargetId:
        row.status === "resolved" &&
        mappingStatuses.length === 1 &&
        mappingStatuses[0]?.status === "mapped"
          ? (mappingStatuses[0].targetId ?? null)
          : null,
      latencyMs: row.latencyMs,
    };
  });
}

function summarizePartialSemanticRows(
  rows: readonly PartialSemanticScoringRow[],
  labels: ReadonlyMap<string, BaselineLabel>,
) {
  const collect = (subset: readonly PartialSemanticScoringRow[]) => {
    const mapped = subset.filter((row) => row.positionStatus === "unique");
    const gold = subset.filter(
      (row) => (labels.get(row.sampleId)?.positiveTargetIds.length ?? 0) > 0,
    );
    const resolved = mapped.filter(
      (row) =>
        row.status === "resolved" &&
        row.mappedDefinitionTargetIds.length === 1 &&
        row.mappingStatuses.length === 1 &&
        row.mappingStatuses[0]?.status === "mapped",
    );
    const candidateCovered = gold.filter((row) => {
      const positive = labels.get(row.sampleId)?.positiveTargetIds ?? [];
      return row.mappedDefinitionTargetIds.some((target) =>
        positive.includes(target),
      );
    });
    const top1Correct = gold.filter((row) =>
      labels
        .get(row.sampleId)
        ?.positiveTargetIds.includes(row.top1TargetId ?? ""),
    );
    const labeledResolved = resolved.filter((row) => labels.has(row.sampleId));
    const latencies = subset.flatMap((row) =>
      row.latencyMs === null ? [] : [row.latencyMs],
    );
    const statuses = subset.reduce<Record<string, number>>((counts, row) => {
      counts[row.status] = (counts[row.status] ?? 0) + 1;
      return counts;
    }, {});
    const mappingStatusCounts = subset.reduce<Record<string, number>>(
      (counts, row) => {
        for (const mapping of row.mappingStatuses)
          counts[mapping.status] = (counts[mapping.status] ?? 0) + 1;
        return counts;
      },
      {},
    );
    return {
      sourceRows: subset.length,
      mappedRows: mapped.length,
      excludedRows: subset.length - mapped.length,
      goldRows: gold.length,
      resolvedRows: resolved.length,
      coverageOverMappedRows: mapped.length
        ? resolved.length / mapped.length
        : null,
      candidateCoveredRows: candidateCovered.length,
      candidateRecall: gold.length
        ? candidateCovered.length / gold.length
        : null,
      top1CorrectRows: top1Correct.length,
      top1OverGold: gold.length ? top1Correct.length / gold.length : null,
      precisionWhenResolved: labeledResolved.length
        ? labeledResolved.filter((row) =>
            labels
              .get(row.sampleId)
              ?.positiveTargetIds.includes(row.top1TargetId ?? ""),
          ).length / labeledResolved.length
        : null,
      duplicateGroups: new Set(subset.map((row) => row.duplicateGroup)).size,
      statuses,
      mappingStatusCounts,
      queryCount: latencies.length,
      queryLatencyP50Ms: quantile(latencies, 0.5),
      queryLatencyP95Ms: quantile(latencies, 0.95),
      totalQueryLatencyMs: latencies.reduce((sum, value) => sum + value, 0),
    };
  };
  const groupBy = (
    keyOf: (row: PartialSemanticScoringRow) => string | undefined,
  ) => {
    const groups = new Map<string, PartialSemanticScoringRow[]>();
    for (const row of rows) {
      const key = keyOf(row) ?? "unknown";
      const group = groups.get(key);
      if (group) group.push(row);
      else groups.set(key, [row]);
    }
    return Object.fromEntries(
      [...groups.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, subset]) => [key, collect(subset)]),
    );
  };
  return {
    ...collect(rows),
    byCallShape: groupBy((row) => row.callShape),
    byFamily: groupBy((row) => row.repoFamily),
    bySplit: groupBy((row) => row.split),
  };
}

function aggregateCalls(
  parsedResults: readonly ParsedAstFileResult[],
  snapshot: CollectionSnapshot,
  resolver: ScopeResolverLike,
  nodeKeyIndex: ReturnType<typeof buildParsedSymbolNodeKeyIndex>,
  sourceTextFor: (filePath: string) => string | null,
): {
  readonly byReceiverCategory: Readonly<Record<string, ReceiverCounts>>;
  readonly thisRows: ThisMemberBaselineRow[];
  readonly latencies: number[];
  readonly parsedCallSites: number;
  readonly predictedCallEdges: ReadonlySet<string>;
} {
  const stats = new Map<
    string,
    {
      sites: number;
      resolved: number;
      unresolved: number;
      unsupported: number;
      unmappedTarget: number;
      resolverMs: number;
    }
  >();
  const thisRows: ThisMemberBaselineRow[] = [];
  const latencies: number[] = [];
  const predictedCallEdges = new Set<string>();
  let parsedCallSites = 0;

  for (const result of parsedResults) {
    const imports = result.data.imports ?? [];
    const locals = new Set([
      ...(result.data.functions ?? []).map((item) => item.name),
      ...(result.data.classes ?? []).map((item) => item.name),
      ...(result.data.variables ?? []).map((item) => item.name),
    ]);
    for (const call of result.data.calls ?? []) {
      parsedCallSites++;
      const classification = classifyReceiver(call, imports, locals);
      const current = stats.get(classification.receiverCategory) ?? {
        sites: 0,
        resolved: 0,
        unresolved: 0,
        unsupported: 0,
        unmappedTarget: 0,
        resolverMs: 0,
      };
      current.sites++;
      const started = performance.now();
      const proposal = resolveScopeResolverProposal(
        resolver,
        result.file,
        call,
      );
      const elapsed = performance.now() - started;
      current.resolverMs += elapsed;
      latencies.push(elapsed);
      if (proposal.status === "unsupported") current.unsupported++;
      else if (proposal.status === "unresolved") current.unresolved++;
      else if (!nodeKeyForResolverTarget(nodeKeyIndex, proposal.target))
        current.unmappedTarget++;
      else {
        current.resolved++;
        const targetNodeKey = nodeKeyForResolverTarget(
          nodeKeyIndex,
          proposal.target,
        );
        const callerNodeKey = nodeKeyForSourceFunction(
          nodeKeyIndex,
          result.file,
          call.sourceFunction,
        );
        if (targetNodeKey && targetNodeKey !== callerNodeKey)
          predictedCallEdges.add(`${callerNodeKey}\0${targetNodeKey}`);
      }
      stats.set(classification.receiverCategory, current);

      if (
        call.calleeKind === "this" &&
        (call.receiverText === "this" || call.receiverText === "super") &&
        call.calleeName
      ) {
        const code = sourceTextFor(result.file);
        const identity = code
          ? portableCallSiteKey({
              filePath: result.file,
              fileContentHash: result.hash,
              row: call.startLine,
              columnUtf16: call.startColumn,
              calleeKind: call.calleeKind,
              calleeName: call.calleeName,
            })
          : null;
        const sourceFile = code
          ? ts.createSourceFile(
              result.file,
              code,
              ts.ScriptTarget.Latest,
              true,
              scriptKind(result.file),
            )
          : undefined;
        const mapping =
          sourceFile && code
            ? mapCallExpressionAtPosition(
                sourceFile,
                code,
                call.startLine,
                call.startColumn,
              )
            : null;
        const thisProposal = proposal;
        const targetRef =
          thisProposal.status === "resolved" ? thisProposal.target : null;
        thisRows.push({
          sampleId: `this-census:${snapshot.snapshotId}:${identity ?? `${result.file}:${call.startLine}:${call.startColumn}`}`,
          callSiteKey: identity,
          snapshotId: snapshot.snapshotId,
          repoId: snapshot.repoId,
          repoFamily: snapshot.family,
          revision: snapshot.revision,
          subtree: snapshot.subtree,
          snapshotHash: snapshot.snapshotHash,
          filePath: result.file,
          line: call.startLine,
          column: call.startColumn,
          columnUtf16:
            mapping?.status === "unique" ? mapping.position.columnUtf16 : null,
          offsetUtf16:
            mapping?.status === "unique" ? mapping.position.offsetUtf16 : null,
          calleeKind: call.calleeKind,
          calleeName: call.calleeName,
          receiverText: call.receiverText ?? "",
          receiverCategory: classification.receiverCategory,
          positionStatus: mapping?.status === "unique" ? "unique" : "excluded",
          ...(mapping?.status === "excluded"
            ? { exclusionReason: mapping.reason }
            : {}),
          scopeResolverStatus: thisProposal.status,
          resolverTargetRef: targetRef,
          resolverTargetId: targetRef
            ? nodeKeyForResolverTarget(nodeKeyIndex, targetRef)
            : null,
          resolverLatencyMs: elapsed,
        });
      }
    }
  }
  return {
    byReceiverCategory: Object.fromEntries(
      [...stats.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([category, counts]) => [category, counts]),
    ),
    thisRows,
    latencies,
    parsedCallSites,
    predictedCallEdges,
  };
}

function quantile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)];
}

function startRssSampler(): {
  readonly peak: () => number;
  readonly stop: () => number;
} {
  let peak = process.memoryUsage().rss;
  const timer = setInterval(() => {
    peak = Math.max(peak, process.memoryUsage().rss);
  }, RSS_SAMPLE_MS);
  timer.unref();
  return {
    peak: () => Math.max(peak, process.memoryUsage().rss),
    stop: () => {
      clearInterval(timer);
      peak = Math.max(peak, process.memoryUsage().rss);
      return peak;
    },
  };
}

async function measureTierA(
  snapshotRoot: string,
  heapMb: number,
): Promise<{ readonly wallMs: number; readonly peakRssBytes: number | null }> {
  if (!path.isAbsolute(DOCUVIA_CLI))
    throw new Error("Docuvia CLI path must be absolute.");
  const started = performance.now();
  const child = spawn(
    process.execPath,
    [`--max-old-space-size=${heapMb}`, DOCUVIA_CLI, "analyze"],
    {
      cwd: snapshotRoot,
      stdio: ["ignore", "ignore", "pipe"],
      env: offlineEnv(),
    },
  );
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });
  let peakRssBytes: number | null = null;
  const sampler = setInterval(() => {
    if (!child.pid) return;
    try {
      const rssKb = Number(
        execFileSync("ps", ["-o", "rss=", "-p", String(child.pid)], {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
        }).trim(),
      );
      if (Number.isFinite(rssKb) && rssKb > 0)
        peakRssBytes = Math.max(peakRssBytes ?? 0, rssKb * 1024);
    } catch {
      // The process may exit between the timer tick and ps invocation.
    }
  }, RSS_SAMPLE_MS);
  sampler.unref();
  const exitCode = await new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => resolve(code));
  }).finally(() => clearInterval(sampler));
  const wallMs = performance.now() - started;
  if (exitCode !== 0)
    throw new Error(
      `Tier A failed for ${snapshotRoot} (${exitCode}): ${stderr}`,
    );
  return { wallMs, peakRssBytes };
}

function parseOptions(argv: readonly string[]): RunOptions {
  const values = new Map<string, string>();
  const allowedKeys = new Set(["--repos", "--out", "--tier-a-heap-mb"]);
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (
      !key.startsWith("--") ||
      !allowedKeys.has(key) ||
      !value ||
      value.startsWith("--")
    )
      throw new Error(
        `Usage: phase0-tiered-call-resolution-runner.mts [--repos <dir>] [--out <dir>] [--tier-a-heap-mb <mb>] (unknown or incomplete option: ${key})`,
      );
    values.set(key, value);
  }
  const heapValue = Number(
    values.get("--tier-a-heap-mb") ?? DEFAULT_TIER_A_HEAP_MB,
  );
  if (!Number.isSafeInteger(heapValue) || heapValue < 512)
    throw new Error("--tier-a-heap-mb must be an integer of at least 512.");
  return {
    repositoriesDirectory: path.resolve(
      values.get("--repos") ?? DEFAULT_REPOSITORIES,
    ),
    outputDirectory: path.resolve(values.get("--out") ?? OUTPUT_DIRECTORY),
    tierAHeapMb: heapValue,
  };
}

async function run(options: RunOptions): Promise<void> {
  const implementationFingerprint = measurementImplementationFingerprint();
  const { corpus, spec, report, files: corpusInputHashes } = readManifest();
  const { states: statesByRequestId, files: stateInputHashes } =
    readSystem1States();
  const inputHashes = { ...corpusInputHashes, ...stateInputHashes };
  const reportBySnapshot = new Map(
    report.snapshots.map(
      (snapshot) => [sourceSnapshotKey(snapshot), snapshot] as const,
    ),
  );
  const specBySnapshotId = new Map(
    spec.snapshots.map((snapshot) => [snapshot.snapshotId, snapshot] as const),
  );
  const sourceSamplesBySnapshot = new Map<string, SourceOnlyCorpusSample[]>();
  const sampleSnapshot = new Map<string, CollectionSnapshot>();
  let sourceRowsProjected = 0;
  for (const sample of corpus.samples) {
    const snapshot = reportBySnapshot.get(sourceSnapshotKey(sample.source));
    if (!snapshot)
      throw new Error(
        `No pinned snapshot for corpus source ${sample.sampleId}.`,
      );
    if (snapshot.snapshotHash !== sample.source.snapshotHash)
      throw new Error(
        `Corpus/report snapshot hash mismatch for ${sample.sampleId}.`,
      );
    const sourceOnly = { sampleId: sample.sampleId, source: sample.source };
    const bucket = sourceSamplesBySnapshot.get(snapshot.snapshotId) ?? [];
    bucket.push(sourceOnly);
    sourceSamplesBySnapshot.set(snapshot.snapshotId, bucket);
    sampleSnapshot.set(sample.sampleId, snapshot);
    sourceRowsProjected++;
  }
  if (sourceRowsProjected !== corpus.samples.length)
    throw new Error("Source-only projection changed the corpus denominator.");

  const allSourceRows: SourceCallSiteRow[] = [];
  const allBaselineRows: ScopeResolverBaselineRow[] = [];
  const allThisRows: ThisMemberBaselineRow[] = [];
  const allDeterministicRows: DeterministicQueryBaselineRow[] = [];
  const allDeterministicLatencies: number[] = [];
  const allPartialSemanticRows: PartialSemanticReplayRow[] = [];
  const allPartialSemanticScoringRows: PartialSemanticScoringRow[] = [];
  const allPartialSemanticProjects: PartialSemanticProjectEvidence[] = [];
  const actualGraphNodeKeysBySnapshot = new Map<string, ReadonlySet<string>>();
  const snapshotSummaries: SnapshotRunSummary[] = [];
  const allResolverLatencies: number[] = [];
  const tempRoot = mkdtempSync(
    path.join(os.tmpdir(), "docuvia-phase0-replay-"),
  );
  const rssSampler = startRssSampler();
  let peakProcessRssBytes = 0;
  const workerPool = new AstWorkerPool();
  const processor = new AstProcessingService(workerPool);
  try {
    for (const [snapshotIndex, snapshot] of report.snapshots.entries()) {
      const sourceSpec = specBySnapshotId.get(snapshot.snapshotId);
      if (!sourceSpec)
        throw new Error(`Missing spec for snapshot ${snapshot.snapshotId}.`);
      const samples = (
        sourceSamplesBySnapshot.get(snapshot.snapshotId) ?? []
      ).sort((left, right) => left.sampleId.localeCompare(right.sampleId));
      const sourceDirectory = path.join(
        options.repositoriesDirectory,
        sourceSpec.sourceDir,
      );
      const revision = describeRevision(sourceDirectory, snapshot.revision);
      if (revision.revision !== snapshot.revision)
        throw new Error(`Pinned revision mismatch for ${snapshot.snapshotId}.`);
      const snapshotRoot = path.join(
        tempRoot,
        `${String(snapshotIndex).padStart(2, "0")}-${snapshot.snapshotId}`,
      );
      materializeSnapshot(
        sourceDirectory,
        revision.revision,
        snapshot.subtree,
        snapshotRoot,
      );
      const trackedSnapshotPaths = git(snapshotRoot, ["ls-files", "-z"])
        .split("\0")
        .filter((file) => file && isTrackedSafetyRelevantPath(file))
        .sort();
      const preflight = preflightSnapshotPaths(
        snapshotRoot,
        trackedSnapshotPaths,
      );
      if (preflight.trackedPathCount !== trackedSnapshotPaths.length)
        throw new Error(
          `Snapshot preflight did not cover every relevant tracked file for ${snapshot.snapshotId}.`,
        );
      const freeMemoryPercentAtStart = freeMemoryPercent();
      if (freeMemoryPercentAtStart < 12)
        throw new Error(
          `Memory headroom below 12% before ${snapshot.snapshotId}.`,
        );
      if (preflight.exclusions.length > 0) {
        const exclusionReason = `snapshot-integrity-excluded:${preflight.exclusions[0].reason}`;
        const trackedSourceFiles = trackedSnapshotPaths.filter(
          isDiscoverableSourceFile,
        ).length;
        const excluded = sourceRowsForSnapshot(
          samples,
          snapshot,
          new Map(),
          new Map(),
          new ScopeResolver(snapshotRoot),
          buildParsedSymbolNodeKeyIndex([]),
          exclusionReason,
        );
        appendRows(allSourceRows, excluded.sourceRows);
        appendRows(allBaselineRows, excluded.baselineRows);
        appendRows(
          allDeterministicRows,
          replayDeterministicQueries(
            excluded.sourceRows,
            statesByRequestId,
            new System1QuerySourceIndex(snapshotRoot, new Set()),
          ).rows,
        );
        appendRows(
          allPartialSemanticRows,
          excluded.sourceRows.map((row) => ({
            sampleId: row.sampleId,
            snapshotId: row.snapshotId,
            projectId: row.projectId,
            callSiteKey: row.callSiteKey,
            filePath: row.filePath,
            line: row.line,
            column: row.columnUtf16,
            offsetUtf16: row.offsetUtf16,
            calleeKind: row.calleeKind,
            calleeName: row.calleeName,
            positionStatus: row.positionStatus,
            exclusionReason: row.exclusionReason,
            evidenceKind: "tier-b0-measurement-only" as const,
            status: "invalid-position" as const,
            reason: exclusionReason,
            definitions: [],
            latencyMs: null,
          })),
        );
        const excludedPartialRows = allPartialSemanticRows.slice(
          allPartialSemanticRows.length - excluded.sourceRows.length,
        );
        appendRows(
          allPartialSemanticScoringRows,
          scorePartialSemanticRows(
            excludedPartialRows,
            new Map(excluded.sourceRows.map((row) => [row.sampleId, row])),
            buildParsedSymbolNodeKeyIndex([]),
            new Set(),
          ),
        );
        snapshotSummaries.push({
          snapshotStatus: "excluded",
          snapshotIntegrityExclusions: preflight.exclusions,
          preflightTrackedPaths: preflight.trackedPathCount,
          preflightSafePaths: preflight.safePathCount,
          snapshotId: snapshot.snapshotId,
          repoId: snapshot.repoId,
          revision: snapshot.revision,
          subtree: snapshot.subtree,
          expectedSnapshotHash: snapshot.snapshotHash,
          measuredSnapshotHash: null,
          trackedSourceFiles,
          oversizedSourceFiles: preflight.oversizedSourceFiles,
          parsedFiles: 0,
          parseFailures: 0,
          corpusRows: samples.length,
          mappedCorpusRows: 0,
          excludedCorpusRows: samples.length,
          parsedCallSites: 0,
          scopeResolver: {
            resolved: 0,
            unresolved: 0,
            unsupported: 0,
            unmappedTarget: 0,
            p50Ms: null,
            p95Ms: null,
            totalMs: 0,
          },
          corpusResolverMs: 0,
          graphProjection: null,
          partialSemanticWallMs: null,
          partialSemanticProjectCount: 0,
          partialSemanticProjectErrors: 0,
          byReceiverCategory: {},
          thisMemberCensus: {
            sites: 0,
            mapped: 0,
            excluded: 0,
            resolved: 0,
            unresolved: 0,
            unsupported: 0,
          },
          priorTierAWallMs: snapshot.tierA.durationMs,
          measuredTierAWallMs: null,
          tierAWallRatio: null,
          tierAChildPeakRssBytes: null,
          parseWallMs: null,
          replayWallMs: null,
          freeMemoryPercentAtStart,
        });
        console.warn(
          `[phase0] ${snapshot.snapshotId}: excluded before hashing due to ${preflight.exclusions.length} unsafe tracked path(s).`,
        );
        rmSync(snapshotRoot, { recursive: true, force: true });
        continue;
      }
      const measuredHash = hashSnapshot(snapshotRoot);
      if (measuredHash.hash !== snapshot.snapshotHash)
        throw new Error(
          `Pinned snapshot hash mismatch for ${snapshot.snapshotId}: ${measuredHash.hash}`,
        );
      assertClean(snapshotRoot);
      console.info(
        `[phase0] ${snapshotIndex + 1}/${report.snapshots.length} ${snapshot.snapshotId}: verified ${measuredHash.hash}`,
      );

      const tierA = await measureTierA(snapshotRoot, options.tierAHeapMb);
      assertClean(snapshotRoot);
      const {
        discovered,
        sourceFiles,
        sourceCodeByFile,
        trackedSourceFileCount,
      } = sourceFilesForSnapshot(snapshotRoot, samples, measuredHash.files);
      const parseStarted = performance.now();
      const parsed = await processor.processFiles(snapshotRoot, discovered);
      const parseWallMs = performance.now() - parseStarted;
      const parsedByFile = new Map(
        parsed.parsed.map((result) => [result.file, result] as const),
      );
      const resolver = new ScopeResolver(snapshotRoot);
      registerScopeResolverFiles(resolver, parsed.parsed);
      const nodeKeyIndex = buildParsedSymbolNodeKeyIndex(parsed.parsed);
      const replayStarted = performance.now();
      const mapped = sourceRowsForSnapshot(
        samples,
        snapshot,
        parsedByFile,
        sourceFiles,
        resolver,
        nodeKeyIndex,
      );
      const sourceIndex = new System1QuerySourceIndex(
        snapshotRoot,
        new Set(measuredHash.files.keys()),
      );
      const deterministicReplay = replayDeterministicQueries(
        mapped.sourceRows,
        statesByRequestId,
        sourceIndex,
      );
      const partialSemanticStarted = performance.now();
      const partialSemantic = replayPartialSemanticRows({
        snapshotRoot,
        snapshotId: snapshot.snapshotId,
        sites: mapped.sourceRows.map((row) => ({
          sampleId: row.sampleId,
          snapshotId: row.snapshotId,
          projectId: row.projectId,
          callSiteKey: row.callSiteKey,
          filePath: row.filePath,
          line: row.line,
          column: row.columnUtf16,
          offsetUtf16: row.offsetUtf16,
          calleeKind: row.calleeKind,
          calleeName: row.calleeName,
          positionStatus: row.positionStatus,
          ...(row.exclusionReason === undefined
            ? {}
            : { exclusionReason: row.exclusionReason }),
        })),
        snapshotFiles: new Set(measuredHash.files.keys()),
      });
      const partialSemanticWallMs = performance.now() - partialSemanticStarted;
      const allCalls = aggregateCalls(
        parsed.parsed,
        snapshot,
        resolver,
        nodeKeyIndex,
        (filePath) => {
          return sourceCodeByFile.get(filePath) ?? null;
        },
      );
      const actualGraph = readTierAGraph(snapshotRoot);
      actualGraphNodeKeysBySnapshot.set(
        snapshot.snapshotId,
        new Set(actualGraph.nodes.map((node) => node.nodeKey)),
      );
      const persistedCalls = actualGraph.edges
        .filter((edge) => edge.kind === "calls")
        .map((edge) => `${edge.sourceKey}\0${edge.targetKey}`);
      const persistedCallEdgeSet = new Set(persistedCalls);
      const matchingCallEdges = [...allCalls.predictedCallEdges].filter(
        (edge) => persistedCallEdgeSet.has(edge),
      ).length;
      const graphProjection = {
        predictedCallEdges: allCalls.predictedCallEdges.size,
        persistedCallEdges: persistedCallEdgeSet.size,
        matchingCallEdges,
        predictedOnly: [...allCalls.predictedCallEdges].filter(
          (edge) => !persistedCallEdgeSet.has(edge),
        ).length,
        persistedOnly: [...persistedCallEdgeSet].filter(
          (edge) => !allCalls.predictedCallEdges.has(edge),
        ).length,
        exactMatch:
          allCalls.predictedCallEdges.size === persistedCallEdgeSet.size &&
          matchingCallEdges === persistedCallEdgeSet.size,
      };
      const replayWallMs = performance.now() - replayStarted;
      appendRows(allSourceRows, mapped.sourceRows);
      appendRows(allBaselineRows, mapped.baselineRows);
      appendRows(allThisRows, allCalls.thisRows);
      appendRows(allDeterministicRows, deterministicReplay.rows);
      appendRows(allDeterministicLatencies, deterministicReplay.latencies);
      appendRows(allPartialSemanticRows, partialSemantic.rows);
      appendRows(
        allPartialSemanticScoringRows,
        scorePartialSemanticRows(
          partialSemantic.rows,
          new Map(mapped.sourceRows.map((row) => [row.sampleId, row])),
          nodeKeyIndex,
          new Set(actualGraph.nodes.map((node) => node.nodeKey)),
        ),
      );
      appendRows(
        allPartialSemanticProjects,
        partialSemantic.projects.map((project) => ({
          snapshotId: snapshot.snapshotId,
          projectId: project.projectId,
          status: project.status,
          inputSiteCount: project.inputSiteCount,
          queriedSiteCount: project.queriedSiteCount,
          failedSiteCount: project.failedSiteCount,
          typescriptVersion: project.typescriptVersion,
          languageServiceMode: project.languageServiceMode,
          configHash: project.configHash,
          compilerOptions: project.compilerOptions,
          rootFileCount: project.rootFiles.length,
          programFileCount: project.programFiles.length,
          startupMs: project.startupMs,
          readyMs: project.readyMs,
          ...(project.error === undefined ? {} : { error: project.error }),
        })),
      );
      appendRows(allResolverLatencies, allCalls.latencies);
      const baselineCallRows = allCalls.parsedCallSites;
      const counts = {
        resolved: 0,
        unresolved: 0,
        unsupported: 0,
        unmappedTarget: 0,
      };
      for (const values of Object.values(allCalls.byReceiverCategory)) {
        counts.resolved += values.resolved;
        counts.unresolved += values.unresolved;
        counts.unsupported += values.unsupported;
        counts.unmappedTarget += values.unmappedTarget;
      }
      const thisRows = allCalls.thisRows;
      snapshotSummaries.push({
        snapshotStatus: "measured",
        snapshotIntegrityExclusions: [],
        preflightTrackedPaths: preflight.trackedPathCount,
        preflightSafePaths: preflight.safePathCount,
        snapshotId: snapshot.snapshotId,
        repoId: snapshot.repoId,
        revision: snapshot.revision,
        subtree: snapshot.subtree,
        expectedSnapshotHash: snapshot.snapshotHash,
        measuredSnapshotHash: measuredHash.hash,
        trackedSourceFiles: trackedSourceFileCount,
        oversizedSourceFiles: preflight.oversizedSourceFiles,
        parsedFiles: parsed.parsed.length,
        parseFailures: parsed.failures.length,
        corpusRows: samples.length,
        mappedCorpusRows: mapped.sourceRows.filter(
          (row) => row.positionStatus === "unique",
        ).length,
        excludedCorpusRows: mapped.sourceRows.filter(
          (row) => row.positionStatus === "excluded",
        ).length,
        parsedCallSites: baselineCallRows,
        scopeResolver: {
          ...counts,
          p50Ms: quantile(allCalls.latencies, 0.5),
          p95Ms: quantile(allCalls.latencies, 0.95),
          totalMs: allCalls.latencies.reduce((sum, value) => sum + value, 0),
        },
        corpusResolverMs: mapped.resolverMs,
        graphProjection,
        partialSemanticWallMs,
        partialSemanticProjectCount: partialSemantic.projects.length,
        partialSemanticProjectErrors: partialSemantic.projects.filter(
          (project) => project.status !== "ready",
        ).length,
        byReceiverCategory: allCalls.byReceiverCategory,
        thisMemberCensus: {
          sites: thisRows.length,
          mapped: thisRows.filter((row) => row.positionStatus === "unique")
            .length,
          excluded: thisRows.filter((row) => row.positionStatus === "excluded")
            .length,
          resolved: thisRows.filter(
            (row) => row.scopeResolverStatus === "resolved",
          ).length,
          unresolved: thisRows.filter(
            (row) => row.scopeResolverStatus === "unresolved",
          ).length,
          unsupported: thisRows.filter(
            (row) => row.scopeResolverStatus === "unsupported",
          ).length,
        },
        priorTierAWallMs: snapshot.tierA.durationMs,
        measuredTierAWallMs: tierA.wallMs,
        tierAWallRatio:
          snapshot.tierA.durationMs > 0
            ? tierA.wallMs / snapshot.tierA.durationMs
            : null,
        tierAChildPeakRssBytes: tierA.peakRssBytes,
        parseWallMs,
        replayWallMs,
        freeMemoryPercentAtStart,
      });
      console.info(
        `[phase0] ${snapshot.snapshotId}: ${samples.length} corpus rows, ${mapped.sourceRows.filter((row) => row.positionStatus === "unique").length} mapped, ${allCalls.parsedCallSites} parsed calls, ${thisRows.length} this/super sites; parse ${parseWallMs.toFixed(1)}ms, replay ${replayWallMs.toFixed(1)}ms, Tier A ${tierA.wallMs.toFixed(1)}ms.`,
      );
      rmSync(snapshotRoot, { recursive: true, force: true });
    }
  } finally {
    peakProcessRssBytes = rssSampler.stop();
    rmSync(tempRoot, { recursive: true, force: true });
    // AstProcessingService terminates workers after each batch. This is a safe finalizer if a
    // snapshot failed before `processFiles` reached its own terminate path.
    await workerPool.terminate().catch(() => undefined);
    if (peakProcessRssBytes <= 0)
      throw new Error("RSS sampler did not observe process memory.");
  }

  const corpusSampleIds = new Set(
    corpus.samples.map((sample) => sample.sampleId),
  );
  assertExactSampleCoverage("callsites", corpusSampleIds, allSourceRows);
  assertExactSampleCoverage(
    "scope-resolver-baseline",
    corpusSampleIds,
    allBaselineRows,
  );
  assertExactSampleCoverage(
    "deterministic-query-baseline",
    corpusSampleIds,
    allDeterministicRows,
  );
  assertExactSampleCoverage(
    "partial-semantic",
    corpusSampleIds,
    allPartialSemanticRows,
  );
  assertExactSampleCoverage(
    "partial-semantic-evaluation",
    corpusSampleIds,
    allPartialSemanticScoringRows,
  );

  const labeledCorpusBytes = readFileSync(
    path.join(CORPUS_DIRECTORY, "corpus-manifest.json"),
  );
  if (sha256(labeledCorpusBytes) !== inputHashes.corpusManifestSha256)
    throw new Error("Pinned corpus manifest changed before label join.");
  const labeledCorpus = JSON.parse(labeledCorpusBytes.toString("utf8")) as {
    readonly samples: readonly LabeledCorpusSample[];
  };
  if (labeledCorpus.samples.length !== corpus.samples.length)
    throw new Error("Label join changed the pinned corpus denominator.");
  const labeledSampleIds = new Set(
    labeledCorpus.samples.map((sample) => sample.sampleId),
  );
  assertExactSampleCoverage("labels", corpusSampleIds, labeledCorpus.samples);
  const sourceBySample = new Map(
    corpus.samples.map((sample) => [sample.sampleId, sample] as const),
  );
  const labels = labeledCorpus.samples.map((sample) => {
    const sourceSample = sourceBySample.get(sample.sampleId);
    if (
      !sourceSample ||
      sample.source.repoId !== sourceSample.source.repoId ||
      sample.source.revision !== sourceSample.source.revision ||
      sample.source.projectId !== sourceSample.source.projectId ||
      sample.source.callSiteId !== sourceSample.source.callSiteId ||
      sample.source.snapshotHash !== sourceSample.source.snapshotHash
    )
      throw new Error(
        `Label row source identity mismatch for ${sample.sampleId}.`,
      );
    const snapshot = sampleSnapshot.get(sample.sampleId);
    if (!snapshot)
      throw new Error(`Lost label snapshot for ${sample.sampleId}.`);
    return labelMetadata(sample, snapshot);
  });
  const baselineSummary = summarizeBaselineRows(
    allBaselineRows,
    labelsBySample(labels),
  );
  const scoringLabels = labelsBySample(labels);
  const partialSemanticMetrics = summarizePartialSemanticRows(
    allPartialSemanticScoringRows,
    scoringLabels,
  );
  const deterministicQueryNames = ["q1", "q2", "q3", "cascade"] as const;
  const deterministicQueryMetrics = Object.fromEntries(
    deterministicQueryNames.map((query) => {
      const projected = deterministicMetricRows(allDeterministicRows, query);
      const metrics = summarizeBaselineRows(projected, scoringLabels);
      const commits = projected.filter(
        (row) => row.scopeResolverStatus === "resolved",
      ).length;
      const abstentionReasons = allDeterministicRows.reduce<
        Record<string, number>
      >((counts, row) => {
        const result = row[query];
        if (result.status === "abstain")
          counts[result.reason] = (counts[result.reason] ?? 0) + 1;
        return counts;
      }, {});
      const worstFamily = Object.entries(metrics.byFamily)
        .filter(([, family]) => family.goldRows > 0)
        .sort(
          ([leftName, left], [rightName, right]) =>
            (left.resolverTop1OverGold ?? 0) -
              (right.resolverTop1OverGold ?? 0) ||
            leftName.localeCompare(rightName),
        )[0];
      const byCallShapeOutcomes = Object.fromEntries(
        [
          ...new Set(
            allDeterministicRows.map((row) => row.calleeKind ?? "unknown"),
          ),
        ]
          .sort()
          .map((shape) => {
            const shapeRows = allDeterministicRows.filter(
              (row) => (row.calleeKind ?? "unknown") === shape,
            );
            const statuses: Record<string, number> = {};
            const queryStates: Record<string, number> = {};
            for (const row of shapeRows) {
              const result = row[query];
              const status =
                result.status === "commit"
                  ? "commit"
                  : `abstain:${result.reason}`;
              statuses[status] = (statuses[status] ?? 0) + 1;
              queryStates[row.queryState] =
                (queryStates[row.queryState] ?? 0) + 1;
            }
            const latencies = shapeRows.flatMap((row) =>
              row.latencyMs === null ? [] : [row.latencyMs],
            );
            return [
              shape,
              {
                sourceRows: shapeRows.length,
                statuses,
                queryStates,
                requestLatency: {
                  p50Ms: quantile(latencies, 0.5),
                  p95Ms: quantile(latencies, 0.95),
                  totalMs: latencies.reduce((sum, value) => sum + value, 0),
                },
              },
            ];
          }),
      );
      const gainOverScopeResolverByCallShape = Object.fromEntries(
        Object.entries(metrics.byCallShape).map(([shape, queryShape]) => {
          const resolverTop1 =
            baselineSummary.byCallShape[shape]?.resolverTop1OverGold ?? null;
          return [
            shape,
            resolverTop1 === null || queryShape.resolverTop1OverGold === null
              ? null
              : queryShape.resolverTop1OverGold - resolverTop1,
          ];
        }),
      );
      return [
        query,
        {
          evaluatedRows: allDeterministicRows.filter(
            (row) => row.queryState === "evaluated",
          ).length,
          commits,
          abstentions: allDeterministicRows.length - commits,
          abstentionReasons,
          candidateRecall: metrics.candidateRecall,
          candidateRecallSource: "pinned-system1-candidate-pool",
          endToEndTop1OverGold: metrics.resolverTop1OverGold,
          top1GainOverScopeResolver:
            baselineSummary.resolverTop1OverGold === null ||
            metrics.resolverTop1OverGold === null
              ? null
              : metrics.resolverTop1OverGold -
                baselineSummary.resolverTop1OverGold,
          gainOverScopeResolverByCallShape,
          coverageOverEvaluatedRows: metrics.resolverEligibleRows
            ? commits / metrics.resolverEligibleRows
            : null,
          resolverPrecisionWhenResolved: metrics.resolverPrecisionWhenResolved,
          duplicateGroups: metrics.duplicateGroups,
          bySplit: metrics.bySplit,
          byFamily: metrics.byFamily,
          byReceiverCategory: metrics.byReceiverCategory,
          byCallShape: metrics.byCallShape,
          outcomesByCallShape: byCallShapeOutcomes,
          worstFamily: worstFamily
            ? {
                family: worstFamily[0],
                goldRows: worstFamily[1].goldRows,
                top1OverGold: worstFamily[1].resolverTop1OverGold,
              }
            : null,
          temporal: metrics.bySplit.temporal ?? null,
        },
      ] as const;
    }),
  );
  const positionExclusions = allSourceRows.reduce<Record<string, number>>(
    (counts, row) => {
      if (row.positionStatus === "excluded") {
        const reason = row.exclusionReason ?? "unknown";
        counts[reason] = (counts[reason] ?? 0) + 1;
      }
      return counts;
    },
    {},
  );
  const stateIntersectionRows = allSourceRows.filter((row) =>
    statesByRequestId.has(system1RequestId(row.sampleId)),
  ).length;
  const graphProjectionRows = snapshotSummaries.flatMap((row) =>
    row.graphProjection ? [row.graphProjection] : [],
  );
  const graphProjectionSummary = {
    snapshotsCompared: graphProjectionRows.length,
    exactSnapshots: graphProjectionRows.filter((row) => row.exactMatch).length,
    predictedCallEdges: graphProjectionRows.reduce(
      (sum, row) => sum + row.predictedCallEdges,
      0,
    ),
    persistedCallEdges: graphProjectionRows.reduce(
      (sum, row) => sum + row.persistedCallEdges,
      0,
    ),
    matchingCallEdges: graphProjectionRows.reduce(
      (sum, row) => sum + row.matchingCallEdges,
      0,
    ),
    predictedOnly: graphProjectionRows.reduce(
      (sum, row) => sum + row.predictedOnly,
      0,
    ),
    persistedOnly: graphProjectionRows.reduce(
      (sum, row) => sum + row.persistedOnly,
      0,
    ),
  };
  const endImplementationFingerprint = measurementImplementationFingerprint();
  if (endImplementationFingerprint !== implementationFingerprint)
    throw new Error(
      "Measurement implementation changed while the runner was active.",
    );
  const summary = {
    schemaVersion: 1,
    measurement: "phase0-tiered-call-resolution/1",
    measuredAt: new Date().toISOString(),
    repositoryBaseCommit: git(ROOT, ["rev-parse", "HEAD"]).trim(),
    implementationFingerprint,
    node: process.version,
    typescript: ts.version,
    cpuModel: os.cpus()[0]?.model ?? "unknown",
    logicalCpus: os.availableParallelism(),
    totalMemoryBytes: os.totalmem(),
    inputHashes,
    denominator: {
      manifestRows: corpus.samples.length,
      sourceRowsEmitted: allSourceRows.length,
      sourceRowsMapped: allSourceRows.filter(
        (row) => row.positionStatus === "unique",
      ).length,
      sourceRowsExplicitlyExcluded: allSourceRows.filter(
        (row) => row.positionStatus === "excluded",
      ).length,
      positionExclusions,
      snapshotPreflight: {
        trackedRelevantPathsChecked: snapshotSummaries.reduce(
          (sum, row) => sum + row.preflightTrackedPaths,
          0,
        ),
        trackedRelevantPathsSafe: snapshotSummaries.reduce(
          (sum, row) => sum + row.preflightSafePaths,
          0,
        ),
        exclusions: snapshotSummaries.flatMap((row) =>
          row.snapshotIntegrityExclusions.map((exclusion) => ({
            snapshotId: row.snapshotId,
            ...exclusion,
          })),
        ),
        oversizedSourceFiles: snapshotSummaries.flatMap((row) =>
          row.oversizedSourceFiles.map((sourceFile) => ({
            snapshotId: row.snapshotId,
            ...sourceFile,
          })),
        ),
        snapshotsExcluded: snapshotSummaries.filter(
          (row) => row.snapshotStatus === "excluded",
        ).length,
        corpusRowsInExcludedSnapshots: snapshotSummaries
          .filter((row) => row.snapshotStatus === "excluded")
          .reduce((sum, row) => sum + row.corpusRows, 0),
      },
      existingSystem1StateRows: statesByRequestId.size,
      corpusRowsFoundInSystem1State: stateIntersectionRows,
      corpusRowsOutsideSystem1State:
        allSourceRows.length - stateIntersectionRows,
      partialSemanticRowsEmitted: allPartialSemanticRows.length,
      partialSemanticEvaluationRowsEmitted:
        allPartialSemanticScoringRows.length,
    },
    pinnedSnapshots: snapshotSummaries,
    graphProjection: graphProjectionSummary,
    scopeResolverBaseline: {
      cohort:
        "all parsed Tier A worker call rows; syntax and resolver results only; no LSP labels",
      callSites: snapshotSummaries.reduce(
        (sum, row) => sum + row.parsedCallSites,
        0,
      ),
      sitesResolved: snapshotSummaries.reduce(
        (sum, row) => sum + row.scopeResolver.resolved,
        0,
      ),
      sitesUnresolved: snapshotSummaries.reduce(
        (sum, row) => sum + row.scopeResolver.unresolved,
        0,
      ),
      sitesUnsupported: snapshotSummaries.reduce(
        (sum, row) => sum + row.scopeResolver.unsupported,
        0,
      ),
      sitesWithUnmappedTarget: snapshotSummaries.reduce(
        (sum, row) => sum + row.scopeResolver.unmappedTarget,
        0,
      ),
      p50Ms: quantile(allResolverLatencies, 0.5),
      p95Ms: quantile(allResolverLatencies, 0.95),
      totalResolverMs: snapshotSummaries.reduce(
        (sum, row) => sum + row.scopeResolver.totalMs,
        0,
      ),
      byCorpusReceiverCategory: baselineSummary.byReceiverCategory,
      byCorpusCallShape: baselineSummary.byCallShape,
      corpusLabelsOnlyUsedAfterReplay: true,
      metrics: baselineSummary,
    },
    deterministicQueries: {
      cohort:
        "saved System1 states with exact source call coordinates supplied out of band; labels are joined only after Q1/Q2/Q3 execution",
      totalSourceRows: allDeterministicRows.length,
      evaluatedRows: allDeterministicRows.filter(
        (row) => row.queryState === "evaluated",
      ).length,
      noStateRows: allDeterministicRows.filter(
        (row) => row.queryState === "no-state",
      ).length,
      positionExcludedRows: allDeterministicRows.filter(
        (row) => row.queryState === "position-excluded",
      ).length,
      errorRows: allDeterministicRows.filter(
        (row) => row.queryState === "error",
      ).length,
      requestLatency: {
        p50Ms: quantile(allDeterministicLatencies, 0.5),
        p95Ms: quantile(allDeterministicLatencies, 0.95),
        totalMs: allDeterministicLatencies.reduce(
          (sum, value) => sum + value,
          0,
        ),
      },
      metricsByQuery: deterministicQueryMetrics,
      hypothesisFilterPrototype: {
        source:
          "existing Q1/Q2/Q3 combineSystem1QueryResults cascade; Phase 0 evaluation only",
        conflicts: allDeterministicRows.filter(
          (row) =>
            row.cascade.status === "abstain" &&
            row.cascade.reason === "query-conflict",
        ).length,
        confidenceCalibration: {
          status: "not-applicable",
          ece: null,
          brier: null,
          reason:
            "the deterministic resolver emits proofs or abstentions, not calibrated confidence scores",
        },
      },
    },
    partialSemantic: {
      evidenceKind: "tier-b0-measurement-only",
      mode: "PartialSemantic",
      cohort:
        "one TypeScript language service per verified snapshot/project; source-only positions, no labels passed to TypeScript",
      rows: allPartialSemanticRows.length,
      projects: allPartialSemanticProjects.length,
      projectErrors: allPartialSemanticProjects.filter(
        (project) => project.status !== "ready",
      ).length,
      statusCounts: partialSemanticMetrics.statuses,
      mappingStatusCounts: partialSemanticMetrics.mappingStatusCounts,
      candidateRecall: partialSemanticMetrics.candidateRecall,
      top1OverGold: partialSemanticMetrics.top1OverGold,
      precisionWhenResolved: partialSemanticMetrics.precisionWhenResolved,
      coverageOverMappedRows: partialSemanticMetrics.coverageOverMappedRows,
      queryLatency: {
        p50Ms: partialSemanticMetrics.queryLatencyP50Ms,
        p95Ms: partialSemanticMetrics.queryLatencyP95Ms,
        totalMs: partialSemanticMetrics.totalQueryLatencyMs,
        requests: partialSemanticMetrics.queryCount,
      },
      byCallShape: partialSemanticMetrics.byCallShape,
      byFamily: partialSemanticMetrics.byFamily,
      bySplit: partialSemanticMetrics.bySplit,
      projectStartupAndReadyMs: allPartialSemanticProjects.map((project) => ({
        snapshotId: project.snapshotId,
        projectId: project.projectId,
        status: project.status,
        startupMs: project.startupMs,
        readyMs: project.readyMs,
        inputSiteCount: project.inputSiteCount,
        queriedSiteCount: project.queriedSiteCount,
      })),
      memoryEvidence: {
        peakProcessRssBytes,
        attribution:
          "run-wide sampled peak; process RSS cannot be attributed to an individual language-service project",
      },
    },
    thisMemberCensus: {
      cohort:
        "all parsed TypeScript/JavaScript `this.m()`/`super.m()` AST call rows; unsupervised; no accuracy claim",
      sites: allThisRows.length,
      mapped: allThisRows.filter((row) => row.positionStatus === "unique")
        .length,
      excluded: allThisRows.filter((row) => row.positionStatus === "excluded")
        .length,
      resolved: allThisRows.filter(
        (row) => row.scopeResolverStatus === "resolved",
      ).length,
      bySnapshot: Object.fromEntries(
        snapshotSummaries.map((row) => [row.snapshotId, row.thisMemberCensus]),
      ),
    },
    timing: {
      resolverCallLatencyP50Ms: quantile(allResolverLatencies, 0.5),
      resolverCallLatencyP95Ms: quantile(allResolverLatencies, 0.95),
      deterministicQueryLatencyP50Ms: quantile(allDeterministicLatencies, 0.5),
      deterministicQueryLatencyP95Ms: quantile(allDeterministicLatencies, 0.95),
      totalCurrentTierAWallMs: snapshotSummaries.reduce(
        (sum, row) => sum + (row.measuredTierAWallMs ?? 0),
        0,
      ),
      totalPriorTierAWallMs: snapshotSummaries.reduce(
        (sum, row) => sum + row.priorTierAWallMs,
        0,
      ),
      aggregateTierAWallRatio: (() => {
        const prior = snapshotSummaries.reduce(
          (sum, row) => sum + row.priorTierAWallMs,
          0,
        );
        const current = snapshotSummaries.reduce(
          (sum, row) => sum + (row.measuredTierAWallMs ?? 0),
          0,
        );
        return prior > 0 ? current / prior : null;
      })(),
      peakProcessRssBytes,
      maxTierAChildPeakRssBytes: Math.max(
        0,
        ...snapshotSummaries.map((row) => row.tierAChildPeakRssBytes ?? 0),
      ),
    },
  };

  writeJsonLines(
    path.join(options.outputDirectory, "callsites.jsonl"),
    allSourceRows,
  );
  writeJsonLines(
    path.join(options.outputDirectory, "scope-resolver-baseline.jsonl"),
    allBaselineRows,
  );
  writeJsonLines(path.join(options.outputDirectory, "labels.jsonl"), labels);
  writeJsonLines(
    path.join(options.outputDirectory, "this-member-baseline.jsonl"),
    allThisRows,
  );
  writeJsonLines(
    path.join(options.outputDirectory, "deterministic-query-baseline.jsonl"),
    allDeterministicRows,
  );
  writeJsonLines(
    path.join(options.outputDirectory, "partial-semantic.jsonl"),
    allPartialSemanticRows,
  );
  writeJsonLines(
    path.join(options.outputDirectory, "partial-semantic-evaluation.jsonl"),
    allPartialSemanticScoringRows,
  );
  writeJson(path.join(options.outputDirectory, "summary.json"), summary);
  const artifactChecksums = Object.fromEntries(
    [
      "callsites.jsonl",
      "scope-resolver-baseline.jsonl",
      "labels.jsonl",
      "this-member-baseline.jsonl",
      "deterministic-query-baseline.jsonl",
      "partial-semantic.jsonl",
      "partial-semantic-evaluation.jsonl",
      "summary.json",
    ].map((file) => {
      const bytes = readFileSync(path.join(options.outputDirectory, file));
      return [file, sha256(bytes)];
    }),
  );
  writeJson(path.join(options.outputDirectory, "checksums.json"), {
    schemaVersion: 1,
    inputs: inputHashes,
    outputs: artifactChecksums,
  });
  console.info(
    `[phase0] complete: ${allSourceRows.length}/${corpus.samples.length} source rows emitted; ${summary.denominator.sourceRowsMapped} uniquely mapped, ${summary.denominator.sourceRowsExplicitlyExcluded} explicitly excluded.`,
  );
  console.info(`[phase0] output: ${options.outputDirectory}`);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const argv = process.argv.slice(2);
  if (argv.length === 1 && (argv[0] === "--help" || argv[0] === "-h")) {
    console.info(
      "Usage: phase0-tiered-call-resolution-runner.mts [--repos <dir>] [--out <dir>] [--tier-a-heap-mb <mb>]",
    );
  } else {
    const options = parseOptions(argv);
    await run(options);
  }
}
