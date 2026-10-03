import { describe, expect, it } from "vitest";
import {
  buildCalibrationRecords,
  calibrationSourceSidecarHashes,
  evaluatePhase2Split,
  type Phase2EvaluationLabel,
  type Phase2EvaluationObservation,
} from "../../scripts/semantic-corpus/phase2-tiered-call-resolution-evaluation.mjs";

function observation(
  sampleId: string,
  duplicateGroup: string,
  overrides: Partial<Phase2EvaluationObservation> = {},
): Phase2EvaluationObservation {
  return {
    sampleId,
    split: "calibration",
    duplicateGroup,
    repoFamily: "family-a",
    ruleSignature: "a".repeat(64),
    candidateTargetIds: ["src/target.ts#run"],
    topTargetId: "src/target.ts#run",
    topRankScore: 100,
    tied: false,
    candidateSetComplete: true,
    truncated: false,
    unsupportedCallShape: false,
    ...overrides,
  };
}

function label(
  sampleId: string,
  overrides: Partial<Phase2EvaluationLabel> = {},
): Phase2EvaluationLabel {
  return {
    sampleId,
    split: "calibration",
    duplicateGroup: sampleId,
    repoFamily: "family-a",
    positiveTargetIds: ["src/target.ts#run"],
    reviewStatus: "confirmed",
    ...overrides,
  };
}

function records(
  observations: readonly Phase2EvaluationObservation[],
  labels: readonly Phase2EvaluationLabel[],
) {
  return buildCalibrationRecords(observations, labels, {
    configurationHash: "b".repeat(64),
    calibrationInputFingerprint: "c".repeat(64),
    minimumIndependentGroups: 100,
    minimumConfidenceLowerBound: 0.9,
    targetFamilyMacroTop1: 0.9,
  });
}

