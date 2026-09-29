/** #506 real-corpus collector: snapshot → Tier A → checker evidence → LSP oracle → dedup/splits
 *  → P1-01 samples → P1-02 audit. Usage:
 *    pnpm run eval:semantic:collect --spec <spec.json> --repos <dir> --work <dir> --out <dir>
 *  Stages run one at a time per snapshot under a memory watchdog. */
import "../../lib/core/src/index.js";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  docuviaFactory,
  SemanticDecisionLimits,
  TOKENS,
  type SemanticCorpusSample,
  type SemanticCorpusSplit,
  type SemanticOracleOutcome,
} from "../../lib/contracts/src/index.js";
import {
  createTierAIndex,
  TIER_A_FEATURE_SCHEMA,
  tierACandidates,
} from "../../lib/core/src/semantic/collection/semantic-tier-a-candidates.js";
import {
  assignSplits,
  findFamilyRelations,
} from "../../lib/core/src/semantic/collection/semantic-dedup-splits.js";
import {
  buildCorpusSample,
  callSiteId,
} from "../../lib/core/src/semantic/collection/semantic-sample-builder.js";
import { selectAuditSample } from "../../lib/core/src/semantic/collection/semantic-collection-reporting.js";
import { collectCheckerEvidence, type CheckedCallSite } from "./checker.mjs";
import { oracleIdentity, runOracle, type OracleOptions } from "./oracle.mjs";
import { readTierAGraph, runTierA } from "./tier-a.mjs";
import {
  assertClean,
  describeRevision,
  hashSnapshot,
  materializeSnapshot,
  verifyTemporalOrder,
  type SourceRevision,
} from "./snapshot.mjs";
import { assertMemoryHeadroom } from "./memory-guard.mjs";
import { argsFor, runManifest, writeJson } from "./run-support.mjs";

export const COLLECTOR_VERSION = "semantic-corpus-collector/1";
const READINESS_PROBES = 3;

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
}

interface CorpusSpec {
  readonly corpusId: string;
  readonly corpusVersion: string;
  readonly splitSeed: string;
  readonly maxSamplesPerSnapshot: number;
  readonly memoryFloorPercent: number;
  readonly tierAHeapMb: number;
  readonly oracle: OracleOptions;
  readonly families: Readonly<Record<string, SemanticCorpusSplit>>;
  readonly snapshots: readonly SnapshotSpec[];
}

interface CollectedItem {
  readonly spec: SnapshotSpec;
  readonly revision: string;
  readonly checked: CheckedCallSite;
  readonly candidates: ReturnType<typeof tierACandidates>;
  readonly oracle: SemanticOracleOutcome;
  readonly hashes: { source: string; oracle: string; review: string };
}

const seeded = (seed: string, value: string): string =>
  createHash("sha256").update(`${seed}\0${value}`, "utf8").digest("hex");

function count<T extends string>(values: readonly T[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const value of [...values].sort()) out[value] = (out[value] ?? 0) + 1;
  return out;
}

