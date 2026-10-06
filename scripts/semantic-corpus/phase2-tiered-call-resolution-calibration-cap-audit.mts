/** CALIBRATION-only source replay and read-only proposal-cap sensitivity. */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  AstCallSiteShapeFact,
  CallResolutionHypothesisRequest,
} from "../../lib/contracts/src/index.js";
import {
  CallResolutionHypothesisService,
  type CallResolutionHypothesisWithCandidateStageTrace,
} from "../../lib/core/src/semantic/call-resolution-hypothesis.service.js";
import {
  candidateOracleTargetMapping,
  filterInputsToUniqueOracleTargets,
} from "./phase2-tiered-call-resolution-candidate-audit.mjs";
import { candidateObservationDecisionFingerprint } from "./phase2-tiered-call-resolution-candidate-stage-evidence.mjs";
import type { Phase2EvaluationObservation } from "./phase2-tiered-call-resolution-evaluation.mjs";
import { PROPOSAL_FILTER_STAGES } from "./phase2-tiered-call-resolution-proposal-filter-stage-evidence.mjs";
import {
  makeAstProcessor,
  mapCandidateKeysToUnambiguousAliases,
  processPhase2Snapshot,
  type Phase2PinnedSnapshot,
} from "./phase2-tiered-call-resolution-source.mjs";
import {
  allFactRows,
  canonicalHash,
  labelsForSplitIsolated,
  parseJsonlRowsForSplit,
  sha256,
  verifyPhase1SourceSidecars,
  writeJson,
  writeJsonl,
  type Phase2CorpusSource,
  type Phase2FactFile,
} from "./phase2-tiered-call-resolution-support.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");
const SOURCE_DIRECTORY =
  "evaluate/results/semantic-corpus/v1/phase2-p2a-direct-import-alias-final-source-reproduction";
const OUTPUT_DIRECTORY =
  "evaluate/results/semantic-corpus/v1/phase2-p2a-v4-calibration-cap-audit";
const PINS = {
  predictionManifest:
    "de7dc8ec977ac316addce6263fcdb9e3190ceed84a4cc8b7e7506f2a04f5ad9e",
  predictions:
    "6d99b1b940d470cbeb94e2bd55527a8e372d2c30c26b56b7d51fc9d773c0e622",
  trainReplayManifest:
    "3c276df3fbc46b6c53d6987257e1bc030ec3e5adee1ff6b065feccbcf1b1c809",
  callsites: "b61764cdaa1168ba453689c5e11f6a9b035a05273532068648092c48a0dbd362",
  facts: "ba7b631b36ed05b1f16c6b500b0c17b5e4273acd939a493800848225c4dad14e",
  corpusSpec:
    "867b96f393be018c7552036b18d8164d8fcdd9f21fe8d3a2f100d674fd64e69a",
  collectionReport:
    "159413d22bee7c14f0e76e510e06d7110f897732f4e6413653a4c37b80938c14",
  sampleIds: "c95b92a9d5cd284250cdfaf178b990b77b59cf6d60b81e5068a2c7c573fe76c9",
  calibrationLabels:
    "5b2892aa4be1ea53c76ff6dc189c0c78c3bf3d83af61639cbd1c59716710c426",
} as const;

export interface CalibrationCandidateRow {
  readonly sampleId: string;
  readonly split: string;
  readonly repoFamily: string;
  readonly calleeKind: string;
  readonly evidenceKind: string;
  readonly confirmed: boolean;
  readonly goldTargetIds: readonly string[];
  /** One mapped ID or null per exact key, retaining key order and multiplicity. */
  readonly generatedTargetIdsInOrder: readonly (string | null)[];
  readonly beforeMaxTargetIdsInOrder: readonly (string | null)[];
}

export function assertCalibrationAuditRows(
  rows: readonly { readonly sampleId: string; readonly split: string }[],
  expectedIds: ReadonlySet<string>,
): void {
  if (rows.some((row) => row.split !== "calibration"))
    throw new Error("Candidate cap audit requires CALIBRATION-only rows.");
  if (
    rows.length !== expectedIds.size ||
    new Set(rows.map((row) => row.sampleId)).size !== rows.length ||
    rows.some((row) => !expectedIds.has(row.sampleId))
  )
    throw new Error("Candidate cap audit requires complete unique sample IDs.");
}

