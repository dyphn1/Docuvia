import { describe, expect, it } from "vitest";
import { evaluateSystemOneFamilyTransferAtThreshold } from "../../scripts/semantic-corpus/phase2-tiered-call-resolution-system1-family-transfer.mjs";
import type {
  Phase2EvaluationLabel,
  Phase2EvaluationObservation,
} from "../../scripts/semantic-corpus/phase2-tiered-call-resolution-evaluation.mjs";

const target = "src/target.ts#run";
const wrongTarget = "src/wrong.ts#run";
const aliases = new Set([target, wrongTarget]);

function observation(
  sampleId: string,
  family: string,
  duplicateGroup: string,
  overrides: Partial<Phase2EvaluationObservation> = {},
): Phase2EvaluationObservation {
  return {
    sampleId,
    split: "train",
    duplicateGroup,
    repoFamily: family,
    calleeKind: "bare",
    ruleSignature: "ordered-evidence-v1",
    candidateTargetIds: [target],
    topTargetId: target,
    topRankScore: 10,
    tied: false,
    candidateSetComplete: false,
    truncated: false,
    unsupportedCallShape: false,
    topRankingSignals: ["compatible-argument-count"],
    generatedCandidateCount: 1,
    proposedCandidateCount: 1,
    ...overrides,
  };
}

function label(
  sampleId: string,
  family: string,
  duplicateGroup: string,
  overrides: Partial<Phase2EvaluationLabel> = {},
): Phase2EvaluationLabel {
  return {
    sampleId,
    split: "train",
    duplicateGroup,
    repoFamily: family,
    positiveTargetIds: [target],
    reviewStatus: "confirmed",
    ...overrides,
  };
}

function healthyFamily(family: string, count: number) {
  const observations: Phase2EvaluationObservation[] = [];
  const labels: Phase2EvaluationLabel[] = [];
  for (let index = 0; index < count; index++) {
    const sampleId = `${family}-${index}`;
    const duplicateGroup = `${family}-group-${index}`;
    observations.push(
      observation(sampleId, family, duplicateGroup, {
        topRankScore: index % 6,
      }),
    );
    labels.push(label(sampleId, family, duplicateGroup));
  }
  return { observations, labels };
}

function combineFamilies(...families: string[]) {
  const samples = families.map((family) => healthyFamily(family, 60));
  return {
    observations: samples.flatMap(({ observations }) => observations),
    labels: samples.flatMap(({ labels }) => labels),
  };
}

