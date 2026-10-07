import { describe, expect, it } from "vitest";
import {
  evaluateSystemOneCalibrationQualityOof,
  assignDuplicateGroupFolds,
  reliabilityBinForProbability,
} from "../../scripts/semantic-corpus/phase2-tiered-call-resolution-system1-confidence-calibration.mjs";
import type {
  Phase2EvaluationLabel,
  Phase2EvaluationObservation,
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
    calleeKind: "bare",
    ruleSignature: "rule-v4",
    candidateTargetIds: ["src/target.ts#run"],
    topTargetId: "src/target.ts#run",
    topRankScore: 10,
    tied: false,
    candidateSetComplete: false,
    truncated: false,
    unsupportedCallShape: false,
    ...overrides,
  };
}

function label(
  sampleId: string,
  duplicateGroup: string,
  overrides: Partial<Phase2EvaluationLabel> = {},
): Phase2EvaluationLabel {
  return {
    sampleId,
    split: "calibration",
    duplicateGroup,
    repoFamily: "family-a",
    positiveTargetIds: ["src/target.ts#run"],
    reviewStatus: "confirmed",
    ...overrides,
  };
}

const aliases = new Set(["src/target.ts#run", "src/wrong.ts#run"]);

describe("P2-B duplicate-group cross-fitted confidence calibration", () => {
  it("[happy][state-diff] defines half-open bins and includes probability one in the final bin", () => {
    expect(reliabilityBinForProbability(0.249999, 4)).toEqual({
      binIndex: 0,
      lowerInclusive: 0,
      upperBound: 0.25,
      upperBoundInclusive: false,
    });
    expect(reliabilityBinForProbability(0.25, 4)).toEqual({
      binIndex: 1,
      lowerInclusive: 0.25,
      upperBound: 0.5,
      upperBoundInclusive: false,
    });
    expect(reliabilityBinForProbability(1, 4)).toEqual({
      binIndex: 3,
      lowerInclusive: 0.75,
      upperBound: 1,
      upperBoundInclusive: true,
    });
  });

  it("[state-diff][error-handling] excludes every held duplicate group from its fold fit and threshold", () => {
    const observations = [
      observation("a", "group-a", { topRankScore: 10 }),
      observation("a-peer", "group-a", { topRankScore: 10 }),
      observation("b", "group-b", { topRankScore: 10 }),
      observation("c", "group-c", { topRankScore: 10 }),
      observation("c-tied", "group-c", { topRankScore: 10, tied: true }),
      observation("d", "group-d", { topRankScore: 20 }),
      observation("d-unsupported", "group-d", {
        topRankScore: 20,
        unsupportedCallShape: true,
      }),
      observation("e", "group-e", { topRankScore: 20 }),
      observation("f", "group-f", { topRankScore: 20 }),
    ];
    const labels = observations.map(({ sampleId, duplicateGroup }) =>
      label(sampleId, duplicateGroup),
    );
    const baseline = evaluateSystemOneCalibrationQualityOof(
      observations,
      labels,
      aliases,
      { foldCount: 3, binCount: 4 },
    );
    const heldGroup = "group-c";
    const changedLabels = labels.map((row) =>
      row.duplicateGroup === heldGroup
        ? { ...row, positiveTargetIds: ["src/wrong.ts#run"] }
        : row,
    );
    const changed = evaluateSystemOneCalibrationQualityOof(
      observations,
      changedLabels,
      aliases,
      { foldCount: 3, binCount: 4 },
    );
    const assignments = assignDuplicateGroupFolds(
      observations.map(({ duplicateGroup }) => duplicateGroup),
      3,
    );
    const foldIndex = assignments.get(heldGroup)!;
    const heldOutDuplicateGroupCount = [...assignments.values()].filter(
      (assignedFold) => assignedFold === foldIndex,
    ).length;
    const before = baseline.folds.find((fold) => fold.foldIndex === foldIndex)!;
    const after = changed.folds.find((fold) => fold.foldIndex === foldIndex)!;

    expect(before.heldOutDuplicateGroupCount).toBe(heldOutDuplicateGroupCount);
    expect(
      before.trainingDuplicateGroupCount + before.heldOutDuplicateGroupCount,
    ).toBe(6);
    expect(before.trainingSelectedSiteCount).toBe(5);
    expect(after.thresholdScore).toBe(before.thresholdScore);
    expect(after.calibratorFitHash).toBe(before.calibratorFitHash);
    expect(after.trainingLabelRowsHash).toBe(before.trainingLabelRowsHash);
    expect(after.callShapeCalibrators).toEqual(before.callShapeCalibrators);
    expect(before.callShapeCalibrators).toMatchObject([
      {
        callShape: "bare",
        status: "unsupported",
      },
    ]);
    expect(before.callShapeCalibrators[0]!.reason).toContain(
      "insufficient-training-duplicate-groups",
    );
    expect(assignments.get(heldGroup)).toBe(foldIndex);
  });

  it("[happy][state-diff] scores selected outputs only while abstentions remain in site coverage", () => {
    const observations: Phase2EvaluationObservation[] = [];
    const labels: Phase2EvaluationLabel[] = [];
    for (let index = 0; index < 24; index++) {
      const sampleId = `correct-${index}`;
      const duplicateGroup = `group-correct-${index}`;
      observations.push(observation(sampleId, duplicateGroup));
      labels.push(label(sampleId, duplicateGroup));
    }
    observations.push(
      observation("tie", "group-tie", { tied: true }),
      observation("tie-peer", "group-tie"),
      observation("unsupported", "group-unsupported", {
        unsupportedCallShape: true,
      }),
      observation("unsupported-peer", "group-unsupported"),
      observation("unscorable", "group-unscorable"),
      observation("unscorable-tie", "group-unscorable", { tied: true }),
    );
    labels.push(
      label("tie", "group-tie"),
      label("tie-peer", "group-tie"),
      label("unsupported", "group-unsupported"),
      label("unsupported-peer", "group-unsupported"),
      label("unscorable", "group-unscorable", {
        positiveTargetIds: ["src/not-indexed.ts#run"],
      }),
      label("unscorable-tie", "group-unscorable", {
        positiveTargetIds: ["src/not-indexed.ts#run"],
      }),
    );

    const result = evaluateSystemOneCalibrationQualityOof(
      observations,
      labels,
      aliases,
      { foldCount: 2, binCount: 4 },
    );

    expect(result).toMatchObject({
      schemaVersion: 4,
      measurement: "phase2-p2b-system1-calibration-quality-oof/4",
      targetAcceptedPrecision: 0.9,
      targetDuplicateGroupPrecision: 0.9,
    });
    expect(result).toMatchObject({
      eligibleSiteCount: 30,
      eligibleDuplicateGroupCount: 27,
      selectedSiteCount: 27,
      selectedScorableSiteCount: 26,
      selectedUnscorableSiteCount: 1,
      abstentionCount: 3,
      coverage: 27 / 30,
      siteWeighted: { siteCount: 27, duplicateGroupCount: 27 },
      scorableOnlySiteWeighted: { siteCount: 26, duplicateGroupCount: 26 },
    });
    expect(result.siteWeighted.brierScore).not.toBeNull();
    expect(result.siteWeighted.expectedCalibrationError).not.toBeNull();
    expect(result.scorableOnlySiteWeighted.brierScore).not.toBeNull();
  });

  it("[invalid-input][error-handling] emits empty bins and unavailable metrics with no accepted support", () => {
    const observations = [
      observation("tie-a", "group-tie-a", { tied: true }),
      observation("tie-b", "group-tie-b", { tied: true }),
    ];
    const labels = [
      label("tie-a", "group-tie-a"),
      label("tie-b", "group-tie-b"),
    ];

    const result = evaluateSystemOneCalibrationQualityOof(
      observations,
      labels,
      aliases,
      { foldCount: 2, binCount: 4 },
    );

    expect(result).toMatchObject({
      eligibleSiteCount: 2,
      selectedSiteCount: 0,
      abstentionCount: 2,
      coverage: 0,
      siteWeighted: {
        siteCount: 0,
        brierScore: null,
        expectedCalibrationError: null,
        bins: [
          {
            lowerInclusive: 0,
            upperBound: 0.25,
            upperBoundInclusive: false,
            siteCount: 0,
            predictedProbability: null,
            observedSuccessRate: null,
          },
          {
            lowerInclusive: 0.25,
            upperBound: 0.5,
            upperBoundInclusive: false,
            siteCount: 0,
            predictedProbability: null,
            observedSuccessRate: null,
          },
          {
            lowerInclusive: 0.5,
            upperBound: 0.75,
            upperBoundInclusive: false,
            siteCount: 0,
            predictedProbability: null,
            observedSuccessRate: null,
          },
          {
            lowerInclusive: 0.75,
            upperBound: 1,
            upperBoundInclusive: true,
            siteCount: 0,
            predictedProbability: null,
            observedSuccessRate: null,
          },
        ],
      },
    });
  });

  it("[happy][state-diff] fits shape maps only with predeclared fold support and keeps both call shapes", () => {
    const observations: Phase2EvaluationObservation[] = [];
    const labels: Phase2EvaluationLabel[] = [];
    for (const callShape of ["bare", "member"]) {
      for (let index = 0; index < 75; index++) {
        const sampleId = `${callShape}-${index}`;
        const duplicateGroup = `${callShape}-group-${index}`;
        observations.push(
          observation(sampleId, duplicateGroup, {
            calleeKind: callShape,
            topRankScore: ((index % 6) + 1) * 10,
          }),
        );
        labels.push(label(sampleId, duplicateGroup));
      }
    }

    const result = evaluateSystemOneCalibrationQualityOof(
      observations,
      labels,
      aliases,
      { foldCount: 5, binCount: 4 },
    );

    expect(result.callShapeSensitivity).toMatchObject({
      minimumTrainingDuplicateGroups: 50,
      minimumTrainingScoreLevels: 5,
      total: {
        eligibleSiteCount: 150,
        selectedSiteCount: 150,
        mappedSelectedSiteCount: 150,
        unmappedSelectedSiteCount: 0,
      },
      callShapes: [
        { name: "bare", eligibleSiteCount: 75, mappedSelectedSiteCount: 75 },
        {
          name: "member",
          eligibleSiteCount: 75,
          mappedSelectedSiteCount: 75,
        },
      ],
    });
    expect(
      result.folds.every((fold) =>
        fold.callShapeCalibrators.every(
          (calibrator) =>
            calibrator.status === "fitted" &&
            calibrator.trainingSelectedDuplicateGroupCount >= 50 &&
            calibrator.scoreLevelCount >= 5,
        ),
      ),
    ).toBe(true);
  });

  it("[happy][state-diff] exposes small-support global reliability bins without treating them as stable", () => {
    const observations = [
      observation("small-a", "small-group-a"),
      observation("small-b", "small-group-b"),
    ];
    const labels = [
      label("small-a", "small-group-a"),
      label("small-b", "small-group-b"),
    ];

    const result = evaluateSystemOneCalibrationQualityOof(
      observations,
      labels,
      aliases,
      { foldCount: 2, binCount: 4 },
    );

    expect(result.siteWeighted).toMatchObject({
      siteCount: 2,
      bins: [
        { siteCount: 0, predictedProbability: null },
        { siteCount: 0, predictedProbability: null },
        { siteCount: 2, duplicateGroupCount: 2 },
        { siteCount: 0, predictedProbability: null },
      ],
    });
    expect(result.callShapeSensitivity.total).toMatchObject({
      selectedSiteCount: 2,
      mappedSelectedSiteCount: 0,
      unmappedSelectedSiteCount: 2,
      mapCoverageOfSelected: 0,
    });
    expect(
      result.folds.every((fold) =>
        fold.callShapeCalibrators.every(
          ({ status }) => status === "unsupported",
        ),
      ),
    ).toBe(true);
  });
});
