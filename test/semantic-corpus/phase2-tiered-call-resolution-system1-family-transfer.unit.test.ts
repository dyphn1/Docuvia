import { describe, expect, it } from "vitest";
import { evaluateSystemOneFamilyTransferTrain } from "../../scripts/semantic-corpus/phase2-tiered-call-resolution-system1-family-transfer.mjs";
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

    const result = evaluateSystemOneFamilyTransferTrain(
      observations,
      labels,
      aliases,
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
    const baseline = evaluateSystemOneFamilyTransferTrain(
      observations,
      labels,
      aliases,
    );
    const changedLabels = labels.map((row) =>
      row.repoFamily === "family-a" && row.sampleId === "family-a-0"
        ? { ...row, positiveTargetIds: [wrongTarget] }
        : row,
    );
    const changed = evaluateSystemOneFamilyTransferTrain(
      observations,
      changedLabels,
      aliases,
    );
    const before = baseline.folds.find(
      ({ heldOutFamily }) => heldOutFamily === "family-a",
    )!;
    const after = changed.folds.find(
      ({ heldOutFamily }) => heldOutFamily === "family-a",
    )!;

    expect(before.trainingLabelRowsHash).toBe(after.trainingLabelRowsHash);
    expect(before.thresholdScore).toBe(after.thresholdScore);
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

    const result = evaluateSystemOneFamilyTransferTrain(
      observations,
      labels,
      aliases,
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

    const result = evaluateSystemOneFamilyTransferTrain(
      observations,
      labels,
      aliases,
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
      evaluateSystemOneFamilyTransferTrain(
        [testObservation],
        [testLabel],
        aliases,
      ),
    ).toThrow(/TRAIN/);
  });
});
