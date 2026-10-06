import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import ts from "typescript";
import {
  CALL_RESOLUTION_CANDIDATE_GENERATOR_VERSION,
  CALL_RESOLUTION_Q3_NEW_RECEIVER_RULE_SIGNATURE,
  CALL_RESOLUTION_Q3_SUPER_CALL_RULE_SIGNATURE,
  CALL_RESOLUTION_Q3_THIS_INHERITED_RULE_SIGNATURE,
  CALL_RESOLUTION_Q3_TYPED_RECEIVER_RULE_SIGNATURE,
} from "../../lib/contracts/src/index.js";
import type {
  CallResolutionHypothesisRequest,
  CallResolutionHypothesisWorkspaceInput,
  CallResolutionStrictProof,
} from "../../lib/contracts/src/index.js";
import { CallResolutionHypothesisService } from "../../lib/core/src/semantic/call-resolution-hypothesis.service.js";
import {
  allFactRows,
  allSourceRows,
  canonicalHash,
  labelsForSplitIsolated,
  PHASE2_CORPUS,
  PHASE2_DEFAULT_OUTPUT,
  PHASE2_DEFAULT_REPOSITORIES,
  PHASE2_PHASE1,
  PHASE2_ROOT,
  readJson,
  readJsonl,
  sha256,
  verifyPhase1SourceSidecars,
  type Phase2CorpusSource,
} from "./phase2-tiered-call-resolution-support.mjs";
import {
  makeAstProcessor,
  processPhase2Snapshot,
  type Phase2PinnedSnapshot,
} from "./phase2-tiered-call-resolution-source.mts";
import type { Phase2EvaluationLabel } from "./phase2-tiered-call-resolution-evaluation.mjs";

const EXPECTED_SOURCE_ROWS = 31_578;
const Q3_RULES = [
  CALL_RESOLUTION_Q3_SUPER_CALL_RULE_SIGNATURE,
  CALL_RESOLUTION_Q3_THIS_INHERITED_RULE_SIGNATURE,
  CALL_RESOLUTION_Q3_TYPED_RECEIVER_RULE_SIGNATURE,
  CALL_RESOLUTION_Q3_NEW_RECEIVER_RULE_SIGNATURE,
] as const;
const PINNED_SOURCE_REPRODUCTION = path.join(
  PHASE2_ROOT,
  "evaluate/results/semantic-corpus/v1/phase2-p2a-direct-import-alias-final-source-reproduction",
);
const IMPLEMENTATION_FILES = [
  "lib/contracts/src/index.ts",
  "lib/contracts/src/interfaces/call-resolution-hypothesis.interfaces.ts",
  "lib/contracts/src/interfaces/call-site-shape-facts.interfaces.ts",
  "lib/contracts/src/interfaces/declared-type-facts.interfaces.ts",
  "lib/core/src/ast/ast-worker.ts",
  "lib/core/src/ast/call-site-shape-facts.ts",
  "lib/core/src/ast/declared-type-facts.ts",
  "lib/core/src/semantic/call-resolution-hypothesis-index.ts",
  "lib/core/src/semantic/call-resolution-reexport-proof.ts",
  "lib/core/src/semantic/call-resolution-hypothesis.service.ts",
  "lib/core/src/semantic/call-resolution-strict-proof.ts",
  "lib/core/src/semantic/call-resolution-q3-receiver-proof.ts",
  "lib/core/src/graph/call-resolution-graph-projection.ts",
  "scripts/semantic-corpus/phase2-tiered-call-resolution-source.mts",
  "scripts/semantic-corpus/phase3-q3-receiver-proof-audit.mts",
  "lib/core/src/semantic/call-resolution-q3-receiver-proof.integration.test.ts",
];

interface CorpusSnapshotSpec {
  readonly snapshotId: string;
  readonly sourceDir: string;
  readonly subtree: string | null;
}

interface CollectionSnapshot {
  readonly snapshotId: string;
  readonly repoId: string;
  readonly revision: string;
  readonly subtree: string | null;
  readonly snapshotHash: string;
}