export function assertCalibrationParserEvidence(
  rows: readonly {
    readonly positionStatus: string;
    readonly exactParserFact: boolean;
    readonly sourceContentHash: string | null;
    readonly callSiteInputHash: string | null;
  }[],
  expectedCount: number,
): void {
  if (
    rows.length !== expectedCount ||
    rows.some(
      (row) =>
        row.positionStatus !== "unique" ||
        !row.exactParserFact ||
        !/^[a-f0-9]{64}$/u.test(row.sourceContentHash ?? "") ||
        !/^[a-f0-9]{64}$/u.test(row.callSiteInputHash ?? ""),
    )
  )
    throw new Error(
      "CALIBRATION requires every exact parser fact and non-null source/input hashes; eligibility gaps require a separate capability probe.",
    );
}

function distribution(sizes: readonly number[]) {
  const sorted = [...sizes].sort((a, b) => a - b);
  const frequency: Record<string, number> = {};
  for (const size of sorted) frequency[size] = (frequency[size] ?? 0) + 1;
  return {
    p50: sorted[Math.ceil(sorted.length * 0.5) - 1] ?? 0,
    p95: sorted[Math.ceil(sorted.length * 0.95) - 1] ?? 0,
    max: sorted.at(-1) ?? 0,
    frequency,
  };
}

function groupMetrics(
  name: string,
  rows: readonly CalibrationCandidateRow[],
  cap: number | null,
) {
  const sets = rows.map((row) => {
    const ids =
      cap === null
        ? row.generatedTargetIdsInOrder
        : row.beforeMaxTargetIdsInOrder.slice(0, cap);
    const mapped = new Set(ids.filter((id): id is string => id !== null));
    const gold = row.confirmed ? row.goldTargetIds : [];
    return {
      keys: ids.length,
      mapped: mapped.size,
      gold: gold.length,
      covered: gold.filter((id) => mapped.has(id)).length,
      unscorable: gold.length === 0,
    };
  });
  const goldTargetOccurrences = sets.reduce((n, row) => n + row.gold, 0);
  const coveredGoldTargetOccurrences = sets.reduce(
    (n, row) => n + row.covered,
    0,
  );
  const keyZeroSites = sets.filter((row) => row.keys === 0).length;
  const mappedZeroSites = sets.filter((row) => row.mapped === 0).length;
  return {
    name,
    allSiteCount: rows.length,
    confirmedSiteCount: rows.filter((row) => row.confirmed).length,
    uniqueMappablePositiveSites: sets.filter((row) => row.gold > 0).length,
    unscorableSiteCount: sets.filter((row) => row.unscorable).length,
    goldTargetOccurrences,
    coveredGoldTargetOccurrences,
    candidateRecall:
      goldTargetOccurrences === 0
        ? null
        : coveredGoldTargetOccurrences / goldTargetOccurrences,
    keyMemberships: sets.reduce((n, row) => n + row.keys, 0),
    mappedMemberships: sets.reduce((n, row) => n + row.mapped, 0),
    keyZeroSites,
    mappedZeroSites,
    keyZeroRate: rows.length === 0 ? 0 : keyZeroSites / rows.length,
    mappedZeroRate: rows.length === 0 ? 0 : mappedZeroSites / rows.length,
    keySize: distribution(sets.map((row) => row.keys)),
    mappedSize: distribution(sets.map((row) => row.mapped)),
  };
}

function breakdown(
  rows: readonly CalibrationCandidateRow[],
  cap: number | null,
  key: (row: CalibrationCandidateRow) => string,
) {
  const groups = new Map<string, CalibrationCandidateRow[]>();
  for (const row of rows) {
    const name = key(row);
    const group = groups.get(name) ?? [];
    group.push(row);
    groups.set(name, group);
  }
  return [...groups]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, group]) => groupMetrics(name, group, cap));
}

