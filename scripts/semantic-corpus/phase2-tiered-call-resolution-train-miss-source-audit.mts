/** Bounded TRAIN audit and seven direct capability requests using unchanged policy. */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  AstCallSiteShapeFact,
  AstDeclaredDeclaration,
  CallResolutionHypothesisWorkspaceInput,
  CallResolutionHypothesisWorkspaceIndex,
} from "../../lib/contracts/src/index.js";
import { AstWorkerPool } from "../../lib/core/src/ast/ast-worker-pool.js";
import { CallResolutionHypothesisService } from "../../lib/core/src/semantic/call-resolution-hypothesis.service.js";
import { candidateTargetKeyForDeclaration } from "../../lib/core/src/semantic/call-resolution-hypothesis-index.js";
import {
  candidateOracleTargetMapping,
  filterInputsToUniqueOracleTargets,
} from "./phase2-tiered-call-resolution-candidate-audit.mjs";
import type { CandidateStageEvidence } from "./phase2-tiered-call-resolution-candidate-stage-evidence.mjs";
import type { Phase2EvaluationObservation } from "./phase2-tiered-call-resolution-evaluation.mjs";
import { evaluateProposalFilterStageSplit } from "./phase2-tiered-call-resolution-proposal-filter-stage-evaluation.mjs";
import type { ProposalFilterStageEvidence } from "./phase2-tiered-call-resolution-proposal-filter-stage-evidence.mjs";
import {
  makeAstProcessor,
  mapCandidateKeysToUnambiguousAliases,
  processPhase2Snapshot,
} from "./phase2-tiered-call-resolution-source.mjs";
import {
  allFactRows,
  canonicalHash,
  labelsForSplitIsolated,
  parseJsonlRowsForSplit,
  sha256,
  verifyPhase1SourceSidecars,
  writeJson,
  type Phase2CorpusSource,
  type Phase2FactFile,
} from "./phase2-tiered-call-resolution-support.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");
const EVIDENCE_DIRECTORY =
  "docs/gitbook/analysis/tiered-call-resolution-phase2-p2a-proposal-filter-stage-train-evidence";
const PINS = {
  replayManifest:
    "3c276df3fbc46b6c53d6987257e1bc030ec3e5adee1ff6b065feccbcf1b1c809",
  summary: "10cc41ce63b114f2df2075463fc36aba93a71b91e8f657d9216b05db75e0af18",
  predictions:
    "6d99b1b940d470cbeb94e2bd55527a8e372d2c30c26b56b7d51fc9d773c0e622",
  replay: "ef6fbacd478a841a2330a892c4076452ea9a8e6b16fba0f9d1a09b03fc716d52",
  trainLabels:
    "4983b8bd52ca2c8048fd5fc9a5f4b8efdb6f7d48843740044e097e7901f9f62a",
} as const;
const PREDICTION_PATH =
  "evaluate/results/semantic-corpus/v1/phase2-p2a-direct-import-alias-final-source-reproduction/predictions.jsonl";
const REPLAY_PATH =
  "evaluate/results/semantic-corpus/v1/phase2-p2a-v4-train-proposal-filter-stage-replay/proposal-filter-stage-evidence-train.jsonl";
const SOURCE_PATH =
  "evaluate/results/semantic-corpus/v1/phase1-tiered-call-resolution-run-1/callsites.jsonl";

interface ReplayRow {
  readonly sampleId: string;
  readonly split: string;
  readonly decisionFieldsEquivalent: boolean;
  readonly candidateStages: CandidateStageEvidence;
  readonly proposalFilterStages: ProposalFilterStageEvidence;
}

interface ReplayScope {
  readonly split: string;
  readonly labelsRead: boolean;
  readonly labelSplitsRead: readonly string[];
  readonly decisions: { readonly allEquivalent: boolean };
}

class PositionProbeService extends CallResolutionHypothesisService {
  workspace: CallResolutionHypothesisWorkspaceIndex | undefined;

  override indexWorkspace(input: CallResolutionHypothesisWorkspaceInput) {
    this.workspace = super.indexWorkspace(input);
    return this.workspace;
  }
}

