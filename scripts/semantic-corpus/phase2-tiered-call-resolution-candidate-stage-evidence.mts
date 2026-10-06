import { createHash } from "node:crypto";
import type { Phase2EvaluationObservation } from "./phase2-tiered-call-resolution-evaluation.mjs";

export type CandidateTargetMapping =
  | {
      readonly status: "mapped";
      readonly targetId: string;
      readonly reason: null;
    }
  | {
      readonly status: "ambiguous" | "unmapped";
      readonly targetId: null;
      readonly reason: string;
    };

export interface CandidateTargetKeyMapping {
  readonly targetKey: string;
  readonly status: CandidateTargetMapping["status"];
  readonly targetId: string | null;
  readonly reason: string | null;
}

export interface CandidateStageEvidenceInput {
  readonly sampleId: string;
  readonly split: string;
  readonly sourceContentHash: string;
  readonly callSiteInputHash: string;
  readonly generatedCandidateKeys: readonly string[];
  readonly orderedProposalKeys: readonly string[];
}

export interface CandidateStageEvidence {
  readonly schemaVersion: 1;
  readonly measurement: "phase2-p2a-candidate-stage-evidence/1";
  readonly sampleId: string;
  readonly split: "train";
  readonly sourceContentHash: string;
  readonly callSiteInputHash: string;
  readonly generatedCandidateKeys: readonly string[];
  readonly generatedCandidateKeyMappings: readonly CandidateTargetKeyMapping[];
  readonly mappedCandidateTargetIds: readonly string[];
  readonly orderedEvidenceProposals: readonly CandidateTargetKeyMapping[];
  readonly orderedEvidenceProposalTargetIds: readonly (string | null)[];
  readonly mappingSummary: {
    readonly generatedMapped: number;
    readonly generatedAmbiguous: number;
    readonly generatedUnmapped: number;
    readonly proposalMapped: number;
    readonly proposalAmbiguous: number;
    readonly proposalUnmapped: number;
  };
}

export interface CandidateStageSampleIdentity {
  readonly sampleId: string;
  readonly split: string;
}

export function mapCandidateTargetKeys(
  targetKeys: readonly string[],
  resolve: (targetKey: string) => CandidateTargetMapping,
): CandidateTargetKeyMapping[] {
  return targetKeys.map((targetKey) => {
    const mapping = resolve(targetKey);
    if (
      mapping.status === "mapped" &&
      (mapping.targetId.length === 0 || mapping.reason !== null)
    )
      throw new Error(
        "Mapped candidate identity has an invalid target result.",
      );
    if (
      mapping.status !== "mapped" &&
      (mapping.targetId !== null || mapping.reason.length === 0)
    )
      throw new Error("Unmapped candidate identity requires a reason.");
    return {
      targetKey,
      status: mapping.status,
      targetId: mapping.targetId,
      reason: mapping.reason,
    };
  });
}

function mappedIds(mappings: readonly CandidateTargetKeyMapping[]): string[] {
  return [
    ...new Set(
      mappings.flatMap((mapping) =>
        mapping.status === "mapped" && mapping.targetId !== null
          ? [mapping.targetId]
          : [],
      ),
    ),
  ].sort();
}

function mappingCount(
  mappings: readonly CandidateTargetKeyMapping[],
  status: CandidateTargetMapping["status"],
): number {
  return mappings.filter((mapping) => mapping.status === status).length;
}

function assertSha256(value: string): void {
  if (!/^[a-f0-9]{64}$/u.test(value))
    throw new Error("Candidate-stage evidence requires SHA-256 source hashes.");
}