export function measureCalibrationCapAudit(
  rows: readonly CalibrationCandidateRow[],
  caps: readonly number[],
) {
  assertCalibrationAuditRows(rows, new Set(rows.map((row) => row.sampleId)));
  if (
    caps.length === 0 ||
    caps.some((cap) => !Number.isInteger(cap) || cap < 1) ||
    new Set(caps).size !== caps.length
  )
    throw new Error("Cap audit requires distinct positive integer caps.");
  if (
    rows.some(
      (row) => new Set(row.goldTargetIds).size !== row.goldTargetIds.length,
    )
  )
    throw new Error("Cap audit requires unique gold target IDs per site.");
  const measure = (cap: number | null) => ({
    overall: groupMetrics("all CALIBRATION sites", rows, cap),
    byFamily: breakdown(rows, cap, (row) => row.repoFamily),
    byFamilyCallShape: breakdown(
      rows,
      cap,
      (row) => `${row.repoFamily}|${row.calleeKind}`,
    ),
    byFamilyCallShapeEvidence: breakdown(
      rows,
      cap,
      (row) => `${row.repoFamily}|${row.calleeKind}|${row.evidenceKind}`,
    ),
  });
  return {
    raw: measure(null),
    caps: caps.map((cap) => ({ cap, ...measure(cap) })),
  };
}

function pinnedBytes(file: string, expected: string): Buffer {
  const bytes = readFileSync(path.join(ROOT, file));
  if (sha256(bytes) !== expected)
    throw new Error(`Pinned source input changed: ${file}.`);
  return bytes;
}

function requestKey(
  file: string,
  fact: Pick<AstCallSiteShapeFact, "startLine" | "startColumn" | "calleeName">,
) {
  return JSON.stringify([
    file,
    fact.startLine,
    fact.startColumn,
    fact.calleeName,
  ]);
}

class CalibrationTraceService extends CallResolutionHypothesisService {
  readonly calls = new Map<
    string,
    {
      request: CallResolutionHypothesisRequest;
      traced: CallResolutionHypothesisWithCandidateStageTrace;
    }
  >();

  override hypothesize(request: CallResolutionHypothesisRequest) {
    const traced = this.hypothesizeWithCandidateStageTrace(request);
    const key = requestKey(request.callerFilePath, request.callSite);
    const previous = this.calls.get(key);
    if (previous && canonicalHash(previous.traced) !== canonicalHash(traced))
      throw new Error("Repeated exact calibration request changed its trace.");
    this.calls.set(key, { request, traced });
    return traced.result;
  }
}

function evidenceKind(
  fact: AstCallSiteShapeFact | undefined,
  positionStatus: string,
) {
  if (!fact)
    return positionStatus === "excluded"
      ? "source-position-excluded"
      : "parser-fact-missing";
  if (fact.calleeKind === "bare")
    return `callee-${fact.calleeBinding?.kind ?? "none"}`;
  if (fact.calleeKind === "this") return "receiver-this";
  const receiver = fact.receiverBinding?.kind ?? "unbound";
  return `receiver-${receiver}-${fact.peerMemberNames.length > 0 ? "with-peers" : "without-peers"}`;
}

function keyMapper(facts: readonly Phase2FactFile[]) {
  const cache = new Map<string, string | null>();
  return (key: string): string | null => {
    if (cache.has(key)) return cache.get(key)!;
    const mapped = mapCandidateKeysToUnambiguousAliases([key], facts);
    const id =
      mapped.aliases.length === 1 &&
      mapped.ambiguous === 0 &&
      mapped.unmapped === 0
        ? mapped.aliases[0]!
        : null;
    cache.set(key, id);
    return id;
  };
}