export function assertTrainMissAuditScope(
  manifest: ReplayScope,
  rows: readonly { readonly split: string }[],
): void {
  if (
    manifest.split !== "train" ||
    manifest.labelsRead !== false ||
    manifest.labelSplitsRead.length !== 0 ||
    !manifest.decisions.allEquivalent ||
    rows.some((row) => row.split !== "train")
  )
    throw new Error("Miss source audit requires verified TRAIN-only replay.");
}

export function classifyRawMissEvidence(
  positionStatus: string,
  exclusionReason: string | undefined,
  exactParserFactCount: number,
) {
  if (
    positionStatus !== "excluded" ||
    exclusionReason !== "no-call-at-position"
  )
    throw new Error(
      "Expected excluded source position with no-call-at-position.",
    );
  if (exactParserFactCount !== 1)
    throw new Error("Expected one exact parser fact at the labeled position.");
  return {
    classification: "source-position-exclusion" as const,
    reason: "source-position-excluded-despite-parser-fact" as const,
    provenUnsupportedSyntax: false,
  };
}

interface SensitivityRow {
  readonly split: string;
  readonly orderedTargetIds: readonly (string | null)[];
  readonly goldTargetIds: readonly string[];
}

function sizeDistribution(sizes: readonly number[]) {
  const sorted = [...sizes].sort((left, right) => left - right);
  const quantile = (p: number) => sorted[Math.ceil(p * sorted.length) - 1] ?? 0;
  const frequency: Record<string, number> = {};
  for (const size of sorted) frequency[size] = (frequency[size] ?? 0) + 1;
  return {
    p50: quantile(0.5),
    p95: quantile(0.95),
    max: sorted.at(-1) ?? 0,
    frequency,
  };
}

export function measureTrainCapSensitivity(
  rows: readonly SensitivityRow[],
  caps: readonly number[],
) {
  if (rows.some((row) => row.split !== "train"))
    throw new Error("Cap sensitivity requires TRAIN-only rows.");
  if (
    caps.length === 0 ||
    caps.some((cap) => !Number.isInteger(cap) || cap < 1)
  )
    throw new Error("Cap sensitivity requires positive integer caps.");
  const results = caps.map((cap) => {
    const sets = rows.map((row) => {
      const prefix = row.orderedTargetIds.slice(0, cap);
      const mapped = new Set(prefix.filter((id): id is string => id !== null));
      return {
        keySize: prefix.length,
        mappedSize: mapped.size,
        covered: row.goldTargetIds.filter((id) => mapped.has(id)).length,
      };
    });
    const goldTargetOccurrences = rows.reduce(
      (n, row) => n + row.goldTargetIds.length,
      0,
    );
    const coveredGoldTargetOccurrences = sets.reduce(
      (n, row) => n + row.covered,
      0,
    );
    return {
      cap,
      coveredGoldTargetOccurrences,
      goldTargetOccurrences,
      candidateRecall: goldTargetOccurrences
        ? coveredGoldTargetOccurrences / goldTargetOccurrences
        : 0,
      proposalKeyMemberships: sets.reduce((n, row) => n + row.keySize, 0),
      uniqueMappedMemberships: sets.reduce((n, row) => n + row.mappedSize, 0),
      proposalKeySize: sizeDistribution(sets.map((row) => row.keySize)),
      uniqueMappedSize: sizeDistribution(sets.map((row) => row.mappedSize)),
    };
  });
  const baseline = results[0]!;
  return results.map((result) => ({
    ...result,
    addedProposalKeyMemberships:
      result.proposalKeyMemberships - baseline.proposalKeyMemberships,
    addedUniqueMappedMemberships:
      result.uniqueMappedMemberships - baseline.uniqueMappedMemberships,
  }));
}

function pinnedBytes(relative: string, expected: string): Buffer {
  const bytes = readFileSync(path.join(ROOT, relative));
  if (sha256(bytes) !== expected)
    throw new Error(`Pinned input differs: ${relative}.`);
  return bytes;
}

