import {
  mapCandidateTargetKeys,
  type CandidateTargetKeyMapping,
  type CandidateTargetMapping,
} from "./phase2-tiered-call-resolution-candidate-stage-evidence.mjs";

export const PROPOSAL_FILTER_STAGES = [
  "beforeVisibility",
  "afterVisibility",
  "afterExplicitReceiverType",
  "afterPeerMembers",
  "afterArgumentShape",
  "beforeMaxCandidates",
  "afterMaxCandidates",
] as const;

export type ProposalFilterStageName = (typeof PROPOSAL_FILTER_STAGES)[number];

export type ProposalFilterStageCandidateKeys = Readonly<
  Record<ProposalFilterStageName, readonly string[]>
>;

export interface ProposalFilterStageEvidenceInput {
  readonly sampleId: string;
  readonly split: string;
  readonly sourceContentHash: string;
  readonly callSiteInputHash: string;
  readonly candidateKeysByStage: ProposalFilterStageCandidateKeys;
}

export interface ProposalFilterStageEvidenceRow {
  readonly stage: ProposalFilterStageName;
  /** Exact target-key sequence entering/leaving this stage. */
  readonly candidateKeys: readonly string[];
  /** Per-key oracle mapping in the same sequence; nulls retain ambiguity/unmapped status. */
  readonly targetMappings: readonly CandidateTargetKeyMapping[];
  /** Per-key IDs in proposal order, with null for ambiguous or unmapped keys. */
  readonly targetIdsInOrder: readonly (string | null)[];
  /** Unique mapped IDs used as the candidate set for recall and set-size metrics. */
  readonly uniqueMappedTargetIds: readonly string[];
  readonly mappingCounts: {
    readonly candidateKeyCount: number;
    readonly mappedKeyCount: number;
    readonly ambiguousKeyCount: number;
    readonly unmappedKeyCount: number;
    readonly uniqueMappedTargetCount: number;
  };
}

export interface ProposalFilterStageEvidence {
  readonly schemaVersion: 1;
  readonly measurement: "phase2-p2a-proposal-filter-stage-evidence/1";
  readonly sampleId: string;
  readonly split: "train";
  readonly sourceContentHash: string;
  readonly callSiteInputHash: string;
  readonly stages: readonly ProposalFilterStageEvidenceRow[];
}

function assertSha256(value: string): void {
  if (!/^[a-f0-9]{64}$/u.test(value))
    throw new Error("Proposal filter evidence requires SHA-256 hashes.");
}

function mapStage(
  stage: ProposalFilterStageName,
  candidateKeys: readonly string[],
  resolve: (targetKey: string) => CandidateTargetMapping,
): ProposalFilterStageEvidenceRow {
  const targetMappings = mapCandidateTargetKeys(candidateKeys, resolve);
  const uniqueMappedTargetIds = [
    ...new Set(
      targetMappings.flatMap((mapping) =>
        mapping.status === "mapped" && mapping.targetId !== null
          ? [mapping.targetId]
          : [],
      ),
    ),
  ].sort();
  return {
    stage,
    candidateKeys: [...candidateKeys],
    targetMappings,
    targetIdsInOrder: targetMappings.map((mapping) => mapping.targetId),
    uniqueMappedTargetIds,
    mappingCounts: {
      candidateKeyCount: candidateKeys.length,
      mappedKeyCount: targetMappings.filter(
        (mapping) => mapping.status === "mapped",
      ).length,
      ambiguousKeyCount: targetMappings.filter(
        (mapping) => mapping.status === "ambiguous",
      ).length,
      unmappedKeyCount: targetMappings.filter(
        (mapping) => mapping.status === "unmapped",
      ).length,
      uniqueMappedTargetCount: uniqueMappedTargetIds.length,
    },
  };
}

export function createProposalFilterStageEvidence(
  input: ProposalFilterStageEvidenceInput,
  resolve: (targetKey: string) => CandidateTargetMapping,
): ProposalFilterStageEvidence {
  if (input.split !== "train")
    throw new Error("Proposal filter evidence only accepts TRAIN rows.");
  if (!input.sampleId)
    throw new Error("Proposal filter evidence requires a sample ID.");
  assertSha256(input.sourceContentHash);
  assertSha256(input.callSiteInputHash);
  const stages = PROPOSAL_FILTER_STAGES.map((stage) =>
    mapStage(stage, input.candidateKeysByStage[stage], resolve),
  );
  if (
    JSON.stringify(
      stages.find(({ stage }) => stage === "afterArgumentShape")?.candidateKeys,
    ) !==
    JSON.stringify(
      stages.find(({ stage }) => stage === "beforeMaxCandidates")
        ?.candidateKeys,
    )
  )
    throw new Error(
      "Candidate list immediately before maxCandidates must equal the final filter output.",
    );
  return {
    schemaVersion: 1,
    measurement: "phase2-p2a-proposal-filter-stage-evidence/1",
    sampleId: input.sampleId,
    split: "train",
    sourceContentHash: input.sourceContentHash,
    callSiteInputHash: input.callSiteInputHash,
    stages,
  };
}
