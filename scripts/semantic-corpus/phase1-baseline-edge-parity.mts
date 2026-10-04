/** Reparse the fixed source corpus to prove Phase 1 fact determinism and old call-edge parity. */
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  isDiscoverableSourceFile,
  MAX_FILE_SIZE_BYTES,
  type AstDeclaredTypeFacts,
  type DiscoveredFile,
  type IASTWorkerPool,
  type ParsedAstFileResult,
} from "../../lib/contracts/src/index.js";
import { isSnapshotPath } from "../../lib/core/src/semantic/collection/semantic-snapshot-hash.js";
import { AstProcessingService } from "../../lib/core/src/ast/ast-processing.service.js";
import { AstWorkerPool } from "../../lib/core/src/ast/ast-worker-pool.js";
import { ScopeResolver } from "../../lib/core/src/graph/scope-resolver.js";
import {
  buildParsedSymbolNodeKeyIndex,
  nodeKeyForResolverTarget,
  nodeKeyForSourceFunction,
  registerScopeResolverFiles,
  resolveScopeResolverProposal,
} from "./phase0-tiered-call-resolution-replay.mts";
import {
  preflightSnapshotPaths,
  readSnapshotSourceFile,
} from "./phase0-snapshot-safety.mts";
import {
  describeRevision,
  git,
  hashSnapshot,
  materializeSnapshot,
} from "./snapshot.mts";

const ROOT = path.resolve(import.meta.dirname, "../..");
const DEFAULT_REPOSITORIES = path.join(os.homedir(), "Desktop", "GitHub");
const CORPUS_DIRECTORY = path.join(
  ROOT,
  "evaluate/results/semantic-corpus/v1/run-c",
);
const DEFAULT_PHASE1_DIRECTORY = path.join(
  ROOT,
  "evaluate/results/semantic-corpus/v1/phase1-tiered-call-resolution-run-1",
);
const DEFAULT_BASELINE_COMMIT = "97807ab115e16ee2a6aa7580b1b29334ad739a13";

interface SnapshotSpec {
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
}

interface Phase1CallEdgeRow {
  readonly snapshotId: string;
  readonly projection: "parsed" | "persisted";
  readonly edgeKey: string;
}

interface FactsRow {
  readonly snapshotId: string;
  readonly repoId: string;
  readonly revision: string;
  readonly snapshotHash: string;
  readonly filePath: string;
  readonly fileContentSha256: string;
  readonly declaredTypeFacts: AstDeclaredTypeFacts;
}

interface RunOptions {
  readonly repositoriesDirectory: string;
  readonly phase1Directory: string;
  readonly baselineWorkerPath: string;
  readonly baselineCommit: string;
  readonly outputDirectory: string;
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function readJson<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, "utf8")) as T;
}

function readJsonLines<T>(filePath: string): T[] {
  return readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T);
}

function jsonLines(rows: readonly unknown[]): string {
  return `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`;
}

function writeJsonLines(filePath: string, rows: readonly unknown[]): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, jsonLines(rows), "utf8");
}

function parseOptions(argv: readonly string[]): RunOptions {
  const values = new Map<string, string>();
  const allowed = new Set([
    "--repos",
    "--phase1-out",
    "--baseline-worker",
    "--baseline-commit",
    "--out",
  ]);
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (
      !key?.startsWith("--") ||
      !allowed.has(key) ||
      !value ||
      value.startsWith("--")
    )
      throw new Error(
        "Usage: phase1-baseline-edge-parity.mts [--repos <dir>] [--phase1-out <dir>] --baseline-worker <path> [--baseline-commit <sha>] [--out <dir>]",
      );
    values.set(key, value);
  }
  const baselineWorkerPath = values.get("--baseline-worker");
  if (!baselineWorkerPath)
    throw new Error(
      "--baseline-worker must name a compiled baseline AST worker.",
    );
  return {
    repositoriesDirectory: path.resolve(
      values.get("--repos") ?? DEFAULT_REPOSITORIES,
    ),
    phase1Directory: path.resolve(
      values.get("--phase1-out") ?? DEFAULT_PHASE1_DIRECTORY,
    ),
    baselineWorkerPath: path.resolve(baselineWorkerPath),
    baselineCommit: values.get("--baseline-commit") ?? DEFAULT_BASELINE_COMMIT,
    outputDirectory: path.resolve(
      values.get("--out") ??
        path.join(
          ROOT,
          "evaluate/results/semantic-corpus/v1/phase1-baseline-edge-parity",
        ),
    ),
  };
}