describe("Phase 2 call-resolution evaluation", () => {
  it("[happy] counts independent duplicate groups rather than rows as calibration support", () => {
    const observations = Array.from({ length: 150 }, (_, index) =>
      observation(`sample-${index}`, `group-${index % 99}`),
    );
    const labels = observations.map(({ sampleId, duplicateGroup }) =>
      label(sampleId, { duplicateGroup }),
    );

    expect(records(observations, labels).records).toHaveLength(0);
  });

  it("[error-handling] abstains without calling the binomial bound for zero accepted groups", () => {
    const result = records(
      [
        observation("unsupported", "group-unsupported", {
          unsupportedCallShape: true,
        }),
      ],
      [label("unsupported", { duplicateGroup: "group-unsupported" })],
    );

    expect(result.records).toHaveLength(0);
    expect(result.signatures[0]?.reason).toBe(
      "insufficient-independent-groups",
    );
  });

  it("[happy] does not calibrate rows that production rejects as incomplete", () => {
    const result = records(
      [
        observation("incomplete", "group-incomplete", {
          candidateSetComplete: false,
        }),
      ],
      [label("incomplete", { duplicateGroup: "group-incomplete" })],
    );

    expect(result.signatures[0]).toMatchObject({
      independentGroupCount: 0,
      acceptedSiteCount: 0,
      reason: "insufficient-independent-groups",
    });
  });

  it("[error-handling] fails a duplicate group if its observations disagree", () => {
    const observations = Array.from({ length: 100 }, (_, index) =>
      observation(`sample-${index}`, `group-${index}`),
    );
    observations.push(
      observation("duplicate-error", "group-0", {
        topTargetId: "src/wrong.ts#run",
        candidateTargetIds: ["src/wrong.ts#run"],
      }),
    );
    const labels = observations.map(({ sampleId, duplicateGroup }) =>
      label(sampleId, { duplicateGroup }),
    );

    const result = records(observations, labels);
    expect(result.records).toHaveLength(1);
    expect(result.records[0]).toMatchObject({
      independentGroupCount: 100,
      correctGroupCount: 99,
    });
  });

  it("[invalid-input] fails a duplicate group when confirmed target labels conflict", () => {
    const observations = Array.from({ length: 102 }, (_, index) =>
      observation(`sample-${index}`, `group-${index}`),
    );
    observations.push(
      observation("sample-conflict", "group-0", {
        topTargetId: "src/other.ts#run",
        candidateTargetIds: ["src/other.ts#run"],
      }),
    );
    const labels = observations.map(({ sampleId, duplicateGroup }) =>
      label(sampleId, {
        duplicateGroup,
        ...(sampleId === "sample-conflict"
          ? { positiveTargetIds: ["src/other.ts#run"] }
          : {}),
      }),
    );

    const result = records(observations, labels);

    expect(result.records).toHaveLength(1);
    expect(result.records[0]).toMatchObject({
      independentGroupCount: 102,
      correctGroupCount: 101,
    });
  });

  it("[happy] requires end-to-end per-family top-1, counting abstentions and misses in the denominator", () => {
    const observations: Phase2EvaluationObservation[] = [];
    const labels: Phase2EvaluationLabel[] = [];
    for (let index = 0; index < 990; index++) {
      const sampleId = `good-${index}`;
      observations.push(observation(sampleId, `group-good-${index}`));
      labels.push(label(sampleId, { duplicateGroup: `group-good-${index}` }));
    }
    for (let index = 0; index < 10; index++) {
      const sampleId = `weak-${index}`;
      const group = `group-weak-${index}`;
      observations.push(
        observation(sampleId, group, {
          repoFamily: "family-b",
          topRankScore: 99,
          topTargetId: "src/wrong.ts#run",
        }),
      );
      labels.push(
        label(sampleId, {
          repoFamily: "family-b",
          duplicateGroup: group,
        }),
      );
    }

    const result = records(observations, labels);
    expect(result.records).toHaveLength(0);
    expect(result.signatures[0]?.familyMacroTop1).toBe(0.5);
  });

  it("[happy] reports raw recall and calibrated end-to-end top-1 over all eligible sites", () => {
    const observations = [
      observation("selected", "group-selected", {
        split: "test",
        candidateSetComplete: true,
      }),
      observation("blocked", "group-blocked", {
        split: "test",
        topTargetId: null,
        candidateTargetIds: [],
        candidateSetComplete: false,
      }),
    ];
    const labels = observations.map(({ sampleId, duplicateGroup }) =>
      label(sampleId, { split: "test", duplicateGroup }),
    );
    const calibrationRows = Array.from({ length: 100 }, (_, index) => {
      const sampleId = `cal-${index}`;
      const duplicateGroup = `group-cal-${index}`;
      return {
        observation: observation(sampleId, duplicateGroup),
        label: label(sampleId, { duplicateGroup }),
      };
    });
    const calibration = records(
      calibrationRows.map(({ observation: row }) => row),
      calibrationRows.map(({ label: row }) => row),
    );

    const metrics = evaluatePhase2Split(
      observations,
      labels,
      calibration.records,
    );
    expect(metrics).toMatchObject({
      eligibleSiteCount: 2,
      candidateRecall: 0.5,
      rawRankTop1: 0.5,
      calibratedCoverage: 0.5,
      calibratedEndToEndTop1: 0.5,
    });
  });

  it("[invalid-input] rejects labels outside the calibration split when building thresholds", () => {
    expect(() =>
      records(
        [observation("sample", "group")],
        [label("sample", { split: "test" })],
      ),
    ).toThrow(/calibration split/);
  });

  it("[error-handling] keeps held-out label and evaluation sidecar hashes out of calibration inputs", () => {
    expect(
      calibrationSourceSidecarHashes({
        "callsites.jsonl": "source-hash",
        "declared-type-facts-pass-a.jsonl": "facts-hash",
        "labels.jsonl": "all-splits-label-hash",
        "partial-semantic-evaluation.jsonl": "held-out-evaluation-hash",
        "scope-resolver-baseline.jsonl": "baseline-hash",
      }),
    ).toEqual({
      "callsites.jsonl": "source-hash",
      "declared-type-facts-pass-a.jsonl": "facts-hash",
    });
  });
});