async function run(): Promise<void> {
  if (process.argv.length !== 2)
    throw new Error(
      "This pinned CALIBRATION-only runner accepts no split/path overrides.",
    );
  const manifest = JSON.parse(
    pinnedBytes(
      `${SOURCE_DIRECTORY}/candidate-prediction-manifest.json`,
      PINS.predictionManifest,
    ).toString("utf8"),
  );
  const replayManifest = JSON.parse(
    pinnedBytes(
      "docs/gitbook/analysis/tiered-call-resolution-phase2-p2a-proposal-filter-stage-train-evidence/proposal-filter-stage-replay-manifest.json",
      PINS.trainReplayManifest,
    ).toString("utf8"),
  );
  if (
    manifest.labelsRead !== false ||
    manifest.candidateGeneratorVersion !== "declared-member-hypothesis-v4" ||
    manifest.candidateOracleMappingScope !== "snapshotId+repoId" ||
    manifest.splitCounts.calibration !== 2966
  )
    throw new Error(
      "Pinned manifest is not the expected source-only v4 population.",
    );
  for (const [file, hash] of Object.entries(
    replayManifest.replay.implementationFiles,
  ))
    pinnedBytes(file, hash as string);
  const sourceHashes = verifyPhase1SourceSidecars();
  if (
    sourceHashes["callsites.jsonl"] !== PINS.callsites ||
    sourceHashes["declared-type-facts-pass-a.jsonl"] !== PINS.facts
  )
    throw new Error("Pinned source/fact provenance differs.");
  const predictions = parseJsonlRowsForSplit<Phase2EvaluationObservation>(
    pinnedBytes(`${SOURCE_DIRECTORY}/predictions.jsonl`, PINS.predictions)
      .toString("utf8")
      .split(/\r?\n/u),
    "calibration",
  ).sort((a, b) => a.sampleId.localeCompare(b.sampleId));
  const sources = parseJsonlRowsForSplit<Phase2CorpusSource>(
    pinnedBytes(
      "evaluate/results/semantic-corpus/v1/phase1-tiered-call-resolution-run-1/callsites.jsonl",
      PINS.callsites,
    )
      .toString("utf8")
      .split(/\r?\n/u),
    "calibration",
  ).sort((a, b) => a.sampleId.localeCompare(b.sampleId));
  const ids = new Set(predictions.map((row) => row.sampleId));
  assertCalibrationAuditRows(predictions, ids);
  assertCalibrationAuditRows(sources, ids);
  if (ids.size !== 2966 || canonicalHash([...ids].sort()) !== PINS.sampleIds)
    throw new Error("CALIBRATION sample-ID denominator changed.");
  const specification = JSON.parse(
    pinnedBytes(
      "evaluate/semantic-corpus/corpus-spec.v1.json",
      PINS.corpusSpec,
    ).toString("utf8"),
  );
  const collection = JSON.parse(
    pinnedBytes(
      "evaluate/results/semantic-corpus/v1/run-c/collection-report.json",
      PINS.collectionReport,
    ).toString("utf8"),
  );
  const selectedSnapshots = new Set(sources.map((source) => source.snapshotId));
  const snapshots: Phase2PinnedSnapshot[] = collection.snapshots
    .filter((snapshot: { snapshotId: string }) =>
      selectedSnapshots.has(snapshot.snapshotId),
    )
    .map((snapshot: Phase2PinnedSnapshot) => {
      const spec = specification.snapshots.find(
        (item: { snapshotId: string }) =>
          item.snapshotId === snapshot.snapshotId,
      );
      if (!spec || spec.subtree !== snapshot.subtree)
        throw new Error("Pinned calibration snapshot spec differs.");
      return {
        snapshotId: snapshot.snapshotId,
        repoId: snapshot.repoId,
        revision: snapshot.revision,
        subtree: snapshot.subtree,
        snapshotHash: snapshot.snapshotHash,
        sourceDir: spec.sourceDir,
      };
    });
  if (snapshots.length !== selectedSnapshots.size)
    throw new Error("Calibration snapshot source is incomplete.");
  const facts = allFactRows().filter((fact) =>
    selectedSnapshots.has(fact.snapshotId),
  );
  const byPrediction = new Map(predictions.map((row) => [row.sampleId, row]));
  const replayRows: Record<string, unknown>[] = [];
  const snapshotsReplayed: Record<string, unknown>[] = [];
  const tempRoot = mkdtempSync(path.join(tmpdir(), "docuvia-cal-cap-"));
  try {
    for (const snapshot of snapshots) {
      process.stdout.write(`[calibration-cap] replay ${snapshot.snapshotId}\n`);
      const snapshotSources = sources.filter(
        (source) => source.snapshotId === snapshot.snapshotId,
      );
      const snapshotFacts = facts.filter(
        (fact) =>
          fact.snapshotId === snapshot.snapshotId &&
          fact.repoId === snapshot.repoId,
      );
      const service = new CalibrationTraceService();
      const result = await processPhase2Snapshot({
        snapshot,
        repositoriesDirectory: path.resolve(ROOT, ".."),
        temporaryDirectory: path.join(tempRoot, snapshot.snapshotId),
        sourceRows: snapshotSources,
        factRows: snapshotFacts,
        service,
        processor: makeAstProcessor(),
        factsSidecarHash: PINS.facts,
      });
      const pinnedFingerprint = manifest.sourceFingerprints.find(
        (item: { snapshotId: string }) =>
          item.snapshotId === snapshot.snapshotId,
      );
      if (
        result.sourceFingerprint !== pinnedFingerprint?.sourceFingerprint ||
        result.snapshotHash !== snapshot.snapshotHash ||
        result.configurationHash !== manifest.configurationHash ||
        result.parseFailureCount !== 0
      )
        throw new Error(
          "Calibration replay source/configuration/facts differ.",
        );
      const byReplay = new Map(
        result.observations.map((row) => [row.sampleId, row]),
      );
      assertCalibrationAuditRows(
        result.observations,
        new Set(snapshotSources.map((row) => row.sampleId)),
      );
      const mapKey = keyMapper(snapshotFacts);
      for (const source of snapshotSources) {
        const pinned = byPrediction.get(source.sampleId)!;
        const replayed = byReplay.get(source.sampleId)!;
        if (
          candidateObservationDecisionFingerprint(pinned) !==
          candidateObservationDecisionFingerprint(replayed)
        )
          throw new Error(`Pinned v4 decision changed: ${source.sampleId}.`);
        const captured = service.calls.get(
          requestKey(source.filePath, {
            startLine: source.line,
            startColumn: source.column,
            calleeName: source.calleeName ?? "",
          }),
        );
        if (
          source.positionStatus === "unique" &&
          pinned.calleeKind !== "unmapped" &&
          !captured
        )
          throw new Error(
            `Exact calibration callsite trace missing: ${source.sampleId}.`,
          );
        const trace = captured?.traced.candidateStageTrace;
        const stageRows = PROPOSAL_FILTER_STAGES.map((stage) => ({
          stage,
          candidateKeys: trace?.[stage] ?? [],
          targetIdsInOrder: (trace?.[stage] ?? []).map(mapKey),
        }));
        const raw = captured?.traced.result.generatedCandidateKeys ?? [];
        const rawIds = raw.map(mapKey);
        const finalKeys = stageRows.at(-1)!.candidateKeys;
        if (
          raw.length !== pinned.generatedCandidateCount ||
          finalKeys.length !== pinned.proposedCandidateCount ||
          JSON.stringify(
            [
              ...new Set(rawIds.filter((id): id is string => id !== null)),
            ].sort(),
          ) !== JSON.stringify(pinned.candidateTargetIds)
        )
          throw new Error(
            `Mapped calibration candidate membership differs: ${source.sampleId}.`,
          );
        const requestFact = captured?.request.callSite;
        replayRows.push({
          sampleId: source.sampleId,
          split: "calibration",
          repoFamily: source.repoFamily,
          snapshotId: source.snapshotId,
          repoId: source.repoId,
          source: {
            filePath: source.filePath,
            line: source.line,
            column: source.column,
            calleeName: source.calleeName,
            positionStatus: source.positionStatus,
          },
          calleeKind: pinned.calleeKind,
          evidenceKind: evidenceKind(requestFact, source.positionStatus),
          decisionFieldsEquivalent: true,
          pinnedV4DecisionSha256:
            candidateObservationDecisionFingerprint(pinned),
          sourceContentHash: captured?.request.callerSourceContentHash ?? null,
          callSiteInputHash: captured
            ? canonicalHash({
                callerFilePath: captured.request.callerFilePath,
                callerSourceContentHash:
                  captured.request.callerSourceContentHash,
                callSite: captured.request.callSite,
                sourceFingerprint:
                  captured.request.workspaceIndex.sourceFingerprint,
                configurationHash:
                  captured.request.workspaceIndex.configurationHash,
              })
            : null,
          callSiteFact: requestFact ?? null,
          generatedCandidateKeys: raw,
          generatedTargetIdsInOrder: rawIds,
          stages: stageRows,
        });
      }
      snapshotsReplayed.push({
        ...snapshot,
        sourceFingerprint: result.sourceFingerprint,
        sourceFactFileCount: result.sourceFactFileCount,
        parsedCallFileCount: result.parsedCallFileCount,
        parsedImportTargetFileCount: result.parsedImportTargetFileCount,
        parseFailureCount: result.parseFailureCount,
        replayedRows: snapshotSources.length,
      });
    }
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
  replayRows.sort((a, b) =>
    (a.sampleId as string).localeCompare(b.sampleId as string),
  );
  assertCalibrationAuditRows(
    replayRows as unknown as { sampleId: string; split: string }[],
    ids,
  );
  assertCalibrationParserEvidence(
    replayRows.map((row) => ({
      positionStatus: (row.source as { positionStatus: string }).positionStatus,
      exactParserFact: row.callSiteFact !== null,
      sourceContentHash: row.sourceContentHash as string | null,
      callSiteInputHash: row.callSiteInputHash as string | null,
    })),
    2966,
  );
  // Labels are opened only after the complete source population reproduces every pinned v4 decision.
  const labels = await labelsForSplitIsolated("calibration", ids);
  assertCalibrationAuditRows(labels, ids);
  const calibrationLabelRowsHash = canonicalHash(
    [...labels].sort((a, b) => a.sampleId.localeCompare(b.sampleId)),
  );
  if (calibrationLabelRowsHash !== PINS.calibrationLabels)
    throw new Error("Pinned isolated CALIBRATION label rows changed.");
  const unique = filterInputsToUniqueOracleTargets(
    predictions,
    labels,
    candidateOracleTargetMapping(facts),
  );
  const labelsById = new Map(labels.map((row) => [row.sampleId, row]));
  const uniqueLabels = new Map(unique.labels.map((row) => [row.sampleId, row]));
  const rows: CalibrationCandidateRow[] = replayRows.map((row) => ({
    sampleId: row.sampleId as string,
    split: "calibration",
    repoFamily: row.repoFamily as string,
    calleeKind: row.calleeKind as string,
    evidenceKind: row.evidenceKind as string,
    confirmed:
      labelsById.get(row.sampleId as string)!.reviewStatus === "confirmed",
    goldTargetIds: uniqueLabels.get(row.sampleId as string)!.positiveTargetIds,
    generatedTargetIdsInOrder: row.generatedTargetIdsInOrder as (
      string | null
    )[],
    beforeMaxTargetIdsInOrder: (
      row.stages as { stage: string; targetIdsInOrder: (string | null)[] }[]
    ).find((stage) => stage.stage === "beforeMaxCandidates")!.targetIdsInOrder,
  }));
  const measured = measureCalibrationCapAudit(
    rows,
    Array.from({ length: 9 }, (_, i) => i + 25),
  );
  const losses = rows.flatMap((row, index) => {
    if (!row.confirmed) return [];
    const replay = replayRows[index]!;
    const stages = replay.stages as {
      stage: string;
      targetIdsInOrder: (string | null)[];
    }[];
    const final = new Set(stages.at(-1)!.targetIdsInOrder);
    return row.goldTargetIds
      .filter((target) => !final.has(target))
      .map((target) => {
        const rawPresent = row.generatedTargetIdsInOrder.includes(target);
        const stage = rawPresent
          ? stages.find((stage) => !stage.targetIdsInOrder.includes(target))
              ?.stage
          : "raw-generation";
        return {
          sampleId: row.sampleId,
          repoFamily: row.repoFamily,
          calleeKind: row.calleeKind,
          evidenceKind: row.evidenceKind,
          source: replay.source,
          targetId: target,
          rawPresent,
          firstLossStage: stage,
          beforeMaxRank:
            row.beforeMaxTargetIdsInOrder.indexOf(target) < 0
              ? null
              : row.beforeMaxTargetIdsInOrder.indexOf(target) + 1,
        };
      });
  });
  const replayPath = `${OUTPUT_DIRECTORY}/calibration-candidate-stage-replay.jsonl`;
  writeJsonl(path.join(ROOT, replayPath), replayRows);
  const runnerPath =
    "scripts/semantic-corpus/phase2-tiered-call-resolution-calibration-cap-audit.mts";
  const artifact = {
    schemaVersion: 1,
    measurement: "phase2-p2a-calibration-cap-sensitivity/1",
    split: "calibration",
    labelSplitsRead: ["calibration"],
    productionBehaviorChanged: false,
    dataBoundary: {
      corpusManifestRead: false,
      systemOneArtifactsRead: false,
      sourcePredictionSplitsParsed: ["calibration"],
      labelsLoader:
        "labelsForSplitIsolated(calibration, complete source sample IDs)",
      trainComparison:
        "existing published descriptive aggregate only; no TRAIN labels loaded",
      allSiteDenominator:
        "all 2966 source sites, including unscorable and abstaining rows",
      recallDenominator:
        "confirmed unique-mappable positive target occurrences",
    },
    candidateGeneratorVersion: manifest.candidateGeneratorVersion,
    configurationHash: manifest.configurationHash,
    sampleIdCount: ids.size,
    sampleIdsHash: PINS.sampleIds,
    calibrationLabelRowsHash,
    uniqueOraclePopulation: {
      uniqueMappedPositiveTargetOccurrenceCount:
        unique.uniqueMappedPositiveTargetOccurrenceCount,
      ambiguousPositiveTargetOccurrenceCount:
        unique.ambiguousPositiveTargetOccurrenceCount,
      unmappedPositiveTargetOccurrenceCount:
        unique.unmappedPositiveTargetOccurrenceCount,
    },
    replay: {
      allDecisionFieldsEquivalent: true,
      decisionRows: replayRows.length,
      sourcePositionExcludedCount: sources.filter(
        (source) => source.positionStatus === "excluded",
      ).length,
      sourcePositionExcludedIdsHash: canonicalHash(
        sources
          .filter((source) => source.positionStatus === "excluded")
          .map((source) => source.sampleId)
          .sort(),
      ),
      exactParserFactCount: replayRows.filter(
        (row) => row.callSiteFact !== null,
      ).length,
      parserFactMissingCount: replayRows.filter(
        (row) => row.callSiteFact === null,
      ).length,
      exactParserFactInputsHash: canonicalHash(
        replayRows.map((row) => [row.sampleId, row.callSiteInputHash]),
      ),
      decisionProofHash: canonicalHash(
        replayRows.map((row) => [row.sampleId, row.pinnedV4DecisionSha256]),
      ),
      snapshots: snapshotsReplayed,
      evidencePath: replayPath,
      evidenceSha256: sha256(readFileSync(path.join(ROOT, replayPath))),
    },
    provenance: {
      pins: PINS,
      sourceInputHashes: sourceHashes,
      runnerPath,
      runnerSha256: sha256(readFileSync(path.join(ROOT, runnerPath))),
      pinnedV4ImplementationHash: manifest.implementationHash,
      replayImplementationHash: replayManifest.replay.implementationHash,
      replayImplementationFiles: replayManifest.replay.implementationFiles,
      capMethod:
        "exact beforeMaxCandidates prefix; earlier filters and ordering unchanged",
    },
    ...measured,
    cap25MissingTargets: losses,
  };
  writeJson(
    path.join(ROOT, OUTPUT_DIRECTORY, "calibration-cap-summary.json"),
    artifact,
  );
  process.stdout.write(
    `${JSON.stringify({ sampleIds: ids.size, raw: measured.raw.overall, cap25: measured.caps[0]!.overall, cap33: measured.caps.at(-1)!.overall, losses })}\n`,
  );
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await run();