function fixedWorkerProcessor(workerPath?: string): {
  readonly pool: AstWorkerPool;
  readonly processor: AstProcessingService;
} {
  const pool = workerPath
    ? new AstWorkerPool(undefined, undefined, undefined, workerPath)
    : new AstWorkerPool();
  const boundedPool: IASTWorkerPool = {
    initialize: async (_workerCount?: number) => pool.initialize(2),
    parse: (request) => pool.parse(request),
    terminate: () => pool.terminate(),
    serializeBatch: (fn) => pool.serializeBatch(fn),
  };
  return { pool, processor: new AstProcessingService(boundedPool) };
}

function discoveredFiles(
  snapshotRoot: string,
  pinnedFileHashes: ReadonlyMap<string, string>,
): DiscoveredFile[] {
  const trackedFiles = git(snapshotRoot, ["ls-files", "-z"])
    .split("\0")
    .filter(Boolean)
    .sort();
  const trackedSafetyPaths = trackedFiles.filter(
    (file) => isSnapshotPath(file) || isDiscoverableSourceFile(file),
  );
  const preflight = preflightSnapshotPaths(snapshotRoot, trackedSafetyPaths);
  if (preflight.exclusions.length > 0)
    throw new Error(
      `Unsafe tracked paths in parity snapshot: ${preflight.exclusions.length}`,
    );
  const files: DiscoveredFile[] = [];
  for (const file of trackedFiles) {
    if (!isDiscoverableSourceFile(file)) continue;
    const inspected = readSnapshotSourceFile(
      snapshotRoot,
      file,
      MAX_FILE_SIZE_BYTES,
    );
    if (inspected.status !== "readable") continue;
    const hash = pinnedFileHashes.get(file) ?? sha256(inspected.bytes);
    files.push({ file, hash, code: inspected.bytes.toString("utf8") });
  }
  return files;
}

function predictedCallEdges(
  parsedResults: readonly ParsedAstFileResult[],
  snapshotRoot: string,
): ReadonlySet<string> {
  const resolver = new ScopeResolver(snapshotRoot);
  registerScopeResolverFiles(resolver, parsedResults);
  const nodeKeyIndex = buildParsedSymbolNodeKeyIndex(parsedResults);
  const edges = new Set<string>();
  for (const result of parsedResults) {
    for (const call of result.data.calls ?? []) {
      const proposal = resolveScopeResolverProposal(
        resolver,
        result.file,
        call,
      );
      if (proposal.status !== "resolved") continue;
      const target = nodeKeyForResolverTarget(nodeKeyIndex, proposal.target);
      const caller = nodeKeyForSourceFunction(
        nodeKeyIndex,
        result.file,
        call.sourceFunction,
      );
      if (target && caller && target !== caller)
        edges.add(`${caller}\0${target}`);
    }
  }
  return edges;
}

function canonicalEdgeRows(
  snapshotId: string,
  edges: ReadonlySet<string>,
): Array<{ readonly snapshotId: string; readonly edgeKey: string }> {
  return [...edges]
    .sort((left, right) => left.localeCompare(right))
    .map((edgeKey) => ({ snapshotId, edgeKey }));
}

