import { describe, expect, it } from "vitest";
import {
  applyCallShapesFromCurrentPredictions,
  compareGeneratedCandidateCounts,
  compareCandidateSets,
  filterInputsToUniqueOracleTargets,
  summarizeCandidateSetDistribution,
} from "../../scripts/semantic-corpus/phase2-tiered-call-resolution-candidate-audit.mjs";
import type {
  Phase2EvaluationLabel,
  Phase2EvaluationObservation,
} from "../../scripts/semantic-corpus/phase2-tiered-call-resolution-evaluation.mjs";

function observation(
  sampleId: string,
  overrides: Partial<Phase2EvaluationObservation> = {},
): Phase2EvaluationObservation {
  return {
    sampleId,
    split: "train",
    duplicateGroup: `group-${sampleId}`,
    repoFamily: "family-a",
    ruleSignature: "a".repeat(64),
    candidateTargetIds: [],
    topTargetId: null,
    topRankScore: null,
    tied: false,
    candidateSetComplete: false,
    truncated: false,
    unsupportedCallShape: false,
    generatedCandidateCount: 0,
    ...overrides,
  };
}

function label(
  sampleId: string,
  overrides: Partial<Phase2EvaluationLabel> = {},
): Phase2EvaluationLabel {
  return {
    sampleId,
    split: "train",
    duplicateGroup: `group-${sampleId}`,
    repoFamily: "family-a",
    positiveTargetIds: ["src/target.ts#run"],
    reviewStatus: "confirmed",
    ...overrides,
  };
}