function trainRows<T extends { readonly split: string }>(bytes: Buffer): T[] {
  return parseJsonlRowsForSplit<T>(
    bytes.toString("utf8").split(/\r?\n/u),
    "train",
  );
}

function declarationAlias(
  filePath: string,
  declaration: AstDeclaredDeclaration,
): string {
  const container = ["class", "interface", "object"].includes(
    declaration.owner.kind,
  )
    ? declaration.owner.name
    : null;
  return `${filePath}#${container ? `${container}.` : ""}${declaration.name}`;
}

function scopedFacts(
  facts: readonly Phase2FactFile[],
  source: Phase2CorpusSource,
  filePath: string,
): Phase2FactFile {
  const matches = facts.filter(
    (row) =>
      row.snapshotId === source.snapshotId &&
      row.repoId === source.repoId &&
      row.filePath === filePath,
  );
  if (matches.length !== 1)
    throw new Error(`Pinned source facts are not unique for ${filePath}.`);
  return matches[0]!;
}

function sourceBytes(
  source: Phase2CorpusSource,
  filePath: string,
  expected: string,
): Buffer {
  const directories: Readonly<Record<string, string>> = {
    nest: "nest",
    graft: "Graft",
  };
  const directory = directories[source.snapshotId];
  if (
    !directory ||
    source.split !== "train" ||
    !/^[a-f0-9]{40}$/u.test(source.revision)
  )
    throw new Error(
      "Source inspection accepts only affected pinned TRAIN snapshots.",
    );
  const bytes = execFileSync(
    "git",
    [
      "show",
      `${source.revision}:${source.subtree ? `${source.subtree}/` : ""}${filePath}`,
    ],
    {
      cwd: path.resolve(ROOT, "..", directory),
      maxBuffer: 32 * 1024 * 1024,
    },
  );
  if (sha256(bytes) !== expected)
    throw new Error(`Pinned source bytes differ: ${filePath}.`);
  return bytes;
}

function annotatedSpan(
  code: string,
  span: { readonly start: number; readonly end: number },
) {
  return {
    startLineOneBased: code.slice(0, span.start).split("\n").length,
    span,
    text: code.slice(span.start, span.end),
  };
}

function stageSequence(row: ReplayRow, targetId: string) {
  return row.proposalFilterStages.stages.map((stage) => ({
    stage: stage.stage,
    candidateKeyCount: stage.candidateKeys.length,
    targetRanksOneBased: stage.targetIdsInOrder.flatMap((id, index) =>
      id === targetId ? [index + 1] : [],
    ),
  }));
}