interface ScopeResolverRow {
  readonly sampleId: string;
  readonly split: string;
  readonly resolverTargetId: string | null;
}

interface ProofEvent {
  readonly snapshotId: string;
  readonly callerFilePath: string;
  readonly startLine: number;
  readonly startColumn: number;
  readonly calleeName: string;
  readonly strictProof: CallResolutionStrictProof;
  readonly selectedTargetKey: string | null;
}

interface JoinedProof {
  readonly sampleId: string;
  readonly split: string;
  readonly repoFamily: string;
  readonly ruleSignature: (typeof Q3_RULES)[number];
  readonly targetId: string;
  readonly positiveTargetIds: readonly string[];
  readonly resolverTargetId: string | null;
  readonly differsFromScopeResolver: boolean;
}

function parseOutputPath(argv: readonly string[]): string {
  if (argv.length === 0)
    return path.join(PHASE2_DEFAULT_OUTPUT, "phase3-q3-receiver-proof.json");
  if (argv.length !== 2 || argv[0] !== "--out" || !argv[1])
    throw new Error(
      "Usage: phase3-q3-receiver-proof-audit.mts [--out <json-path>]",
    );
  return path.resolve(argv[1]);
}

function implementationHashes(repositoryRoot: string): Record<string, string> {
  return Object.fromEntries(
    IMPLEMENTATION_FILES.map((file) => [
      file,
      sha256(readFileSync(path.join(repositoryRoot, file))),
    ]),
  );
}

function pinnedSnapshots(repositoryRoot: string): Phase2PinnedSnapshot[] {
  const specification = readJson<{
    readonly snapshots: readonly CorpusSnapshotSpec[];
  }>(path.join(repositoryRoot, "evaluate/semantic-corpus/corpus-spec.v1.json"));
  const collection = readJson<{
    readonly snapshots: readonly CollectionSnapshot[];
  }>(path.join(PHASE2_CORPUS, "collection-report.json"));
  const specById = new Map(
    specification.snapshots.map((row) => [row.snapshotId, row]),
  );
  return collection.snapshots.map((row) => {
    const spec = specById.get(row.snapshotId);
    if (!spec || spec.subtree !== row.subtree)
      throw new Error(`Corpus specification mismatch for ${row.snapshotId}.`);
    return { ...row, sourceDir: spec.sourceDir };
  });
}

function eventKey(
  snapshotId: string,
  filePath: string,
  line: number,
  column: number,
  calleeName: string,
): string {
  return `${snapshotId}\0${filePath}\0${line}\0${column}\0${calleeName}`;
}

class Q3AuditService extends CallResolutionHypothesisService {
  snapshotId = "";
  readonly events: ProofEvent[] = [];

  override indexWorkspace(input: CallResolutionHypothesisWorkspaceInput) {
    return super.indexWorkspace(input);
  }

  override hypothesize(request: CallResolutionHypothesisRequest) {
    const result = super.hypothesize(request);
    if (request.callSite.calleeKind !== "bare") {
      this.events.push({
        snapshotId: this.snapshotId,
        callerFilePath: request.callerFilePath,
        startLine: request.callSite.startLine,
        startColumn: request.callSite.startColumn,
        calleeName: request.callSite.calleeName,
        strictProof: result.strictProof,
        selectedTargetKey: result.selected?.targetKey ?? null,
      });
    }
    return result;
  }
}

function splitLabelsHash(labels: readonly Phase2EvaluationLabel[]): string {
  return canonicalHash(
    [...labels]
      .sort((left, right) => left.sampleId.localeCompare(right.sampleId))
      .map((label) => ({
        sampleId: label.sampleId,
        split: label.split,
        repoFamily: label.repoFamily,
        positiveTargetIds: label.positiveTargetIds,
        reviewStatus: label.reviewStatus,
      })),
  );
}

function targetIdForProof(
  proof: Extract<CallResolutionStrictProof, { status: "proven" }>,
): string | null {
  if (!("targetOwnerName" in proof)) return null;
  return `${proof.targetFilePath}#${proof.targetOwnerName}.${proof.targetName}`;
}

