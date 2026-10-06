/** Source-only certification collection. This intentionally imports no LSP/oracle module. */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type {
  SemanticCorpusSplit,
  SemanticCollectionCallSite,
} from "../../lib/contracts/src/index.js";
import { assignSplits } from "../../lib/core/src/semantic/collection/semantic-dedup-splits.js";
import { callSiteId } from "../../lib/core/src/semantic/collection/semantic-sample-builder.js";
import { collectCheckerEvidence, type CheckedCallSite } from "./checker.mjs";
import { assertMemoryHeadroom } from "./memory-guard.mjs";
import { buildPrelabelManifest } from "./prelabel-manifest.mjs";
import { argsFor, writeJson } from "./run-support.mjs";
import {
  assertClean,
  describeRevision,
  hashSnapshot,
  materializeSnapshot,
  verifyTemporalOrder,
  type SourceRevision,
} from "./snapshot.mjs";
import { readTierAGraph, runTierA } from "./tier-a.mjs";

interface SnapshotSpec {
  readonly snapshotId: string;
  readonly repoId: string;
  readonly family: string;
  readonly sourceDir: string;
  readonly revision: string;
  readonly subtree: string | null;
  readonly license: string;
  readonly usage: "evaluation-only" | "training-and-evaluation";
  readonly temporalOf: string | null;
  readonly baselineOnly?: boolean;
}

interface CorpusSpec {
  readonly corpusId: string;
  readonly corpusVersion: string;
  readonly splitSeed: string;
  readonly maxSamplesPerSnapshot: number;
  readonly memoryFloorPercent: number;
  readonly tierAHeapMb: number;
  readonly families: Readonly<Record<string, SemanticCorpusSplit>>;
  readonly snapshots: readonly SnapshotSpec[];
}