async function run(): Promise<void> {
  const manifestPath = `${EVIDENCE_DIRECTORY}/proposal-filter-stage-replay-manifest.json`;
  const manifest = JSON.parse(
    pinnedBytes(manifestPath, PINS.replayManifest).toString("utf8"),
  );
  assertTrainMissAuditScope(manifest, []);
  if (
    manifest.pinnedV4.predictionsPath !== PREDICTION_PATH ||
    manifest.provenance.outputPath !== REPLAY_PATH
  )
    throw new Error("Replay paths differ from bounded pinned inputs.");
  const summary = JSON.parse(
    pinnedBytes(
      `${EVIDENCE_DIRECTORY}/proposal-filter-stage-train-summary.json`,
      PINS.summary,
    ).toString("utf8"),
  );
  const sourceHashes = verifyPhase1SourceSidecars();
  if (
    canonicalHash(sourceHashes) !==
    canonicalHash(manifest.pinnedV4.sourceInputHashes)
  )
    throw new Error("Source hashes differ from pinned v4 provenance.");
  for (const file of [
    "lib/core/src/ast/ast-worker.ts",
    "lib/core/src/ast/call-site-shape-facts.ts",
    "lib/core/src/ast/declared-type-facts.ts",
    "lib/ast-core/src/core/edge-computer.ts",
  ])
    pinnedBytes(file, manifest.pinnedV4.implementationFiles[file]);
  const observations = trainRows<Phase2EvaluationObservation>(
    pinnedBytes(PREDICTION_PATH, PINS.predictions),
  );
  const replay = trainRows<ReplayRow>(pinnedBytes(REPLAY_PATH, PINS.replay));
  const sources = trainRows<
    Phase2CorpusSource & { readonly exclusionReason?: string }
  >(pinnedBytes(SOURCE_PATH, sourceHashes["callsites.jsonl"]!));
  assertTrainMissAuditScope(manifest, [...observations, ...replay, ...sources]);
  const ids = new Set(observations.map((row) => row.sampleId));
  const expectedIdsHash = manifest.trainSampleIdsHash;
  for (const rows of [observations, replay, sources]) {
    const rowIds = rows
      .map((row) => row.sampleId)
      .sort((a, b) => a.localeCompare(b));
    if (
      rows.length !== manifest.trainSampleIds ||
      new Set(rowIds).size !== ids.size ||
      canonicalHash(rowIds) !== expectedIdsHash
    )
      throw new Error(
        "Inputs do not exactly cover the pinned TRAIN sample IDs.",
      );
  }
  if (replay.some((row) => !row.decisionFieldsEquivalent))
    throw new Error("Replay decisions diverge from v4.");
  const labels = await labelsForSplitIsolated("train", ids);
  if (
    labels.some((row) => row.split !== "train") ||
    canonicalHash(
      [...labels].sort((a, b) => a.sampleId.localeCompare(b.sampleId)),
    ) !== PINS.trainLabels
  )
    throw new Error("TRAIN label provenance differs.");
  const facts = allFactRows();
  const unique = filterInputsToUniqueOracleTargets(
    observations,
    labels,
    candidateOracleTargetMapping(facts),
  );
  const metrics = evaluateProposalFilterStageSplit({
    observations,
    candidateStages: replay.map((row) => row.candidateStages),
    evidence: replay.map((row) => row.proposalFilterStages),
    labels,
    uniqueInputs: unique,
    split: "train",
  });
  if (canonicalHash(metrics) !== canonicalHash(summary.metrics))
    throw new Error("Recomputed TRAIN metrics differ from committed evidence.");
  const bySource = new Map(sources.map((row) => [row.sampleId, row]));
  const byReplay = new Map(replay.map((row) => [row.sampleId, row]));
  const byObservation = new Map(observations.map((row) => [row.sampleId, row]));
  const missed = unique.labels.flatMap((label) => {
    if (label.reviewStatus !== "confirmed") return [];
    const row = byReplay.get(label.sampleId)!;
    const final = row.proposalFilterStages.stages.at(-1)!;
    return label.positiveTargetIds
      .filter((id) => !final.uniqueMappedTargetIds.includes(id))
      .map((targetId) => ({ sampleId: label.sampleId, targetId }));
  });
  if (missed.length !== 28)
    throw new Error("Expected exactly 28 TRAIN miss occurrences.");
  const parsed = new Map<string, readonly AstCallSiteShapeFact[]>();
  const pool = new AstWorkerPool();
  const cases = [];
  await pool.initialize(1);
  try {
    for (const miss of missed) {
      const source = bySource.get(miss.sampleId)!;
      const row = byReplay.get(miss.sampleId)!;
      const callerFacts = scopedFacts(facts, source, source.filePath);
      const bytes = sourceBytes(
        source,
        source.filePath,
        row.candidateStages.sourceContentHash,
      );
      if (sha256(bytes) !== callerFacts.fileContentSha256)
        throw new Error("Caller facts differ from replay source hash.");
      const code = bytes.toString("utf8");
      const cacheKey = `${source.snapshotId}:${source.filePath}`;
      if (!parsed.has(cacheKey)) {
        const result = await pool.parse({
          filePath: source.filePath,
          code,
          language: "typescript",
        });
        if (!result.success || !result.data?.callSiteShapeFacts)
          throw new Error("Pinned TRAIN caller parse failed.");
        parsed.set(cacheKey, result.data.callSiteShapeFacts.callSites);
      }
      const matches = parsed
        .get(cacheKey)!
        .filter(
          (fact) =>
            fact.startLine === source.line &&
            fact.startColumn === source.column &&
            fact.calleeName === source.calleeName,
        );
      if (matches.length !== 1)
        throw new Error("Caller lacks one exact fact at labeled position.");
      const shape = matches[0]!;
      const inputHash = canonicalHash({
        sampleId: source.sampleId,
        callSiteId: source.callSiteId,
        filePath: source.filePath,
        line: source.line,
        column: source.column,
        calleeName: source.calleeName,
        positionStatus: source.positionStatus,
        sourceContentHash: sha256(bytes),
        callSiteShapeFact: shape,
      });
      if (
        inputHash !== row.candidateStages.callSiteInputHash ||
        inputHash !== row.proposalFilterStages.callSiteInputHash
      )
        throw new Error(
          "Reparsed fact differs from exact replay callsite input.",
        );
      const targetFile = miss.targetId.split("#")[0]!;
      const targetFacts = scopedFacts(facts, source, targetFile);
      const declarations = targetFacts.declaredTypeFacts.declarations.filter(
        (declaration) =>
          declarationAlias(targetFile, declaration) === miss.targetId,
      );
      if (declarations.length !== 1)
        throw new Error("Gold target is not uniquely pinned.");
      const declaration = declarations[0]!;
      const targetCode = sourceBytes(
        source,
        targetFile,
        targetFacts.fileContentSha256,
      ).toString("utf8");
      const rawPresent = row.candidateStages.mappedCandidateTargetIds.includes(
        miss.targetId,
      );
      const firstMissingStage = rawPresent
        ? row.proposalFilterStages.stages.find(
            (stage) => !stage.uniqueMappedTargetIds.includes(miss.targetId),
          )!.stage
        : "rawAbsent";
      const owner = declaration.owner;
      const ownerDeclarations =
        targetFacts.declaredTypeFacts.declarations.filter(
          (candidate) =>
            canonicalHash(candidate.owner) === canonicalHash(owner),
        );
      const callerLine = code.split(/\r?\n/u)[source.line]!;
      if (
        !rawPresent &&
        !callerLine.slice(source.column).startsWith(`${source.calleeName}\``)
      )
        throw new Error(
          "Raw miss is not a tagged template at the exact source position.",
        );
      cases.push({
        ...miss,
        split: "train",
        repoId: source.repoId,
        snapshotId: source.snapshotId,
        revision: source.revision,
        callSiteId: source.callSiteId,
        firstMissingStage,
        observationCalleeKind: byObservation.get(miss.sampleId)!.calleeKind,
        syntax: !rawPresent
          ? "tagged-template"
          : source.receiverText === "?."
            ? "optional-member-call"
            : "member-call",
        ...(rawPresent
          ? {}
          : classifyRawMissEvidence(
              source.positionStatus,
              source.exclusionReason,
              matches.length,
            )),
        caller: {
          filePath: source.filePath,
          sourceSha256: sha256(bytes),
          lineZeroBased: source.line,
          columnZeroBased: source.column,
          lineOneBased: source.line + 1,
          sourceLine: callerLine,
          positionStatus: source.positionStatus,
          exclusionReason: source.exclusionReason ?? null,
          exactParserFactCount: matches.length,
          callSiteInputHash: inputHash,
          shape,
        },
        target: {
          filePath: targetFile,
          sourceSha256: targetFacts.fileContentSha256,
          candidateTargetKey: candidateTargetKeyForDeclaration(
            targetFile,
            declaration,
          ),
          declaration,
          source: annotatedSpan(targetCode, declaration.declarationSpan),
          ownerInventory: targetFacts.declaredTypeFacts.ownerInventories.find(
            (inventory) =>
              canonicalHash(inventory.owner) === canonicalHash(owner),
          ),
          directMemberNames: [
            ...new Set(ownerDeclarations.map((candidate) => candidate.name)),
          ]
            .filter(Boolean)
            .sort(),
          typeRelations: targetFacts.declaredTypeFacts.facts.filter(
            (fact) => canonicalHash(fact.owner) === canonicalHash(owner),
          ),
        },
        receiverTypeFacts: callerFacts.declaredTypeFacts.facts.filter(
          (fact) =>
            shape.receiverBinding &&
            fact.declarationSpan.start ===
              shape.receiverBinding.declarationSpan.start &&
            fact.declarationSpan.end ===
              shape.receiverBinding.declarationSpan.end,
        ),
        stages: stageSequence(row, miss.targetId),
      });
    }
  } finally {
    await pool.terminate();
  }
  const stageCounts = Object.fromEntries(
    [
      "rawAbsent",
      "afterExplicitReceiverType",
      "afterPeerMembers",
      "afterMaxCandidates",
    ].map((stage) => [
      stage,
      cases.filter((row) => row.firstMissingStage === stage).length,
    ]),
  );
  if (
    canonicalHash(stageCounts) !==
    canonicalHash({
      rawAbsent: 7,
      afterExplicitReceiverType: 2,
      afterPeerMembers: 2,
      afterMaxCandidates: 17,
    })
  )
    throw new Error("Miss attribution differs from pinned TRAIN totals.");
  const peerSource = bySource.get(
    cases.find((row) => row.firstMissingStage === "afterPeerMembers")!.sampleId,
  )!;
  const baseFile = "packages/core/nest-application-context.ts";
  const baseFacts = scopedFacts(facts, peerSource, baseFile);
  const baseCode = sourceBytes(
    peerSource,
    baseFile,
    baseFacts.fileContentSha256,
  ).toString("utf8");
  const inheritedDeclarations = baseFacts.declaredTypeFacts.declarations.filter(
    (declaration) =>
      declaration.owner.name === "NestApplicationContext" &&
      declaration.name === "enableShutdownHooks",
  );
  if (inheritedDeclarations.length !== 1)
    throw new Error("Inherited peer method is not uniquely pinned.");
  const supplementarySourceEvidence = {
    filePath: baseFile,
    revision: peerSource.revision,
    sourceSha256: baseFacts.fileContentSha256,
    inheritedPeer: annotatedSpan(
      baseCode,
      inheritedDeclarations[0]!.declarationSpan,
    ),
  };
  // Reconstruct the original, unmodified TRAIN workspace before bypassing only
  // the replay's source-position gate in seven direct capability requests.
  for (const [file, expected] of Object.entries(
    manifest.replay.implementationFiles,
  ))
    pinnedBytes(file, expected as string);
  const nestSources = sources.filter((source) => source.snapshotId === "nest");
  const nestSource = nestSources[0]!;
  const probeService = new PositionProbeService();
  const original = await processPhase2Snapshot({
    snapshot: {
      snapshotId: "nest",
      repoId: nestSource.repoId,
      revision: nestSource.revision,
      subtree: nestSource.subtree,
      sourceDir: "nest",
      snapshotHash: nestSource.snapshotHash,
    },
    repositoriesDirectory: path.resolve(ROOT, ".."),
    temporaryDirectory: mkdtempSync(
      path.join(tmpdir(), "docuvia-train-position-probe-"),
    ),
    sourceRows: nestSources,
    factRows: facts,
    service: probeService,
    processor: makeAstProcessor(),
    factsSidecarHash: sourceHashes["declared-type-facts-pass-a.jsonl"]!,
  });
  const probeWorkspace = probeService.workspace;
  if (
    !probeWorkspace ||
    original.sourceFingerprint !== manifest.replay.snapshotFingerprints.nest ||
    original.configurationHash !== manifest.pinnedV4.configurationHash
  )
    throw new Error(
      "Position probe did not reconstruct the pinned Nest TRAIN workspace.",
    );
  for (const observation of original.observations) {
    const pinned = byObservation.get(observation.sampleId)!;
    for (const field of manifest.decisions
      .comparedDecisionFields as (keyof Phase2EvaluationObservation)[])
      if (JSON.stringify(observation[field]) !== JSON.stringify(pinned[field]))
        throw new Error(
          `Original TRAIN decision changed before capability probe: ${field}.`,
        );
  }
  const positionGateBypass = cases
    .filter((row) => row.firstMissingStage === "rawAbsent")
    .map((row) => {
      const traced = probeService.hypothesizeWithCandidateStageTrace({
        callerFilePath: row.caller.filePath,
        callerSourceContentHash: row.caller.sourceSha256,
        callSite: row.caller.shape,
        workspaceIndex: probeWorkspace,
      });
      const result = traced.result;
      const nestFacts = facts.filter(
        (fact) => fact.snapshotId === "nest" && fact.repoId === row.repoId,
      );
      const mappedIds = (keys: readonly string[]) =>
        keys.map(
          (key) =>
            mapCandidateKeysToUnambiguousAliases([key], nestFacts).aliases[0] ??
            null,
        );
      const targetKey = row.target.candidateTargetKey!;
      return {
        sampleId: row.sampleId,
        split: "train",
        targetId: row.targetId,
        targetKey,
        generatedCandidateKeys: result.generatedCandidateKeys,
        beforeMaxCandidatesKeys: traced.candidateStageTrace.beforeMaxCandidates,
        orderedProposalKeys: result.candidates.map(
          (candidate) => candidate.targetKey,
        ),
        generatedTargetIdsInOrder: mappedIds(result.generatedCandidateKeys),
        beforeMaxCandidatesTargetIdsInOrder: mappedIds(
          traced.candidateStageTrace.beforeMaxCandidates,
        ),
        orderedProposalTargetIdsInOrder: mappedIds(
          result.candidates.map((candidate) => candidate.targetKey),
        ),
        callSiteInputHash: row.caller.callSiteInputHash,
        sourceSha256: row.caller.sourceSha256,
        goldInGeneratedKeys: result.generatedCandidateKeys.includes(targetKey),
        goldInOrderedProposals: result.candidates.some(
          (candidate) => candidate.targetKey === targetKey,
        ),
        generatedCandidateCount: result.generatedCandidateKeys.length,
        proposedCandidateCount: result.candidates.length,
        status: result.status,
        reason: result.reason,
        truncated: result.truncated,
        candidateSetComplete: result.candidateSetComplete,
        featureInputHash: result.featureInputHash,
        configurationHash: result.configurationHash,
        sourceFingerprint: result.sourceFingerprint,
      };
    });
  const eligibleIds = new Set(
    labels
      .filter(
        (label) =>
          label.reviewStatus === "confirmed" &&
          label.positiveTargetIds.length > 0,
      )
      .map((label) => label.sampleId),
  );
  const sensitivityRows = unique.labels
    .filter((label) => eligibleIds.has(label.sampleId))
    .map((label) => ({
      sampleId: label.sampleId,
      split: label.split,
      goldTargetIds: label.positiveTargetIds,
      orderedTargetIds: byReplay
        .get(label.sampleId)!
        .proposalFilterStages.stages.find(
          (stage) => stage.stage === "beforeMaxCandidates",
        )!.targetIdsInOrder,
    }));
  const caps = [25, 26, 27, 28, 29, 30, 31, 32, 33];
  const capSensitivity = measureTrainCapSensitivity(sensitivityRows, caps);
  const byProbe = new Map(positionGateBypass.map((row) => [row.sampleId, row]));
  const capSensitivityWithDirectRequests = measureTrainCapSensitivity(
    sensitivityRows.map((row) => ({
      ...row,
      orderedTargetIds:
        byProbe.get(row.sampleId)?.beforeMaxCandidatesTargetIdsInOrder ??
        row.orderedTargetIds,
    })),
    caps,
  );
  const rawRows = sensitivityRows.map((row) => ({
    ...row,
    orderedTargetIds: byReplay
      .get(row.sampleId)!
      .candidateStages.generatedCandidateKeyMappings.map(
        (mapping) => mapping.targetId,
      ),
  }));
  const rawCapability = {
    originalReplay: {
      ...measureTrainCapSensitivity(rawRows, [Number.MAX_SAFE_INTEGER])[0]!,
      cap: null,
    },
    withDirectRequests: {
      ...measureTrainCapSensitivity(
        rawRows.map((row) => ({
          ...row,
          orderedTargetIds:
            byProbe.get(row.sampleId)?.generatedTargetIdsInOrder ??
            row.orderedTargetIds,
        })),
        [Number.MAX_SAFE_INTEGER],
      )[0]!,
      cap: null,
    },
  };
  if (
    capSensitivity[0]!.coveredGoldTargetOccurrences !== 12149 ||
    capSensitivity.at(-1)!.coveredGoldTargetOccurrences !== 12166
  )
    throw new Error("Cap sensitivity does not recover exactly 17 cap losses.");
  if (
    rawCapability.withDirectRequests.coveredGoldTargetOccurrences !== 12177 ||
    capSensitivityWithDirectRequests[0]!.coveredGoldTargetOccurrences !==
      12156 ||
    capSensitivityWithDirectRequests.at(-1)!.coveredGoldTargetOccurrences !==
      12173
  )
    throw new Error(
      "Merged capability view differs from exact seven direct requests.",
    );
  const outputPath =
    "evaluate/results/semantic-corpus/v1/phase2-p2a-v4-train-miss-source-audit/train-miss-source-summary.json";
  writeJson(path.join(ROOT, outputPath), {
    schemaVersion: 1,
    measurement: "phase2-p2a-train-miss-source-audit/1",
    split: "train",
    labelSplitsRead: ["train"],
    heldoutLabelsRead: false,
    behaviorChanged: false,
    pinnedV4PredictionArtifactChanged: false,
    capSweepRanksRecomputed: false,
    capabilityRequestsRecomputed: true,
    counts: {
      eligibleSites: metrics.allConfirmedEligibleSiteCount,
      goldTargetOccurrences:
        metrics.uniqueMappablePositiveTargetOccurrenceCount,
      stageCounts,
      sourcePositionExclusion: 7,
      provenUnsupportedSyntax: 0,
      exactCallSiteHashMatches: cases.length,
    },
    capSensitivitySemantics: {
      sequence:
        "existing beforeMaxCandidates prefix; order and all earlier filters unchanged",
      baselineCap: 25,
      sizeDenominator:
        "all confirmed eligible TRAIN sites, including unscorable gold targets",
      quantiles: "nearest rank ceil(p*n)-1",
      mappedMemberships:
        "unique mapped target IDs per site; null ambiguous/unmapped keys consume cap slots",
      candidateRecallDenominator:
        "uniquely mappable positive target occurrences",
    },
    capSensitivity,
    rawCapability,
    capSensitivityWithDirectRequests,
    directRequestMergeSemantics:
      "replace only the seven originally empty TRAIN sequences with exact direct-service candidate-stage sequences; preserve original batch summary and label denominator; candidate capability is not selected/proven resolution",
    supplementarySourceEvidence,
    positionGateBypassSemantics: {
      directRequestCount: 7,
      originalTrainNestDecisionRowsVerified: original.observations.length,
      originalSourceFingerprint: original.sourceFingerprint,
      sourcePositionGateChanged: false,
      productionPolicyChanged: false,
      interpretation:
        "candidate capability only; status/reason are source-only default service outputs without calibration records",
    },
    positionGateBypass,
    provenance: {
      pins: PINS,
      replayManifestPath: manifestPath,
      predictionPath: PREDICTION_PATH,
      replayPath: REPLAY_PATH,
      sourcePath: SOURCE_PATH,
      sourceInputHashes: sourceHashes,
      trainSampleIdsHash: expectedIdsHash,
      candidateGeneratorVersion: manifest.candidateGeneratorVersion,
      pinnedV4ImplementationHash: manifest.pinnedV4.implementationHash,
      configurationHash: manifest.pinnedV4.configurationHash,
      decisionProofHash: manifest.decisions.decisionProofHash,
      auditScriptSha256: sha256(readFileSync(fileURLToPath(import.meta.url))),
    },
    cases,
  });
  console.info(
    `[phase2-p2a] TRAIN source audit: ${JSON.stringify(stageCounts)}; ${cases.length}/28 exact callsite-input hashes match; output ${outputPath} (${sha256(readFileSync(path.join(ROOT, outputPath)))}).`,
  );
  console.info(JSON.stringify(capSensitivity));
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  run().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