async function main(): Promise<void> {
  const repositoryRoot = path.resolve(import.meta.dirname, "../..");
  const outputPath = parseOutputPath(process.argv.slice(2));
  const sourceHashes = verifyPhase1SourceSidecars();
  const sourceRows = allSourceRows();
  if (sourceRows.length !== EXPECTED_SOURCE_ROWS)
    throw new Error(
      `Expected ${EXPECTED_SOURCE_ROWS} source rows; got ${sourceRows.length}.`,
    );
  const factRows = allFactRows();
  const rowsBySnapshot = new Map<string, Phase2CorpusSource[]>();
  for (const row of sourceRows) {
    const rows = rowsBySnapshot.get(row.snapshotId) ?? [];
    rows.push(row);
    rowsBySnapshot.set(row.snapshotId, rows);
  }

  const sourceManifest = readJson<{
    readonly sourceRows: number;
    readonly sourceInputHashes: Record<string, string>;
  }>(
    path.join(PINNED_SOURCE_REPRODUCTION, "candidate-prediction-manifest.json"),
  );
  if (
    sourceManifest.sourceRows !== EXPECTED_SOURCE_ROWS ||
    sourceManifest.sourceInputHashes["callsites.jsonl"] !==
      sourceHashes["callsites.jsonl"] ||
    sourceManifest.sourceInputHashes["declared-type-facts-pass-a.jsonl"] !==
      sourceHashes["declared-type-facts-pass-a.jsonl"]
  )
    throw new Error(
      "Pinned source-only reproduction manifest does not match the sidecars.",
    );

  const service = new Q3AuditService();
  const processor = makeAstProcessor();
  const temporaryRoot = mkdtempSync(
    path.join(os.tmpdir(), "docuvia-q3-corpus-"),
  );
  const snapshotResults = [];
  try {
    for (const snapshot of pinnedSnapshots(repositoryRoot)) {
      service.snapshotId = snapshot.snapshotId;
      const result = await processPhase2Snapshot({
        snapshot,
        repositoriesDirectory: PHASE2_DEFAULT_REPOSITORIES,
        temporaryDirectory: path.join(temporaryRoot, snapshot.snapshotId),
        sourceRows: rowsBySnapshot.get(snapshot.snapshotId) ?? [],
        factRows,
        service,
        processor,
        factsSidecarHash: sourceHashes["declared-type-facts-pass-a.jsonl"]!,
        includeConfiguredPathAliases: true,
        includeStrictNamedImportTargets: true,
        includeQ3ReceiverFacts: true,
      });
      snapshotResults.push({
        snapshotId: snapshot.snapshotId,
        snapshotHash: snapshot.snapshotHash,
        sourceRows: (rowsBySnapshot.get(snapshot.snapshotId) ?? []).length,
        sourceFactFileCount: result.sourceFactFileCount,
        callShapeMappedCount: result.callShapeMappedCount,
        callShapeMissingCount: result.callShapeMissingCount,
        parsedCallFileCount: result.parsedCallFileCount,
        parsedImportTargetFileCount: result.parsedImportTargetFileCount,
        parseFailureCount: result.parseFailureCount,
      });
      if (result.parseFailureCount !== 0)
        throw new Error(`Source parse failed for ${snapshot.snapshotId}.`);
    }
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }

  const sourceByKey = new Map<string, Phase2CorpusSource>();
  for (const row of sourceRows) {
    const key = eventKey(
      row.snapshotId,
      row.filePath,
      row.line,
      row.column,
      row.calleeName ?? "",
    );
    if (sourceByKey.has(key))
      throw new Error(`Duplicate corpus call-site key: ${row.sampleId}`);
    sourceByKey.set(key, row);
  }
  const eventBySampleId = new Map<string, ProofEvent>();
  for (const event of service.events) {
    const key = eventKey(
      event.snapshotId,
      event.callerFilePath,
      event.startLine,
      event.startColumn,
      event.calleeName,
    );
    const source = sourceByKey.get(key);
    if (!source) continue;
    if (eventBySampleId.has(source.sampleId))
      throw new Error(
        `More than one proof request matched ${source.sampleId}.`,
      );
    eventBySampleId.set(source.sampleId, event);
  }

  const splitIds = new Map<string, Set<string>>();
  for (const split of ["train", "calibration"] as const)
    splitIds.set(
      split,
      new Set(
        sourceRows
          .filter((row) => row.split === split)
          .map((row) => row.sampleId),
      ),
    );
  const trainLabels = await labelsForSplitIsolated(
    "train",
    splitIds.get("train")!,
  );
  const calibrationLabels = await labelsForSplitIsolated(
    "calibration",
    splitIds.get("calibration")!,
  );
  const labelsById = new Map(
    [...trainLabels, ...calibrationLabels].map((label) => [
      label.sampleId,
      label,
    ]),
  );
  const scopeRows = readJsonl<ScopeResolverRow>(
    path.join(PHASE2_PHASE1, "scope-resolver-baseline.jsonl"),
  );
  const scopeById = new Map(scopeRows.map((row) => [row.sampleId, row]));
  const provenSites: JoinedProof[] = [];
  const proofReasonCounts: Record<string, number> = {};
  for (const row of sourceRows) {
    if (row.split !== "train" && row.split !== "calibration") continue;
    const event = eventBySampleId.get(row.sampleId);
    if (!event) continue;
    const { strictProof } = event;
    proofReasonCounts[strictProof.reason] =
      (proofReasonCounts[strictProof.reason] ?? 0) + 1;
    if (
      strictProof.status !== "proven" ||
      !Q3_RULES.includes(strictProof.ruleSignature as (typeof Q3_RULES)[number])
    )
      continue;
    const targetId = targetIdForProof(strictProof);
    if (!targetId)
      throw new Error(`Q3 proof has no member owner: ${row.sampleId}`);
    const label = labelsById.get(row.sampleId);
    if (!label)
      throw new Error(`TRAIN/CALIBRATION label missing for ${row.sampleId}.`);
    const resolverTargetId =
      scopeById.get(row.sampleId)?.resolverTargetId ?? null;
    provenSites.push({
      sampleId: row.sampleId,
      split: row.split,
      repoFamily: row.repoFamily,
      ruleSignature: strictProof.ruleSignature as (typeof Q3_RULES)[number],
      targetId,
      positiveTargetIds: label.positiveTargetIds,
      resolverTargetId,
      differsFromScopeResolver: resolverTargetId !== targetId,
    });
  }

  const labelsMissingForProof = provenSites.filter(
    (row) => row.positiveTargetIds.length === 0,
  );
  const disagreements = provenSites.filter(
    (row) => !row.positiveTargetIds.includes(row.targetId),
  );
  const splitMetrics = ["train", "calibration"].flatMap((split) =>
    Q3_RULES.map((ruleSignature) => {
      const sourceCount = sourceRows.filter(
        (row) => row.split === split,
      ).length;
      const proofs = provenSites.filter(
        (row) => row.split === split && row.ruleSignature === ruleSignature,
      );
      return {
        split,
        ruleSignature,
        sourceRows: sourceCount,
        provenSites: proofs.length,
        goldDisagreementCount: proofs.filter(
          (row) => !row.positiveTargetIds.includes(row.targetId),
        ).length,
        differsFromScopeResolverCount: proofs.filter(
          (row) => row.differsFromScopeResolver,
        ).length,
      };
    }),
  );
  const familyGroups = new Map<string, Phase2CorpusSource[]>();
  for (const row of sourceRows) {
    if (row.split !== "train" && row.split !== "calibration") continue;
    const key = `${row.split}\0${row.repoFamily}`;
    const group = familyGroups.get(key) ?? [];
    group.push(row);
    familyGroups.set(key, group);
  }
  const familyMetrics = [...familyGroups]
    .sort(([left], [right]) => left.localeCompare(right))
    .flatMap(([key, group]) => {
      const [split, repoFamily] = key.split("\0") as [string, string];
      return Q3_RULES.map((ruleSignature) => {
        const proofs = provenSites.filter(
          (row) =>
            row.split === split &&
            row.repoFamily === repoFamily &&
            row.ruleSignature === ruleSignature,
        );
        return {
          split,
          repoFamily,
          ruleSignature,
          sourceRows: group.length,
          provenSites: proofs.length,
          goldDisagreementCount: proofs.filter(
            (row) => !row.positiveTargetIds.includes(row.targetId),
          ).length,
          differsFromScopeResolverCount: proofs.filter(
            (row) => row.differsFromScopeResolver,
          ).length,
        };
      });
    });

  const inputHashes = {
    ...sourceHashes,
    "candidate-prediction-manifest.json": sha256(
      readFileSync(
        path.join(
          PINNED_SOURCE_REPRODUCTION,
          "candidate-prediction-manifest.json",
        ),
      ),
    ),
    "predictions.jsonl": sha256(
      readFileSync(path.join(PINNED_SOURCE_REPRODUCTION, "predictions.jsonl")),
    ),
    "corpus-spec.v1.json": sha256(
      readFileSync(
        path.join(
          repositoryRoot,
          "evaluate/semantic-corpus/corpus-spec.v1.json",
        ),
      ),
    ),
    "collection-report.json": sha256(
      readFileSync(path.join(PHASE2_CORPUS, "collection-report.json")),
    ),
    "train-label-records": splitLabelsHash(trainLabels),
    "calibration-label-records": splitLabelsHash(calibrationLabels),
  };
  const codeHashes = implementationHashes(repositoryRoot);
  const output = {
    schemaVersion: 1,
    measurement: "phase3-q3-receiver-proof/1",
    node: process.version,
    typescript: ts.version,
    sourceRows: sourceRows.length,
    sourceSplitCounts: Object.fromEntries(
      ["train", "calibration", "test", "temporal"].map((split) => [
        split,
        sourceRows.filter((row) => row.split === split).length,
      ]),
    ),
    labelPolicy:
      "Only TRAIN and CALIBRATION labels are parsed; no TEST or TEMPORAL label rows are loaded.",
    candidateGeneratorVersion: CALL_RESOLUTION_CANDIDATE_GENERATOR_VERSION,
    q3RuleSignatures: Q3_RULES,
    q3TargetParsing:
      "Exact parser bytes are loaded from each pinned call-site snapshot; receiver-type module dependencies are recursively parsed and hash-checked within that snapshot.",
    tierBSkipped: false,
    calibrationPromotions: 0,
    sourceInputHashes: inputHashes,
    implementationFileHashes: codeHashes,
    implementationHash: canonicalHash(codeHashes),
    snapshotResults,
    trainCalibration: {
      sourceRows:
        splitIds.get("train")!.size + splitIds.get("calibration")!.size,
      provenSites: provenSites.length,
      byRuleSplit: splitMetrics,
      byRuleSplitFamily: familyMetrics,
      goldDisagreementCount: disagreements.length,
      proofsWithoutGoldTargets: labelsMissingForProof.length,
      proofReasonCounts,
      disagreements,
      provenSites,
    },
  };
  mkdirSync(path.dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  process.stdout.write(
    `${JSON.stringify(
      {
        outputPath,
        artifactSha256: sha256(readFileSync(outputPath)),
        sourceRows: output.sourceRows,
        sourceSplitCounts: output.sourceSplitCounts,
        implementationHash: output.implementationHash,
        trainCalibration: {
          sourceRows: output.trainCalibration.sourceRows,
          byRuleSplit: output.trainCalibration.byRuleSplit,
          goldDisagreementCount: output.trainCalibration.goldDisagreementCount,
          proofsWithoutGoldTargets:
            output.trainCalibration.proofsWithoutGoldTargets,
          proofReasonCounts: output.trainCalibration.proofReasonCounts,
          disagreements: output.trainCalibration.disagreements,
        },
      },
      null,
      2,
    )}\n`,
  );
  if (disagreements.length > 0)
    throw new Error(
      `Q3 has ${disagreements.length} gold-target disagreement(s).`,
    );
}

await main();