export function createCandidateStageEvidence(
  input: CandidateStageEvidenceInput,
  resolve: (targetKey: string) => CandidateTargetMapping,
): CandidateStageEvidence {
  if (input.split !== "train")
    throw new Error("Candidate-stage evidence only accepts TRAIN rows.");
  assertSha256(input.sourceContentHash);
  assertSha256(input.callSiteInputHash);
  if (!input.sampleId)
    throw new Error("Candidate-stage evidence requires a sample ID.");

  const generatedCandidateKeyMappings = mapCandidateTargetKeys(
    input.generatedCandidateKeys,
    resolve,
  );
  const orderedEvidenceProposals = mapCandidateTargetKeys(
    input.orderedProposalKeys,
    resolve,
  );
  return {
    schemaVersion: 1,
    measurement: "phase2-p2a-candidate-stage-evidence/1",
    sampleId: input.sampleId,
    split: "train",
    sourceContentHash: input.sourceContentHash,
    callSiteInputHash: input.callSiteInputHash,
    generatedCandidateKeys: [...input.generatedCandidateKeys],
    generatedCandidateKeyMappings,
    mappedCandidateTargetIds: mappedIds(generatedCandidateKeyMappings),
    orderedEvidenceProposals,
    orderedEvidenceProposalTargetIds: orderedEvidenceProposals.map(
      (proposal) => proposal.targetId,
    ),
    mappingSummary: {
      generatedMapped: mappingCount(generatedCandidateKeyMappings, "mapped"),
      generatedAmbiguous: mappingCount(
        generatedCandidateKeyMappings,
        "ambiguous",
      ),
      generatedUnmapped: mappingCount(
        generatedCandidateKeyMappings,
        "unmapped",
      ),
      proposalMapped: mappingCount(orderedEvidenceProposals, "mapped"),
      proposalAmbiguous: mappingCount(orderedEvidenceProposals, "ambiguous"),
      proposalUnmapped: mappingCount(orderedEvidenceProposals, "unmapped"),
    },
  };
}

export function assertCandidateStageTrainScope(
  expectedTrainRows: readonly CandidateStageSampleIdentity[],
  actualRows: readonly CandidateStageSampleIdentity[],
): void {
  const expectedIds = expectedTrainRows.map((row) => row.sampleId);
  const actualIds = actualRows.map((row) => row.sampleId);
  if (
    expectedTrainRows.some((row) => row.split !== "train") ||
    actualRows.some((row) => row.split !== "train")
  )
    throw new Error("Candidate-stage replay may contain TRAIN rows only.");
  const expectedIdSet = new Set(expectedIds);
  const actualIdSet = new Set(actualIds);
  if (
    expectedIdSet.size !== expectedIds.length ||
    actualIdSet.size !== actualIds.length ||
    expectedIds.length !== actualIds.length ||
    expectedIds.some((sampleId) => !actualIdSet.has(sampleId))
  )
    throw new Error(
      "Candidate-stage replay must cover every expected TRAIN sample exactly once.",
    );
}

const V4_DECISION_FIELDS = [
  "sampleId",
  "split",
  "duplicateGroup",
  "repoFamily",
  "snapshotId",
  "repoId",
  "calleeKind",
  "ruleSignature",
  "candidateTargetIds",
  "topTargetId",
  "topRankScore",
  "tied",
  "candidateSetComplete",
  "truncated",
  "unsupportedCallShape",
  "generatedCandidateCount",
  "ambiguousCandidateMappingCount",
  "unmappedGeneratedCandidateCount",
  "proposedCandidateCount",
  "reason",
] as const satisfies readonly (keyof Phase2EvaluationObservation)[];

function decisionFields(
  observation: Phase2EvaluationObservation,
): readonly unknown[] {
  return V4_DECISION_FIELDS.map((field) => observation[field]);
}

export function assertV4ObservationDecisionEquivalent(
  pinned: Phase2EvaluationObservation,
  replayed: Phase2EvaluationObservation,
): void {
  if (
    candidateObservationDecisionFingerprint(pinned) !==
    candidateObservationDecisionFingerprint(replayed)
  )
    throw new Error("TRAIN source replay changed a pinned v4 decision field.");
}

export function candidateObservationDecisionFingerprint(
  observation: Phase2EvaluationObservation,
): string {
  return createHash("sha256")
    .update(JSON.stringify(decisionFields(observation)))
    .digest("hex");
}