async function run(options: RunOptions): Promise<void> {
  const spec = readJson<{ readonly snapshots: readonly SnapshotSpec[] }>(
    path.join(ROOT, "evaluate/semantic-corpus/corpus-spec.v1.json"),
  );
  const report = readJson<{
    readonly snapshots: readonly CollectionSnapshot[];
  }>(path.join(CORPUS_DIRECTORY, "collection-report.json"));
  const firstRunEdgesPath = path.join(
    options.phase1Directory,
    "call-edge-projections.jsonl",
  );
  const phase1SummaryPath = path.join(options.phase1Directory, "summary.json");
  const firstRunEdgeRows = readJsonLines<Phase1CallEdgeRow>(firstRunEdgesPath);
  const phase1Summary = readJson<{
    readonly pinnedSnapshots: readonly {
      readonly snapshotId: string;
      readonly parsedFiles: number;
      readonly parseFailures: number;
      readonly expectedSnapshotHash: string;
      readonly graphProjection: {
        readonly exactMatch: boolean;
        readonly predictedCallEdges: number;
        readonly persistedCallEdges: number;
      } | null;
    }[];
  }>(phase1SummaryPath);

  const specsById = new Map(spec.snapshots.map((row) => [row.snapshotId, row]));
  const phase1ById = new Map(
    phase1Summary.pinnedSnapshots.map((row) => [row.snapshotId, row]),
  );
  const firstRunEdgesBySnapshot = new Map<
    string,
    { parsed: string[]; persisted: string[] }
  >();
  for (const row of firstRunEdgeRows) {
    const edgeSets = firstRunEdgesBySnapshot.get(row.snapshotId) ?? {
      parsed: [],
      persisted: [],
    };
    edgeSets[row.projection].push(row.edgeKey);
    firstRunEdgesBySnapshot.set(row.snapshotId, edgeSets);
  }

  const { pool: currentPool, processor: currentProcessor } =
    fixedWorkerProcessor();
  const { pool: baselinePool, processor: baselineProcessor } =
    fixedWorkerProcessor(options.baselineWorkerPath);
  const tempRoot = mkdtempSync(
    path.join(os.tmpdir(), "docuvia-phase1-edge-parity-"),
  );
  const currentFactsRowsPassA: FactsRow[] = [];
  const currentFactsRowsPassB: FactsRow[] = [];
  const baselineEdgeRows: Array<{
    readonly snapshotId: string;
    readonly edgeKey: string;
  }> = [];
  const parityRows: Array<Record<string, unknown>> = [];
  try {
    for (const [index, snapshot] of report.snapshots.entries()) {
      const sourceSpec = specsById.get(snapshot.snapshotId);
      const firstRun = phase1ById.get(snapshot.snapshotId);
      if (!sourceSpec || !firstRun)
        throw new Error(
          `Missing pinned snapshot metadata for ${snapshot.snapshotId}.`,
        );
      const sourceDirectory = path.join(
        options.repositoriesDirectory,
        sourceSpec.sourceDir,
      );
      const revision = describeRevision(sourceDirectory, snapshot.revision);
      if (revision.revision !== snapshot.revision)
        throw new Error(`Pinned revision mismatch for ${snapshot.snapshotId}.`);
      const snapshotRoot = path.join(
        tempRoot,
        `${String(index).padStart(2, "0")}-${snapshot.snapshotId}`,
      );
      materializeSnapshot(
        sourceDirectory,
        revision.revision,
        snapshot.subtree,
        snapshotRoot,
      );
      const pinned = hashSnapshot(snapshotRoot);
      if (pinned.hash !== snapshot.snapshotHash)
        throw new Error(`Snapshot hash mismatch for ${snapshot.snapshotId}.`);
      if (firstRun.expectedSnapshotHash !== snapshot.snapshotHash)
        throw new Error(
          `Phase 1 input hash mismatch for ${snapshot.snapshotId}.`,
        );
      const files = discoveredFiles(snapshotRoot, pinned.files);

      const currentParsed = await currentProcessor.processFiles(
        snapshotRoot,
        files,
      );
      if (currentParsed.failures.length !== firstRun.parseFailures)
        throw new Error(
          `Current parser failures changed for ${snapshot.snapshotId}.`,
        );
      if (currentParsed.parsed.length !== firstRun.parsedFiles)
        throw new Error(
          `Current parsed file count changed for ${snapshot.snapshotId}.`,
        );
      const currentEdges = predictedCallEdges(
        currentParsed.parsed,
        snapshotRoot,
      );
      const edgeSets = firstRunEdgesBySnapshot.get(snapshot.snapshotId);
      if (!edgeSets)
        throw new Error(
          `Missing Phase 1 graph edge sidecar for ${snapshot.snapshotId}.`,
        );
      const currentParsedRows = canonicalEdgeRows(
        snapshot.snapshotId,
        currentEdges,
      );
      const phase1ParsedRows = edgeSets.parsed.map((edgeKey) => ({
        snapshotId: snapshot.snapshotId,
        edgeKey,
      }));
      if (jsonLines(currentParsedRows) !== jsonLines(phase1ParsedRows))
        throw new Error(
          `Current parser edge set changed for ${snapshot.snapshotId}.`,
        );

      for (const result of currentParsed.parsed) {
        const declaredTypeFacts = result.data.declaredTypeFacts;
        if (!declaredTypeFacts) continue;
        currentFactsRowsPassA.push({
          snapshotId: snapshot.snapshotId,
          repoId: snapshot.repoId,
          revision: snapshot.revision,
          snapshotHash: snapshot.snapshotHash,
          filePath: result.file,
          fileContentSha256: result.hash,
          declaredTypeFacts,
        });
      }

      const baselineParsed = await baselineProcessor.processFiles(
        snapshotRoot,
        files,
      );
      if (baselineParsed.failures.length !== currentParsed.failures.length)
        throw new Error(
          `Baseline parse failure count changed for ${snapshot.snapshotId}.`,
        );
      const baselineEdges = predictedCallEdges(
        baselineParsed.parsed,
        snapshotRoot,
      );
      const baselineRows = canonicalEdgeRows(
        snapshot.snapshotId,
        baselineEdges,
      );
      const persistedRows = edgeSets.persisted.map((edgeKey) => ({
        snapshotId: snapshot.snapshotId,
        edgeKey,
      }));
      if (jsonLines(baselineRows) !== jsonLines(phase1ParsedRows))
        throw new Error(
          `Baseline-to-current call edges differ for ${snapshot.snapshotId}.`,
        );
      if (jsonLines(baselineRows) !== jsonLines(persistedRows))
        throw new Error(
          `Baseline call edges differ from persisted graph for ${snapshot.snapshotId}.`,
        );
      baselineEdgeRows.push(...baselineRows);

      const repeatParsed = await currentProcessor.processFiles(
        snapshotRoot,
        files,
      );
      if (repeatParsed.failures.length !== currentParsed.failures.length)
        throw new Error(
          `Repeated parser failures changed for ${snapshot.snapshotId}.`,
        );
      if (repeatParsed.parsed.length !== currentParsed.parsed.length)
        throw new Error(
          `Repeated parsed file count changed for ${snapshot.snapshotId}.`,
        );
      const repeatEdges = predictedCallEdges(repeatParsed.parsed, snapshotRoot);
      const repeatEdgeRows = canonicalEdgeRows(
        snapshot.snapshotId,
        repeatEdges,
      );
      if (jsonLines(repeatEdgeRows) !== jsonLines(phase1ParsedRows))
        throw new Error(
          `Repeated current parser edges changed for ${snapshot.snapshotId}.`,
        );
      for (const result of repeatParsed.parsed) {
        const declaredTypeFacts = result.data.declaredTypeFacts;
        if (!declaredTypeFacts) continue;
        currentFactsRowsPassB.push({
          snapshotId: snapshot.snapshotId,
          repoId: snapshot.repoId,
          revision: snapshot.revision,
          snapshotHash: snapshot.snapshotHash,
          filePath: result.file,
          fileContentSha256: result.hash,
          declaredTypeFacts,
        });
      }
      parityRows.push({
        snapshotId: snapshot.snapshotId,
        revision: snapshot.revision,
        snapshotHash: snapshot.snapshotHash,
        baselineParsedFiles: baselineParsed.parsed.length,
        currentParsedFiles: currentParsed.parsed.length,
        baselineParseFailures: baselineParsed.failures.length,
        currentParseFailures: currentParsed.failures.length,
        repeatedParseFailures: repeatParsed.failures.length,
        baselineCallEdges: baselineRows.length,
        currentCallEdges: phase1ParsedRows.length,
        persistedCallEdges: persistedRows.length,
        baselineEdgesSha256: sha256(jsonLines(baselineRows)),
        currentEdgesSha256: sha256(jsonLines(phase1ParsedRows)),
        repeatedCurrentEdgesSha256: sha256(jsonLines(repeatEdgeRows)),
        persistedEdgesSha256: sha256(jsonLines(persistedRows)),
        baselineMatchesCurrent: true,
        currentMatchesPersisted: true,
        repeatedCurrentMatches: true,
      });
      console.info(
        `[phase1-parity] ${snapshot.snapshotId}: ${baselineRows.length} baseline/current/persisted call edges match byte-for-byte; ${currentFactsRowsPassA.filter((row) => row.snapshotId === snapshot.snapshotId).length} fact files re-extracted twice.`,
      );
      rmSync(snapshotRoot, { recursive: true, force: true });
    }
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
    await currentPool.terminate().catch(() => undefined);
    await baselinePool.terminate().catch(() => undefined);
  }

  currentFactsRowsPassA.sort(
    (a, b) =>
      a.snapshotId.localeCompare(b.snapshotId) ||
      a.filePath.localeCompare(b.filePath),
  );
  currentFactsRowsPassB.sort(
    (a, b) =>
      a.snapshotId.localeCompare(b.snapshotId) ||
      a.filePath.localeCompare(b.filePath),
  );
  baselineEdgeRows.sort(
    (a, b) =>
      a.snapshotId.localeCompare(b.snapshotId) ||
      a.edgeKey.localeCompare(b.edgeKey),
  );
  const passABytes = jsonLines(currentFactsRowsPassA);
  const passBBytes = jsonLines(currentFactsRowsPassB);
  const baselineEdgeBytes = jsonLines(baselineEdgeRows);
  const firstRunEdgeRowsCanonical = firstRunEdgeRows
    .filter((row) => row.projection === "parsed")
    .map((row) => ({ snapshotId: row.snapshotId, edgeKey: row.edgeKey }));
  const firstRunPersistedRowsCanonical = firstRunEdgeRows
    .filter((row) => row.projection === "persisted")
    .map((row) => ({ snapshotId: row.snapshotId, edgeKey: row.edgeKey }));
  const repeatedFactsByteMatch = passABytes === passBBytes;
  const baselineMatchesPhase1 =
    baselineEdgeBytes === jsonLines(firstRunEdgeRowsCanonical);
  const baselineMatchesPersisted =
    baselineEdgeBytes === jsonLines(firstRunPersistedRowsCanonical);
  const summary = {
    schemaVersion: 1,
    baselineCommit: options.baselineCommit,
    currentCommit: git(ROOT, ["rev-parse", "HEAD"]).trim(),
    snapshotsCompared: parityRows.length,
    factFiles: currentFactsRowsPassA.length,
    factCount: currentFactsRowsPassA.reduce(
      (sum, row) => sum + row.declaredTypeFacts.facts.length,
      0,
    ),
    correctedFactsPassesByteIdentical: repeatedFactsByteMatch,
    baselineCallEdges: baselineEdgeRows.length,
    currentCallEdges: firstRunEdgeRowsCanonical.length,
    persistedCallEdges: firstRunPersistedRowsCanonical.length,
    baselineMatchesPhase1,
    baselineMatchesPersisted,
    perSnapshot: parityRows,
  };
  mkdirSync(options.outputDirectory, { recursive: true });
  writeJsonLines(
    path.join(options.outputDirectory, "declared-type-facts-pass-a.jsonl"),
    currentFactsRowsPassA,
  );
  writeJsonLines(
    path.join(options.outputDirectory, "declared-type-facts-pass-b.jsonl"),
    currentFactsRowsPassB,
  );
  writeJsonLines(
    path.join(options.outputDirectory, "baseline-call-edges.jsonl"),
    baselineEdgeRows,
  );
  writeFileSync(
    path.join(options.outputDirectory, "summary.json"),
    `${JSON.stringify(summary, null, 2)}\n`,
    "utf8",
  );
  const inputs = {
    phase1CallEdgesSha256: sha256(readFileSync(firstRunEdgesPath)),
    phase1SummarySha256: sha256(readFileSync(phase1SummaryPath)),
    collectionReportSha256: sha256(
      readFileSync(path.join(CORPUS_DIRECTORY, "collection-report.json")),
    ),
    corpusSpecSha256: sha256(
      readFileSync(
        path.join(ROOT, "evaluate/semantic-corpus/corpus-spec.v1.json"),
      ),
    ),
    baselineWorkerSha256: sha256(readFileSync(options.baselineWorkerPath)),
    currentExtractorSha256: sha256(
      readFileSync(path.join(ROOT, "lib/core/src/ast/declared-type-facts.ts")),
    ),
    currentWorkerSourceSha256: sha256(
      readFileSync(path.join(ROOT, "lib/core/src/ast/ast-worker.ts")),
    ),
  };
  const outputs = Object.fromEntries(
    [
      "declared-type-facts-pass-a.jsonl",
      "declared-type-facts-pass-b.jsonl",
      "baseline-call-edges.jsonl",
      "summary.json",
    ].map((file) => [
      file,
      sha256(readFileSync(path.join(options.outputDirectory, file))),
    ]),
  );
  writeFileSync(
    path.join(options.outputDirectory, "checksums.json"),
    `${JSON.stringify({ schemaVersion: 1, inputs, outputs }, null, 2)}\n`,
    "utf8",
  );
  console.info(
    `[phase1-parity] complete: ${summary.snapshotsCompared} snapshots; corrected facts repeat byte match=${repeatedFactsByteMatch}; baseline/current/persisted edge byte matches=${baselineMatchesPhase1 && baselineMatchesPersisted}.`,
  );
  if (
    !repeatedFactsByteMatch ||
    !baselineMatchesPhase1 ||
    !baselineMatchesPersisted
  )
    throw new Error("Phase 1 corpus determinism or legacy edge parity failed.");
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  run(parseOptions(process.argv.slice(2))).catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