describe("Phase 2 candidate audit", () => {
  it("[state-diff] attaches the current source call shape to baseline rows by site ID", () => {
    const baseline = [observation("site-a"), observation("site-b")];
    const current = [
      observation("site-b", { calleeKind: "member" }),
      observation("site-a", { calleeKind: "bare" }),
    ];

    expect(applyCallShapesFromCurrentPredictions(baseline, current)).toEqual([
      { ...baseline[0], calleeKind: "bare" },
      { ...baseline[1], calleeKind: "member" },
    ]);
  });

  it("[invalid-input][error-handling] rejects a baseline/current site mismatch instead of shifting shapes", () => {
    expect(() =>
      applyCallShapesFromCurrentPredictions(
        [observation("site-a")],
        [observation("site-b", { calleeKind: "bare" })],
      ),
    ).toThrow("identical unique sites");
  });

  it("[happy][state-diff] reports recall, candidate additions, and family/shape size quantiles on one denominator", () => {
    const baseline = [
      observation("site-a", {
        candidateTargetIds: ["src/old.ts#old"],
        generatedCandidateCount: 1,
        calleeKind: "bare",
      }),
      observation("site-b", {
        candidateTargetIds: [],
        generatedCandidateCount: 0,
        calleeKind: "member",
      }),
    ];
    const current = [
      observation("site-a", {
        candidateTargetIds: ["src/old.ts#old", "src/target.ts#run"],
        generatedCandidateCount: 2,
        calleeKind: "bare",
      }),
      observation("site-b", {
        candidateTargetIds: ["src/target.ts#run"],
        generatedCandidateCount: 1,
        calleeKind: "member",
      }),
    ];
    const labels = [label("site-a"), label("site-b")];

    const comparison = compareCandidateSets(baseline, current, labels, "train");
    expect(comparison).toMatchObject({
      baselineCandidateRecall: 0,
      currentCandidateRecall: 1,
      candidateRecallDelta: 1,
      baselineCoveredGoldTargetCount: 0,
      currentCoveredGoldTargetCount: 2,
      addedCandidateMembershipCount: 2,
      newlyCoveredGoldTargetCount: 2,
    });
    expect(compareGeneratedCandidateCounts(baseline, current, "train")).toEqual(
      {
        siteCount: 2,
        baselineGeneratedCandidateCount: 1,
        currentGeneratedCandidateCount: 3,
        generatedCandidateCountDelta: 2,
        sitesWithFewerGeneratedCandidates: 0,
        sitesWithEqualGeneratedCandidates: 0,
        sitesWithMoreGeneratedCandidates: 2,
      },
    );

    const groups = summarizeCandidateSetDistribution(current, labels, "train");
    expect(groups.overall).toEqual(
      expect.objectContaining({
        eligibleSiteCount: 2,
        zeroCandidateSiteCount: 0,
        candidateSetSizeP50: 1,
        candidateSetSizeP95: 2,
      }),
    );
    expect(groups.byFamily).toEqual([
      expect.objectContaining({
        name: "family-a",
        eligibleSiteCount: 2,
        candidateSetSizeP50: 1,
        candidateSetSizeP95: 2,
      }),
    ]);
    expect(groups.byCallShape).toEqual([
      expect.objectContaining({
        name: "bare",
        eligibleSiteCount: 1,
        candidateSetSizeP50: 2,
        candidateSetSizeP95: 2,
      }),
      expect.objectContaining({
        name: "member",
        eligibleSiteCount: 1,
        candidateSetSizeP50: 1,
        candidateSetSizeP95: 1,
      }),
    ]);
  });

  it("[state-diff] excludes ambiguous/unmapped positives and candidate IDs symmetrically", () => {
    const result = filterInputsToUniqueOracleTargets(
      [
        observation("site-a", {
          candidateTargetIds: [
            "src/unique.ts#run",
            "src/collision.ts#same",
            "src/missing.ts#lost",
          ],
          generatedCandidateCount: 3,
        }),
        observation("site-b", {
          candidateTargetIds: ["src/collision.ts#same"],
          generatedCandidateCount: 1,
        }),
      ],
      [
        label("site-a", {
          positiveTargetIds: [
            "src/unique.ts#run",
            "src/collision.ts#same",
            "src/missing.ts#lost",
          ],
        }),
        label("site-b", { positiveTargetIds: ["src/collision.ts#same"] }),
      ],
      {
        uniquelyMappedAliases: new Set(["src/unique.ts#run"]),
        allAliases: new Set(["src/unique.ts#run", "src/collision.ts#same"]),
      },
    );

    expect(result).toMatchObject({
      siteCount: 2,
      rawCandidateSiteCount: 2,
      uniquelyMappedCandidateSiteCount: 1,
      sitesWithCandidatesButNoUniqueTargetCount: 1,
      candidateAliasMembershipCountBeforeFiltering: 4,
      uniqueCandidateMembershipCount: 1,
      uniqueMappedPositiveTargetOccurrenceCount: 1,
      ambiguousPositiveTargetOccurrenceCount: 2,
      unmappedPositiveTargetOccurrenceCount: 1,
      uniqueMappedPositiveSiteCount: 1,
      sitesWithoutUniquePositiveTargetCount: 1,
      droppedAmbiguousCandidateMembershipCount: 2,
      droppedUnmappedCandidateMembershipCount: 1,
    });
    expect(
      result.labels.map(({ positiveTargetIds }) => positiveTargetIds),
    ).toEqual([["src/unique.ts#run"], []]);
    expect(
      result.observations.map(({ candidateTargetIds }) => candidateTargetIds),
    ).toEqual([["src/unique.ts#run"], []]);
    expect(
      result.observations.map(
        ({ generatedCandidateCount }) => generatedCandidateCount,
      ),
    ).toEqual([3, 1]);
  });

  it("[invalid-input] rejects a candidate/label site mismatch before comparison", () => {
    expect(() =>
      filterInputsToUniqueOracleTargets(
        [observation("site-a")],
        [label("site-b")],
        {
          uniquelyMappedAliases: new Set(["src/target.ts#run"]),
          allAliases: new Set(["src/target.ts#run"]),
        },
      ),
    ).toThrow("matching prediction rows");
  });
});
