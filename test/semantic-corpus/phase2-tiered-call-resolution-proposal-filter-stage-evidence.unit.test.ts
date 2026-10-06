import { describe, expect, it } from "vitest";
import {
  createProposalFilterStageEvidence,
  PROPOSAL_FILTER_STAGES,
  type ProposalFilterStageEvidenceInput,
} from "../../scripts/semantic-corpus/phase2-tiered-call-resolution-proposal-filter-stage-evidence.mjs";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

function evidenceInput(
  overrides: Partial<ProposalFilterStageEvidenceInput> = {},
): ProposalFilterStageEvidenceInput {
  return {
    sampleId: "repo@revision::src/caller.ts:2:4",
    split: "train",
    sourceContentHash: HASH_A,
    callSiteInputHash: HASH_B,
    candidateKeysByStage: {
      beforeVisibility: ["target-a", "ambiguous", "unmapped"],
      afterVisibility: ["target-a", "ambiguous"],
      afterExplicitReceiverType: ["target-a", "ambiguous"],
      afterPeerMembers: ["target-a"],
      afterArgumentShape: ["target-a"],
      beforeMaxCandidates: ["target-a"],
      afterMaxCandidates: ["target-a"],
    },
    ...overrides,
  };
}

describe("P2-A proposal filter stage evidence", () => {
  it("[happy][state-diff] preserves exact stage order, candidate keys, and mapped IDs", () => {
    const evidence = createProposalFilterStageEvidence(
      evidenceInput(),
      (key) => {
        if (key === "target-a")
          return { status: "mapped", targetId: "src/a.ts#open", reason: null };
        if (key === "ambiguous")
          return {
            status: "ambiguous",
            targetId: null,
            reason: "duplicate-source-alias",
          };
        return {
          status: "unmapped",
          targetId: null,
          reason: "target-key-not-in-pinned-facts",
        };
      },
    );

    expect(evidence.measurement).toBe(
      "phase2-p2a-proposal-filter-stage-evidence/1",
    );
    expect(evidence.stages.map(({ stage }) => stage)).toEqual(
      PROPOSAL_FILTER_STAGES,
    );
    expect(evidence.stages[0]).toMatchObject({
      candidateKeys: ["target-a", "ambiguous", "unmapped"],
      targetIdsInOrder: ["src/a.ts#open", null, null],
      uniqueMappedTargetIds: ["src/a.ts#open"],
      mappingCounts: {
        candidateKeyCount: 3,
        mappedKeyCount: 1,
        ambiguousKeyCount: 1,
        unmappedKeyCount: 1,
        uniqueMappedTargetCount: 1,
      },
    });
    expect(evidence.stages[3]?.candidateKeys).toEqual(["target-a"]);
    expect(evidence.stages[6]?.candidateKeys).toEqual(["target-a"]);
  });

  it("[invalid-input][error-handling] rejects non-TRAIN scope, invalid hashes, and divergent cap input", () => {
    const resolve = () => ({
      status: "mapped" as const,
      targetId: "src/a.ts#open",
      reason: null,
    });
    expect(() =>
      createProposalFilterStageEvidence(
        evidenceInput({ split: "test" }),
        resolve,
      ),
    ).toThrow("Proposal filter evidence only accepts TRAIN rows.");
    expect(() =>
      createProposalFilterStageEvidence(
        evidenceInput({ sourceContentHash: "invalid" }),
        resolve,
      ),
    ).toThrow("Proposal filter evidence requires SHA-256 hashes.");
    expect(() =>
      createProposalFilterStageEvidence(
        evidenceInput({
          candidateKeysByStage: {
            ...evidenceInput().candidateKeysByStage,
            beforeMaxCandidates: [],
          },
        }),
        resolve,
      ),
    ).toThrow(
      "Candidate list immediately before maxCandidates must equal the final filter output.",
    );
  });
});