function uniqueSites(results: readonly CheckedCallSite[]): CheckedCallSite[] {
  const seen = new Set<string>();
  return results.filter((r) => {
    const id = callSiteId(r.callSite);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

async function collectSnapshot(
  corpus: CorpusSpec,
  spec: SnapshotSpec,
  reposDir: string,
  workDir: string,
): Promise<{
  items: CollectedItem[];
  report: Record<string, unknown>;
  files: Set<string>;
  source: SourceRevision;
  fragments: Set<string>;
}> {
  const sourceDir = path.resolve(reposDir, spec.sourceDir);
  const source = describeRevision(sourceDir, spec.revision);
  const dir = path.join(workDir, spec.snapshotId);
  const started = performance.now();
  assertMemoryHeadroom(corpus.memoryFloorPercent);
  materializeSnapshot(sourceDir, source.revision, spec.subtree, dir);
  const sourceHash = hashSnapshot(dir);
  const tierAMs = runTierA(dir, corpus.tierAHeapMb);
  assertClean(dir);
  const graph = readTierAGraph(dir);
  const nodeKeys = new Set(graph.nodes.map((n) => n.nodeKey));
  const index = createTierAIndex(graph.nodes, graph.edges);

  assertMemoryHeadroom(corpus.memoryFloorPercent);
  const reviewHash = hashSnapshot(dir);
  const checkerStarted = performance.now();
  const checker = collectCheckerEvidence(
    dir,
    graph.callSites,
    nodeKeys,
    new Set(reviewHash.files.keys()),
    () => assertMemoryHeadroom(corpus.memoryFloorPercent),
  );
  const checkerMs = performance.now() - checkerStarted;
  const all = uniqueSites(checker.results);
  const population = all.filter((r) => r.exclusion === null);
  const sampled = [...population]
    .sort((a, b) =>
      seeded(
        corpus.splitSeed,
        `${spec.snapshotId}\0${callSiteId(a.callSite)}`,
      ) <
      seeded(corpus.splitSeed, `${spec.snapshotId}\0${callSiteId(b.callSite)}`)
        ? -1
        : 1,
    )
    .slice(0, corpus.maxSamplesPerSnapshot);

  const oracleHash = hashSnapshot(dir);
  const groups = new Map<string, CheckedCallSite[]>();
  for (const item of sampled)
    groups.set(item.projectId!, [...(groups.get(item.projectId!) ?? []), item]);
  const oracleStarted = performance.now();
  const oracle = await runOracle(
    dir,
    [...groups].map(([projectId, items]) => {
      const sites = items
        .map((i) => i.callSite)
        .sort((a, b) => (callSiteId(a) < callSiteId(b) ? -1 : 1));
      return { projectId, sites, probes: sites.slice(0, READINESS_PROBES) };
    }),
    nodeKeys,
    corpus.oracle,
    () => assertMemoryHeadroom(corpus.memoryFloorPercent),
  );
  const oracleMs = performance.now() - oracleStarted;

  const items = sampled.map((checked) => ({
    spec,
    revision: source.revision,
    checked,
    candidates: tierACandidates(index, checked.callSite),
    oracle: oracle.outcomes.get(callSiteId(checked.callSite))!,
    hashes: {
      source: sourceHash.hash,
      oracle: oracleHash.hash,
      review: reviewHash.hash,
    },
  }));
  const files = new Set(
    [...sourceHash.files]
      .filter(([p]) => !p.endsWith(".json"))
      .map(([, sha]) => sha),
  );
  const report = {
    snapshotId: spec.snapshotId,
    repoId: spec.repoId,
    family: spec.family,
    revision: source.revision,
    committedAt: source.committedAt,
    subtree: spec.subtree,
    snapshotHash: sourceHash.hash,
    snapshotHashesAgree:
      sourceHash.hash === reviewHash.hash &&
      sourceHash.hash === oracleHash.hash,
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
        all.filter((r) => r.exclusion).map((r) => r.exclusion!),
      ),
      population: population.length,
      sampled: sampled.length,
      audit: count(
        sampled.map((r) =>
          r.audit.kind === "not-applicable"
            ? `not-applicable:${r.audit.reason}`
            : r.audit.kind,
        ),
      ),
      durationMs: checkerMs,
    },
    candidates: {
      empty: items.filter((i) => i.candidates.candidates.length === 0).length,
      truncated: items.filter((i) => i.candidates.truncated).length,
      goldCovered: items.filter((i) =>
        i.checked.declarations.every(
          (d) =>
            d.ref.filePath === i.checked.callSite.filePath ||
            i.candidates.candidates.some((c) => c.targetId === d.nodeKey),
        ),
      ).length,
    },
    oracle: {
      statuses: count(items.map((i) => i.oracle.status)),
      unmappedLocations: items.reduce(
        (sum, i) => sum + i.oracle.unmappedLocations,
        0,
      ),
      requests: oracle.requests,
      readinessProbeRequests: oracle.readinessProbeRequests,
      processStarts: oracle.processStarts,
      groups: oracle.readiness.length,
      notReadyGroups: oracle.readiness.filter((r) => !r.ready).length,
      readiness: oracle.readiness,
      durationMs: oracleMs,
    },
    durationMs: performance.now() - started,
  };
  return {
    items,
    report,
    files,
    source,
    fragments: new Set(all.map((r) => r.duplicateGroup)),
  };
}

function verifyTemporal(
  corpus: CorpusSpec,
  sources: Map<string, SourceRevision>,
  reposDir: string,
): Record<string, boolean> {
  const verified: Record<string, boolean> = {};
  for (const spec of corpus.snapshots.filter((s) => s.temporalOf)) {
    const base = corpus.snapshots.find((s) => s.snapshotId === spec.temporalOf);
    if (!base || base.family !== spec.family)
      throw new Error(
        `Temporal snapshot ${spec.snapshotId} needs a same-family base`,
      );
    const ok = verifyTemporalOrder(
      path.resolve(reposDir, spec.sourceDir),
      sources.get(base.snapshotId)!,
      sources.get(spec.snapshotId)!,
    );
    if (!ok)
      throw new Error(`Temporal order not verified for ${spec.snapshotId}`);
    verified[spec.snapshotId] = ok;
  }
  return verified;
}

function buildSamples(
  corpus: CorpusSpec,
  items: readonly CollectedItem[],
  identity: ReturnType<typeof oracleIdentity>,
  typescriptVersion: string,
  priorGroups: ReadonlyMap<string, ReadonlySet<string>>,
) {
  const keyed = items.map((item) => ({
    item,
    sample: {
      sampleId: `${item.spec.repoId}@${item.revision.slice(0, 12)}::${callSiteId(item.checked.callSite)}`,
      family: item.spec.family,
      duplicateGroup: item.checked.duplicateGroup,
      temporal: item.spec.temporalOf !== null,
    },
  }));
  const splits = assignSplits(
    keyed.map((k) => k.sample),
    corpus.families,
    priorGroups,
  );
  const samples: SemanticCorpusSample[] = [];
  for (const { item, sample } of keyed) {
    const split = splits.assigned[sample.sampleId];
    if (!split) continue;
    samples.push(
      buildCorpusSample({
        repo: {
          repoId: item.spec.repoId,
          repoFamily: item.spec.family,
          revision: item.revision,
          license: item.spec.license,
          usage: item.spec.usage,
        },
        projectId: item.checked.projectId!,
        callSite: item.checked.callSite,
        snapshotHashes: item.hashes,
        duplicateGroup: item.checked.duplicateGroup,
        split,
        candidates: item.candidates,
        oracle: { ...item.oracle, ...identity },
        checker: {
          version: typescriptVersion,
          declarations: item.checked.declarations,
        },
        audit: item.checked.audit,
      }),
    );
  }
  samples.sort((a, b) => (a.sampleId < b.sampleId ? -1 : 1));
  return { samples, dropped: splits.dropped };
}

function worksheet(
  samples: readonly SemanticCorpusSample[],
  reasons: ReadonlyMap<string, string>,
  seed: string,
  workDir: string,
  snapshotDirs: ReadonlyMap<string, string>,
) {
  const picked = new Set(
    selectAuditSample(
      samples.map((s) => ({
        sampleId: s.sampleId,
        stratum: `${s.source.repoId}|${s.source.split}`,
        reason: reasons.get(s.sampleId)!,
      })),
      seed,
    ),
  );
  const excerpt = (dir: string, file: string, line: number): string[] =>
    readFileSync(path.join(workDir, dir, file), "utf8")
      .split(/\r?\n/)
      .slice(Math.max(0, line - 2), line + 3);
  return samples
    .filter((s) => picked.has(s.sampleId))
    .map((s) => {
      const dir = snapshotDirs.get(`${s.source.repoId}@${s.source.revision}`)!;
      const [file, line] = s.source.callSiteId.split(":");
      const audit = s.review.evidenceRefs.find((r) =>
        r.startsWith("source-audit:"),
      )!;
      return {
        sampleId: s.sampleId,
        reason: reasons.get(s.sampleId),
        caller: {
          file,
          line: Number(line),
          excerpt: excerpt(dir, file, Number(line)),
        },
        gold: s.review.positiveTargetIds,
        oracle: { status: s.oracle.status, targetIds: s.oracle.targetIds },
        automatedAudit: audit,
        humanReview: audit.startsWith("source-audit:match")
          ? "automated-source-audit"
          : "pending-human",
      };
    });
}

async function main(): Promise<void> {
  const args = argsFor(process.argv.slice(2), [
    "--spec",
    "--repos",
    "--work",
    "--out",
  ]);
  const corpus = JSON.parse(readFileSync(args["--spec"], "utf8")) as CorpusSpec;
  const workDir = path.resolve(args["--work"]);
  const outDir = path.resolve(args["--out"]);
  mkdirSync(workDir, { recursive: true });
  mkdirSync(outDir, { recursive: true });
  const identity = oracleIdentity(corpus.oracle);
  const items: CollectedItem[] = [];
  const snapshots: Record<string, unknown>[] = [];
  const familySnapshots = [];
  const sources = new Map<string, SourceRevision>();
  const snapshotDirs = new Map<string, string>();
  let typescriptVersion = "";
  const fragmentsBySnapshot = new Map<string, Set<string>>();
  for (const spec of corpus.snapshots) {
    process.stderr.write(`[collect] ${spec.snapshotId}\n`);
    const result = await collectSnapshot(
      corpus,
      spec,
      args["--repos"],
      workDir,
    );
    items.push(...result.items);
    snapshots.push(result.report);
    sources.set(spec.snapshotId, result.source);
    fragmentsBySnapshot.set(spec.snapshotId, result.fragments);
    snapshotDirs.set(
      `${spec.repoId}@${result.source.revision}`,
      spec.snapshotId,
    );
    typescriptVersion = (result.report.checker as { typescriptVersion: string })
      .typescriptVersion;
    familySnapshots.push({
      snapshotId: spec.snapshotId,
      family: spec.family,
      fileHashes: result.files,
      rootCommits: result.source.rootCommits,
    });
    writeJson(path.join(outDir, "collection-progress.json"), { snapshots });
  }
  const temporal = verifyTemporal(corpus, sources, args["--repos"]);
  const relations = findFamilyRelations(familySnapshots);
  const leaking = relations.filter((r) => r.crossFamily);
  if (leaking.length > 0)
    throw new Error(`Undeclared related families: ${JSON.stringify(leaking)}`);
  const priorGroups = new Map(
    corpus.snapshots
      .filter((s) => s.temporalOf)
      .map((s) => [s.family, fragmentsBySnapshot.get(s.temporalOf!)!] as const),
  );
  const { samples, dropped } = buildSamples(
    corpus,
    items,
    identity,
    typescriptVersion,
    priorGroups,
  );
  const manifest = {
    schemaVersion: 1,
    corpusId: corpus.corpusId,
    corpusVersion: corpus.corpusVersion,
    splitSeed: corpus.splitSeed,
    samples,
  };
  const report = docuviaFactory
    .resolve(TOKENS.SemanticCorpusService)
    .audit(manifest);
  const reasons = new Map(report.results.map((r) => [r.sampleId, r.reason]));
  writeJson(path.join(outDir, "corpus-manifest.json"), manifest, {
    compact: true,
  });
  writeJson(path.join(outDir, "corpus-report.json"), report, { compact: true });
  writeJson(
    path.join(outDir, "audit-worksheet.json"),
    worksheet(samples, reasons, corpus.splitSeed, workDir, snapshotDirs),
  );
  writeJson(path.join(outDir, "collection-report.json"), {
    collector: COLLECTOR_VERSION,
    featureSchema: TIER_A_FEATURE_SCHEMA,
    limits: {
      maxCandidates: SemanticDecisionLimits.MAX_CANDIDATES,
      maxInputBytes: SemanticDecisionLimits.MAX_INPUT_BYTES,
    },
    oracle: identity,
    snapshots,
    temporalOrderVerified: temporal,
    familyRelations: relations,
    splitDrops: count(dropped.map((d) => d.reason)),
    samples: samples.length,
    datasetHash: report.datasetHash,
    gates: report.gates,
  });
  writeJson(
    path.join(outDir, "run-manifest.json"),
    runManifest(corpus, identity, typescriptVersion),
  );
  process.stdout.write(
    `${JSON.stringify({ samples: samples.length, datasetHash: report.datasetHash, gates: report.gates })}\n`,
  );
}

await main();