describe("P2-B train-family transfer diagnostic", () => {
  it("[happy][state-diff] excludes an entire cross-family duplicate group from every training fold", () => {
    const observations = [
      observation("a-shared", "family-a", "cross-family-group"),
      observation("a-local", "family-a", "a-local-group"),
      observation("b-shared", "family-b", "cross-family-group"),
      observation("b-local", "family-b", "b-local-group"),
      observation("c-local", "family-c", "c-local-group"),
    ];
    const labels = observations.map(
      ({ sampleId, repoFamily, duplicateGroup }) =>
        label(sampleId, repoFamily, duplicateGroup),
    );

    const result = evaluateSystemOneFamilyTransferAtThreshold(
      observations,
      labels,
      aliases,
      0,
    );
    const familyA = result.folds.find(
      ({ heldOutFamily }) => heldOutFamily === "family-a",
    );
    const familyC = result.folds.find(
      ({ heldOutFamily }) => heldOutFamily === "family-c",
    );

    expect(result.crossFamilyDuplicateGroupCount).toBe(1);
    expect(familyA).toMatchObject({
      trainingEligibleSiteCount: 2,
      excludedCrossFamilyTrainingSiteCount: 1,
      excludedCrossFamilyTrainingGroupCount: 1,
      trainingHeldGroupOverlapCount: 0,
    });
    expect(familyC).toMatchObject({
      trainingEligibleSiteCount: 2,
      excludedCrossFamilyTrainingSiteCount: 2,
      excludedCrossFamilyTrainingGroupCount: 1,
      trainingHeldGroupOverlapCount: 0,
    });
  });

  it("[happy][state-diff] does not let held-family label changes alter its threshold or probability-map fit", () => {
    const { observations, labels } = combineFamilies(
      "family-a",
      "family-b",
      "family-c",
    );
    const baseline = evaluateSystemOneFamilyTransferAtThreshold(
      observations,
      labels,
      aliases,
      5,
    );
    const changedLabels = labels.map((row) =>
      row.repoFamily === "family-a" && row.sampleId === "family-a-5"
        ? { ...row, positiveTargetIds: [wrongTarget] }
        : row,
    );
    const changed = evaluateSystemOneFamilyTransferAtThreshold(
      observations,
      changedLabels,
      aliases,
      5,
    );
    const before = baseline.folds.find(
      ({ heldOutFamily }) => heldOutFamily === "family-a",
    )!;
    const after = changed.folds.find(
      ({ heldOutFamily }) => heldOutFamily === "family-a",
    )!;

    expect(before.trainingLabelRowsHash).toBe(after.trainingLabelRowsHash);
    expect(before.thresholdScore).toBe(after.thresholdScore);
    expect(before.thresholdScore).toBe(5);
    expect(baseline.thresholdSelectionSource).toBe("calibration-freeze");
    expect(before.probabilityMap.fitHash).toBe(after.probabilityMap.fitHash);
    expect(before.heldOutMetrics.selectedCorrectSiteCount).toBeGreaterThan(
      after.heldOutMetrics.selectedCorrectSiteCount,
    );
  });

  it("[happy][state-diff] keeps ties, unsupported, and no-candidate sites in held-family coverage denominators", () => {
    const { observations, labels } = combineFamilies(
      "family-a",
      "family-b",
      "family-c",
    );
    observations.push(
      observation("a-tied", "family-a", "a-tied-group", { tied: true }),
      observation("a-unsupported", "family-a", "a-unsupported-group", {
        unsupportedCallShape: true,
      }),
      observation("a-empty", "family-a", "a-empty-group", {
        candidateTargetIds: [],
        topTargetId: null,
        topRankScore: null,
        generatedCandidateCount: 0,
        proposedCandidateCount: 0,
      }),
      observation("a-unscorable", "family-a", "a-unscorable-group"),
    );
    labels.push(
      label("a-tied", "family-a", "a-tied-group"),
      label("a-unsupported", "family-a", "a-unsupported-group"),
      label("a-empty", "family-a", "a-empty-group"),
      label("a-unscorable", "family-a", "a-unscorable-group", {
        positiveTargetIds: ["src/not-indexed.ts#run"],
      }),
    );

    const result = evaluateSystemOneFamilyTransferAtThreshold(
      observations,
      labels,
      aliases,
      0,
    );
    const held = result.folds.find(
      ({ heldOutFamily }) => heldOutFamily === "family-a",
    )!;

    expect(held.heldOutMetrics).toMatchObject({
      eligibleSiteCount: 64,
      scorableLabelSiteCount: 63,
      unscorableLabelSiteCount: 1,
      selectedSiteCount: 61,
      selectedCorrectSiteCount: 60,
      acceptedSitePrecision: 60 / 61,
      endToEndTop1: 60 / 64,
      abstentionCount: 3,
    });
    expect(held.selectedProbabilityMetrics).toMatchObject({
      selectedSiteCount: 61,
      selectedScorableSiteCount: 60,
      selectedUnscorableSiteCount: 1,
      scorableOnlySiteWeighted: { siteCount: 60 },
      siteWeighted: { siteCount: 61 },
    });
    expect(held.candidateAvailability.allEligibleSiteCount).toBe(64);
    expect(held.candidateAvailability.generatedCandidateZeroSiteCount).toBe(1);
    expect(held.abstentionAttribution).toMatchObject({
      eligibleSiteCount: 64,
      abstainedSiteCount: 3,
      byCallShapeAndReason: [
        {
          callShape: "bare",
          reason: "no-ranked-candidate",
          abstainedSiteCount: 1,
          zeroRankScoreSiteCount: 0,
          missingSignalCounts: {},
        },
        {
          callShape: "bare",
          reason: "rank-tie",
          abstainedSiteCount: 1,
          zeroRankScoreSiteCount: 0,
          missingSignalCounts: { "same-directory": 1 },
        },
        {
          callShape: "bare",
          reason: "unsupported-call-shape",
          abstainedSiteCount: 1,
          zeroRankScoreSiteCount: 0,
          missingSignalCounts: { "same-directory": 1 },
        },
      ],
    });
  });

  it("[happy][state-diff] reports probability mapping unsupported when the retained families have too few groups", () => {
    const observations = [
      observation("a-one", "family-a", "a-one-group"),
      observation("b-one", "family-b", "b-one-group"),
    ];
    const labels = observations.map(
      ({ sampleId, repoFamily, duplicateGroup }) =>
        label(sampleId, repoFamily, duplicateGroup),
    );

    const result = evaluateSystemOneFamilyTransferAtThreshold(
      observations,
      labels,
      aliases,
      0,
    );

    expect(result.folds).toHaveLength(2);
    expect(result.folds[0]?.probabilityMap).toMatchObject({
      status: "unsupported",
      reason: "insufficient-training-duplicate-groups",
      selectedTrainingSiteCount: 1,
      trainingDuplicateGroupCount: 1,
      scoreLevelCount: 1,
    });
    expect(
      result.folds[0]?.selectedProbabilityMetrics.siteWeighted,
    ).toMatchObject({
      siteCount: 0,
      brierScore: null,
      expectedCalibrationError: null,
    });
  });

  it("[invalid-input][error-handling] rejects non-TRAIN input rows", () => {
    const testObservation = observation("test-row", "family-a", "test-group", {
      split: "test",
    });
    const testLabel = label("test-row", "family-a", "test-group", {
      split: "test",
    });

    expect(() =>
      evaluateSystemOneFamilyTransferAtThreshold(
        [testObservation],
        [testLabel],
        aliases,
        0,
      ),
    ).toThrow(/TRAIN/);
  });

  it("[state-diff] attributes missing peer evidence and weak scores by held family and call shape", () => {
    const { observations, labels } = combineFamilies(
      "family-a",
      "family-b",
      "family-c",
    );
    observations.push(
      observation("a-member-weak", "family-a", "a-member-weak-group", {
        calleeKind: "member",
        topRankScore: 10,
        topRankingSignals: ["compatible-argument-count"],
      }),
      observation("a-member-partial", "family-a", "a-member-partial-group", {
        calleeKind: "member",
        topRankScore: 5,
        topRankingSignals: ["partial-binding-peer-member-usage"],
        unsupportedCallShape: true,
      }),
    );
    labels.push(
      label("a-member-weak", "family-a", "a-member-weak-group"),
      label("a-member-partial", "family-a", "a-member-partial-group"),
    );

    const result = evaluateSystemOneFamilyTransferAtThreshold(
      observations,
      labels,
      aliases,
      20,
    );
    const held = result.folds.find(
      ({ heldOutFamily }) => heldOutFamily === "family-a",
    )!;

    expect(held.abstentionAttribution.byCallShapeAndReason).toContainEqual(
      expect.objectContaining({
        callShape: "member",
        reason: "score-below-threshold",
        abstainedSiteCount: 1,
        lowRankScoreSiteCount: 1,
        missingSignalCounts: {
          "explicit-receiver-type": 1,
          "structural-peer-member-usage": 1,
          "same-directory": 1,
        },
      }),
    );
    expect(held.abstentionAttribution.byCallShapeAndReason).toContainEqual(
      expect.objectContaining({
        callShape: "member",
        reason: "unsupported-call-shape",
        abstainedSiteCount: 1,
        lowRankScoreSiteCount: 1,
        missingSignalCounts: {
          "explicit-receiver-type": 1,
          "compatible-argument-count": 1,
          "same-directory": 1,
        },
      }),
    );
  });
});
