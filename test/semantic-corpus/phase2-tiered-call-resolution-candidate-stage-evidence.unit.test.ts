import { describe, expect, it } from "vitest";
import {
  assertCandidateStageTrainScope,
  assertV4ObservationDecisionEquivalent,
  createCandidateStageEvidence,
  mapCandidateTargetKeys,
} from "../../scripts/semantic-corpus/phase2-tiered-call-resolution-candidate-stage-evidence.mjs";
import type { Phase2EvaluationObservation } from "../../scripts/semantic-corpus/phase2-tiered-call-resolution-evaluation.mjs";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

function observation(
  overrides: Partial<Phase2EvaluationObservation> = {},
): Phase2EvaluationObservation {
  return {
    sampleId: "repo@revision::src/caller.ts:2:4",
    split: "train",
    duplicateGroup: "group-a",
    repoFamily: "org/repo",
    snapshotId: "snapshot-a",
    repoId: "org/repo",
    calleeKind: "bare",
    ruleSignature: "rule-a",
    candidateTargetIds: ["src/target.ts#run"],
    topTargetId: "src/target.ts#run",
    topRankScore: 12,
    tied: false,
    candidateSetComplete: false,
    truncated: false,
    unsupportedCallShape: false,
    generatedCandidateCount: 2,
    ambiguousCandidateMappingCount: 1,
    unmappedGeneratedCandidateCount: 0,
    proposedCandidateCount: 1,
    reason: "uncalibrated-signature",
    ...overrides,
  };
}

describe("P2-A candidate-stage evidence", () => {
  it("[happy][state-diff] keeps raw keys, mapped IDs, and ordered proposals distinct", () => {
    const resolve = (key: string) => {
      if (key === "target-key-1")
        return {
          status: "mapped" as const,
          targetId: "src/target.ts#run",
          reason: null,
        };
      if (key === "target-key-ambiguous")
        return {
          status: "ambiguous" as const,
          targetId: null,
          reason: "duplicate-source-alias",
        };
      return {
        status: "unmapped" as const,
        targetId: null,
        reason: "target-key-not-in-pinned-facts",
      };
    };

    const rawMappings = mapCandidateTargetKeys(
      ["target-key-1", "target-key-ambiguous", "missing-key"],
      resolve,
    );
    const evidence = createCandidateStageEvidence(
      {
        sampleId: "repo@revision::src/caller.ts:2:4",
        split: "train",
        sourceContentHash: HASH_A,
        callSiteInputHash: HASH_B,
        generatedCandidateKeys: [
          "target-key-1",
          "target-key-ambiguous",
          "missing-key",
        ],
        orderedProposalKeys: ["missing-key", "target-key-1"],
      },
      resolve,
    );

    expect(rawMappings).toEqual(evidence.generatedCandidateKeyMappings);
    expect(evidence.generatedCandidateKeys).toEqual([
      "target-key-1",
      "target-key-ambiguous",
      "missing-key",
    ]);
    expect(evidence.mappedCandidateTargetIds).toEqual(["src/target.ts#run"]);
    expect(
      evidence.orderedEvidenceProposals.map((row) => row.targetKey),
    ).toEqual(["missing-key", "target-key-1"]);
    expect(evidence.orderedEvidenceProposalTargetIds).toEqual([
      null,
      "src/target.ts#run",
    ]);
    expect(evidence.mappingSummary).toEqual({
      generatedMapped: 1,
      generatedAmbiguous: 1,
      generatedUnmapped: 1,
      proposalMapped: 1,
      proposalAmbiguous: 0,
      proposalUnmapped: 1,
    });

    const orderedIds = createCandidateStageEvidence(
      {
        sampleId: "repo@revision::src/ordered.ts:2:4",
        split: "train",
        sourceContentHash: HASH_A,
        callSiteInputHash: HASH_B,
        generatedCandidateKeys: ["lower", "upper"],
        orderedProposalKeys: [],
      },
      (key) => ({
        status: "mapped",
        targetId: key === "lower" ? "z-target" : "A-target",
        reason: null,
      }),
    );
    expect(orderedIds.mappedCandidateTargetIds).toEqual([
      "A-target",
      "z-target",
    ]);
  });

  it("[invalid-input][error-handling] rejects call-stage provenance outside TRAIN or without hashes", () => {
    const input = {
      sampleId: "repo@revision::src/caller.ts:2:4",
      split: "test",
      sourceContentHash: HASH_A,
      callSiteInputHash: HASH_B,
      generatedCandidateKeys: ["target-key-1"],
      orderedProposalKeys: ["target-key-1"],
    };
    const resolve = () => ({
      status: "mapped" as const,
      targetId: "src/target.ts#run",
      reason: null,
    });

    expect(() => createCandidateStageEvidence(input, resolve)).toThrow(
      "Candidate-stage evidence only accepts TRAIN rows.",
    );
    expect(() =>
      createCandidateStageEvidence(
        { ...input, split: "train", callSiteInputHash: "bad-hash" },
        resolve,
      ),
    ).toThrow("Candidate-stage evidence requires SHA-256 source hashes.");
  });

  it("[invalid-input][error-handling] rejects non-TRAIN rows and missing IDs in the replay scope", () => {
    const train = observation();
    expect(() =>
      assertCandidateStageTrainScope([train], [train]),
    ).not.toThrow();
    expect(() =>
      assertCandidateStageTrainScope(
        [train],
        [observation({ split: "calibration" })],
      ),
    ).toThrow("Candidate-stage replay may contain TRAIN rows only.");
    expect(() => assertCandidateStageTrainScope([train], [])).toThrow(
      "Candidate-stage replay must cover every expected TRAIN sample exactly once.",
    );
    expect(() =>
      assertCandidateStageTrainScope(
        [train, observation({ sampleId: "train-row-2" })],
        [observation({ sampleId: "train-row-2" }), train],
      ),
    ).not.toThrow();
    expect(() =>
      assertCandidateStageTrainScope(
        [train, observation({ sampleId: "train-row-2" })],
        [train, train],
      ),
    ).toThrow(
      "Candidate-stage replay must cover every expected TRAIN sample exactly once.",
    );
  });

  it("[state-diff][error-handling] verifies every pinned v4 decision field and rejects a changed winner", () => {
    const pinned = observation();
    expect(() =>
      assertV4ObservationDecisionEquivalent(pinned, pinned),
    ).not.toThrow();
    expect(() =>
      assertV4ObservationDecisionEquivalent(
        pinned,
        observation({ topTargetId: "src/other.ts#run" }),
      ),
    ).toThrow("TRAIN source replay changed a pinned v4 decision field.");
  });
});
