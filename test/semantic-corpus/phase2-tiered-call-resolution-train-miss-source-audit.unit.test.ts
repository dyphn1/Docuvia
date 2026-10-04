import { describe, expect, it } from "vitest";
import {
  assertTrainMissAuditScope,
  classifyRawMissEvidence,
  measureTrainCapSensitivity,
} from "../../scripts/semantic-corpus/phase2-tiered-call-resolution-train-miss-source-audit.mjs";

describe("TRAIN miss source audit", () => {
  it("[invalid-input][error-handling] rejects non-TRAIN rows and replay label access", () => {
    const manifest = {
      split: "train",
      labelsRead: false,
      labelSplitsRead: [],
      decisions: { allEquivalent: true },
    };
    expect(() =>
      assertTrainMissAuditScope(manifest, [{ split: "test" }]),
    ).toThrow("TRAIN-only");
    expect(() =>
      assertTrainMissAuditScope({ ...manifest, labelsRead: true }, [
        { split: "train" },
      ]),
    ).toThrow("TRAIN-only");
    expect(() =>
      assertTrainMissAuditScope(
        { ...manifest, labelSplitsRead: ["calibration"] },
        [{ split: "train" }],
      ),
    ).toThrow("TRAIN-only");
  });

  it("[happy] identifies excluded positions despite an exact parser fact", () => {
    expect(
      classifyRawMissEvidence("excluded", "no-call-at-position", 1),
    ).toEqual({
      classification: "source-position-exclusion",
      reason: "source-position-excluded-despite-parser-fact",
      provenUnsupportedSyntax: false,
    });
  });

  it("[invalid-input][error-handling] refuses unsupported-syntax inference without exact evidence", () => {
    expect(() =>
      classifyRawMissEvidence("excluded", "no-call-at-position", 0),
    ).toThrow("Expected one exact parser fact");
    expect(() => classifyRawMissEvidence("unique", undefined, 1)).toThrow(
      "Expected excluded source position",
    );
  });

  it("[boundary] counts capped keys separately from unique mapped memberships", () => {
    const rows = [
      {
        split: "train",
        orderedTargetIds: [null, "a", "a", "gold"],
        goldTargetIds: ["gold"],
      },
      { split: "train", orderedTargetIds: [], goldTargetIds: ["other"] },
    ];
    expect(measureTrainCapSensitivity(rows, [2, 4])).toEqual([
      {
        cap: 2,
        coveredGoldTargetOccurrences: 0,
        goldTargetOccurrences: 2,
        candidateRecall: 0,
        proposalKeyMemberships: 2,
        uniqueMappedMemberships: 1,
        proposalKeySize: {
          p50: 0,
          p95: 2,
          max: 2,
          frequency: { "0": 1, "2": 1 },
        },
        uniqueMappedSize: {
          p50: 0,
          p95: 1,
          max: 1,
          frequency: { "0": 1, "1": 1 },
        },
        addedProposalKeyMemberships: 0,
        addedUniqueMappedMemberships: 0,
      },
      {
        cap: 4,
        coveredGoldTargetOccurrences: 1,
        goldTargetOccurrences: 2,
        candidateRecall: 0.5,
        proposalKeyMemberships: 4,
        uniqueMappedMemberships: 2,
        proposalKeySize: {
          p50: 0,
          p95: 4,
          max: 4,
          frequency: { "0": 1, "4": 1 },
        },
        uniqueMappedSize: {
          p50: 0,
          p95: 2,
          max: 2,
          frequency: { "0": 1, "2": 1 },
        },
        addedProposalKeyMemberships: 2,
        addedUniqueMappedMemberships: 1,
      },
    ]);
    expect(() =>
      measureTrainCapSensitivity([{ ...rows[0]!, split: "test" }], [25]),
    ).toThrow("TRAIN-only");
  });
});