interface CollectedSourceSample {
  readonly sampleId: string;
  readonly snapshotId: string;
  readonly repoId: string;
  readonly family: string;
  readonly revision: string;
  readonly license: string;
  readonly usage: SnapshotSpec["usage"];
  readonly projectId: string;
  readonly duplicateGroup: string;
  readonly temporal: boolean;
  readonly filePath: string;
  readonly line: number;
  readonly column: number;
  readonly calleeName: string;
  readonly calleeKind: string;
  readonly sourceFileSha256: string;
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function uniqueSites(results: readonly CheckedCallSite[]): CheckedCallSite[] {
  const seen = new Set<string>();
  return results.filter((result) => {
    const id = callSiteId(result.callSite);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function seeded(seed: string, value: string): string {
  return sha256(`${seed}\0${value}`);
}

function count(values: readonly string[]): Record<string, number> {
  const result: Record<string, number> = {};
  for (const value of [...values].sort())
    result[value] = (result[value] ?? 0) + 1;
  return result;
}

async function main(): Promise<void> {
  const args = argsFor(process.argv.slice(2), [
    "--spec",
    "--repos",
    "--work",
    "--out",
  ]);
  const specBytes = readFileSync(args["--spec"]);
  const corpus = JSON.parse(specBytes.toString("utf8")) as CorpusSpec;
  const reposDir = path.resolve(args["--repos"]);
  const workDir = path.resolve(args["--work"]);
  const outDir = path.resolve(args["--out"]);
  mkdirSync(workDir, { recursive: true });
  mkdirSync(outDir, { recursive: true });

  const inputSamples: CollectedSourceSample[] = [];
  const fragmentsBySnapshot = new Map<string, Set<string>>();
  const sources = new Map<string, SourceRevision>();
  const familySnapshots: Array<{
    snapshotId: string;
    family: string;
    fileHashes: ReadonlySet<string>;
    rootCommits: readonly string[];
  }> = [];
  const snapshotReports: Array<Record<string, unknown>> = [];

  for (const spec of corpus.snapshots) {
    process.stderr.write(`[prelabel] ${spec.snapshotId}\n`);
    assertMemoryHeadroom(corpus.memoryFloorPercent);
    const sourceDir = path.resolve(reposDir, spec.sourceDir);
    const source = describeRevision(sourceDir, spec.revision);
    if (source.revision !== spec.revision)
      throw new Error(
        `Pinned revision mismatch for ${spec.snapshotId}: expected ${spec.revision}, got ${source.revision}`,
      );
    const snapshotDir = path.join(workDir, spec.snapshotId);
    materializeSnapshot(sourceDir, source.revision, spec.subtree, snapshotDir);
    const sourceHash = hashSnapshot(snapshotDir);
    const tierAMs = runTierA(snapshotDir, corpus.tierAHeapMb);
    assertClean(snapshotDir);
    const graph = readTierAGraph(snapshotDir);
    const checker = collectCheckerEvidence(
      snapshotDir,
      graph.callSites,
      new Set(graph.nodes.map((node) => node.nodeKey)),
      new Set(sourceHash.files.keys()),
      () => assertMemoryHeadroom(corpus.memoryFloorPercent),
    );
    const all = uniqueSites(checker.results);
    const eligible = all.filter((result) => result.exclusion === null);
    const fragments = new Set(all.map((result) => result.duplicateGroup));
    fragmentsBySnapshot.set(spec.snapshotId, fragments);
    sources.set(spec.snapshotId, source);
    familySnapshots.push({
      snapshotId: spec.snapshotId,
      family: spec.family,
      fileHashes: new Set(
        [...sourceHash.files]
          .filter(([file]) => !file.endsWith(".json"))
          .map(([, hash]) => hash),
      ),
      rootCommits: source.rootCommits,
    });

    const sampled = spec.baselineOnly
      ? []
      : [...eligible]
          .sort((left, right) => {
            const leftHash = seeded(
              corpus.splitSeed,
              `${spec.snapshotId}\0${callSiteId(left.callSite)}`,
            );
            const rightHash = seeded(
              corpus.splitSeed,
              `${spec.snapshotId}\0${callSiteId(right.callSite)}`,
            );
            return leftHash < rightHash ? -1 : leftHash > rightHash ? 1 : 0;
          })
          .slice(0, corpus.maxSamplesPerSnapshot);

    for (const checked of sampled) {
      const callSite: SemanticCollectionCallSite = checked.callSite;
      const fileHash = sourceHash.files.get(callSite.filePath);
      if (!fileHash)
        throw new Error(`Call-site source hash missing: ${callSite.filePath}`);
      inputSamples.push({
        sampleId: `${spec.repoId}@${source.revision.slice(0, 12)}::${callSiteId(callSite)}`,
        snapshotId: spec.snapshotId,
        repoId: spec.repoId,
        family: spec.family,
        revision: source.revision,
        license: spec.license,
        usage: spec.usage,
        projectId: checked.projectId!,
        duplicateGroup: checked.duplicateGroup,
        temporal: spec.temporalOf !== null,
        filePath: callSite.filePath,
        line: callSite.line,
        column: callSite.column,
        calleeName: callSite.calleeName,
        calleeKind: callSite.calleeKind,
        sourceFileSha256: fileHash,
      });
    }

    snapshotReports.push({
      snapshotId: spec.snapshotId,
      repoId: spec.repoId,
      family: spec.family,
      revision: source.revision,
      committedAt: source.committedAt,
      baselineOnly: spec.baselineOnly === true,
      subtree: spec.subtree,
      snapshotHash: sourceHash.hash,
      trackedSnapshotFiles: sourceHash.files.size,
      tierA: {
        nodes: graph.nodes.length,
        edges: graph.edges.length,
        callSites: graph.callSites.length,
        durationMs: tierAMs,
      },
      checker: {
        typescriptVersion: checker.typescriptVersion,
        programs: checker.programs,
        uniqueCallSites: all.length,
        exclusions: count(
          all.flatMap((result) => (result.exclusion ? [result.exclusion] : [])),
        ),
        eligible: eligible.length,
        sampled: sampled.length,
      },
      allDuplicateGroups: fragments.size,
    });
  }

  const temporalOrder: Record<string, boolean> = {};
  for (const spec of corpus.snapshots.filter(
    (snapshot) => snapshot.temporalOf,
  )) {
    const base = corpus.snapshots.find(
      (snapshot) => snapshot.snapshotId === spec.temporalOf,
    );
    if (!base || base.family !== spec.family)
      throw new Error(
        `Temporal snapshot ${spec.snapshotId} needs same-family base`,
      );
    const valid = verifyTemporalOrder(
      path.resolve(reposDir, spec.sourceDir),
      sources.get(base.snapshotId)!,
      sources.get(spec.snapshotId)!,
    );
    if (!valid)
      throw new Error(`Temporal order not verified for ${spec.snapshotId}`);
    temporalOrder[spec.snapshotId] = valid;
  }

  const priorGroups = new Map(
    corpus.snapshots
      .filter((snapshot) => snapshot.temporalOf)
      .map(
        (snapshot) =>
          [
            snapshot.family,
            fragmentsBySnapshot.get(snapshot.temporalOf!)!,
          ] as const,
      ),
  );
  const assigned = buildPrelabelManifest({
    corpusId: corpus.corpusId,
    corpusVersion: corpus.corpusVersion,
    splitSeed: corpus.splitSeed,
    families: corpus.families,
    samples: inputSamples,
    priorGroups,
  });
  const samplesById = new Map(
    inputSamples.map((sample) => [sample.sampleId, sample]),
  );
  const samples = assigned.manifest.samples.map((sample) => ({
    ...samplesById.get(sample.sampleId)!,
    duplicateGroup: sample.duplicateGroup,
    temporal: sample.temporal,
    split: sample.split,
  }));
  const manifest = {
    schemaVersion: 1,
    corpusId: corpus.corpusId,
    corpusVersion: corpus.corpusVersion,
    splitSeed: corpus.splitSeed,
    samples,
  };
  const manifestSha256 = sha256(JSON.stringify(manifest));
  const report = {
    collector: "semantic-corpus-prelabel-collector/1",
    specSha256: sha256(specBytes),
    manifestSha256,
    splitHashes: assigned.splitHashes,
    dropped: assigned.dropped,
    sourceSnapshotHashes: Object.fromEntries(
      snapshotReports.map((snapshot) => [
        snapshot.snapshotId,
        snapshot.snapshotHash,
      ]),
    ),
    temporalOrder,
    snapshots: snapshotReports,
    sampleCount: samples.length,
    oracleInvocations: 0,
  };
  writeJson(path.join(outDir, "prelabel-manifest.json"), manifest, {
    compact: true,
  });
  writeJson(path.join(outDir, "prelabel-report.json"), report);
  process.stdout.write(
    `${JSON.stringify({
      sampleCount: samples.length,
      manifestSha256,
      splitHashes: assigned.splitHashes,
      oracleInvocations: 0,
    })}\n`,
  );
}

await main();
