import { describe, expect, it } from "vitest";
import {
  evaluateSystemOneSplit,
  selectSystemOne,
  selectSystemOneThreshold,
} from "../../scripts/semantic-corpus/phase2-tiered-call-resolution-system1-evaluation.mjs";
import type {
  Phase2EvaluationLabel,
  Phase2EvaluationObservation,
} from "../../scripts/semantic-corpus/phase2-tiered-call-resolution-evaluation.mjs";
import {
  candidateOracleScopeKey,
  type CandidateOracleTargetMapping,
} from "../../scripts/semantic-corpus/phase2-tiered-call-resolution-candidate-audit.mjs";

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
    ruleSignature: "rule-v3",
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

describe("P2-B System One selection evaluation", () => {
  it("[state-diff][error-handling] resolves each observation only against its source snapshot mapping", () => {
    const target = "src/target.ts#run";
    const scope = (snapshotId: string, aliases: readonly string[]) => ({
      snapshotId,
      repoId: "owner/repo",
      uniquelyMappedAliases: new Set(aliases),
      allAliases: new Set(aliases),
    });
    const mapping: CandidateOracleTargetMapping = {
      bySnapshotAndRepo: new Map([
        [
          candidateOracleScopeKey("snapshot-a", "owner/repo"),
          scope("snapshot-a", [target]),
        ],
        [
          candidateOracleScopeKey("snapshot-b", "owner/repo"),
          scope("snapshot-b", [target]),
        ],
      ]),
    };
    const fromA = observation("a", "group-a", {
      snapshotId: "snapshot-a",
      repoId: "owner/repo",
    });
    const fromB = observation("b", "group-b", {
      snapshotId: "snapshot-b",
      repoId: "owner/repo",
    });
    const missingScope = observation("missing", "group-missing", {
      snapshotId: "snapshot-c",
      repoId: "owner/repo",
    });

    expect(selectSystemOne(fromA, 10, mapping).status).toBe("likely");
    expect(selectSystemOne(fromB, 10, mapping).status).toBe("likely");
    expect(selectSystemOne(missingScope, 10, mapping)).toMatchObject({
      status: "ambiguous",
      reason: "unmapped-target",
    });
  });

  it("[happy] allows calibrated likely selection while inventory completeness stays false", () => {
    const row = observation("one", "group-one", {
      candidateSetComplete: false,
    });

    expect(selectSystemOne(row, 10, aliases)).toEqual({
      status: "likely",
      selectedTargetId: "src/target.ts#run",
      reason: "selected-by-calibrated-threshold",
    });
  });

  it("[happy] selects the lowest qualifying score without shrinking the site denominator", () => {
    const observations = [] as Phase2EvaluationObservation[];
    const labels = [] as Phase2EvaluationLabel[];
    for (let index = 0; index < 9; index++) {
      const id = `high-good-${index}`;
      observations.push(observation(id, `group-${id}`, { topRankScore: 100 }));
      labels.push(label(id, `group-${id}`));
    }
    observations.push(
      observation("high-bad", "group-high-bad", {
        topRankScore: 100,
        topTargetId: "src/wrong.ts#run",
      }),
    );
    labels.push(label("high-bad", "group-high-bad"));
    for (let index = 0; index < 9; index++) {
      const id = `low-good-${index}`;
      observations.push(observation(id, `group-${id}`, { topRankScore: 10 }));
      labels.push(label(id, `group-${id}`));
    }
    observations.push(
      observation("low-bad", "group-low-bad", {
        topRankScore: 10,
        topTargetId: "src/wrong.ts#run",
      }),
    );
    labels.push(label("low-bad", "group-low-bad"));
    for (let index = 0; index < 10; index++) {
      const id = `no-candidate-${index}`;
      observations.push(
        observation(id, `group-${id}`, {
          candidateTargetIds: [],
          topTargetId: null,
          topRankScore: null,
        }),
      );
      labels.push(label(id, `group-${id}`));
    }

    const result = selectSystemOneThreshold(observations, labels, aliases);

    expect(result).toMatchObject({
      thresholdScore: 10,
      targetAcceptedPrecision: 0.9,
      reason: "selected-max-coverage",
      metrics: {
        eligibleSiteCount: 30,
        selectedSiteCount: 20,
        selectedCorrectSiteCount: 18,
        coverage: 2 / 3,
        acceptedSitePrecision: 0.9,
        rawTop1CorrectCount: 18,
        rawTop1: 0.6,
        endToEndTop1: 0.6,
        duplicateGroupPrecision: 0.9,
        abstentionCount: 10,
        families: [
          {
            name: "family-a",
            eligibleSiteCount: 30,
            rawTop1: 0.6,
            selectedSiteCount: 20,
            acceptedSitePrecision: 0.9,
            endToEndTop1: 0.6,
          },
        ],
        callShapes: [
          {
            name: "bare",
            eligibleSiteCount: 30,
            rawTop1: 0.6,
            selectedSiteCount: 20,
            acceptedSitePrecision: 0.9,
            endToEndTop1: 0.6,
          },
        ],
      },
    });
  });

  it("[invalid-input][error-handling] rejects any threshold-selection labels outside calibration", () => {
    const row = observation("heldout", "group-heldout", { split: "test" });
    const heldout = label("heldout", "group-heldout", { split: "test" });

    expect(() => selectSystemOneThreshold([row], [heldout], aliases)).toThrow(
      /calibration split/,
    );
  });

  it("[invalid-input] counts conflicting duplicate labels as an incorrect independent group", () => {
    const observations = [
      observation("first", "conflicting-group"),
      observation("second", "conflicting-group", {
        topTargetId: "src/wrong.ts#run",
      }),
    ];
    const labels = [
      label("first", "conflicting-group"),
      label("second", "conflicting-group", {
        positiveTargetIds: ["src/wrong.ts#run"],
      }),
    ];

    const metrics = evaluateSystemOneSplit(
      observations,
      labels,
      aliases,
      10,
      "calibration",
    );

    expect(metrics).toMatchObject({
      eligibleSiteCount: 2,
      selectedSiteCount: 2,
      selectedCorrectSiteCount: 2,
      acceptedSitePrecision: 1,
      acceptedDuplicateGroupCount: 1,
      correctAcceptedDuplicateGroupCount: 0,
      duplicateGroupPrecision: 0,
    });
  });

  it("[state-diff] abstains on ties, truncation, unsupported shapes, and unknown targets", () => {
    const results = [
      selectSystemOne(observation("tie", "tie", { tied: true }), 10, aliases),
      selectSystemOne(
        observation("truncated", "truncated", { truncated: true }),
        10,
        aliases,
      ),
      selectSystemOne(
        observation("unsupported", "unsupported", {
          unsupportedCallShape: true,
        }),
        10,
        aliases,
      ),
      selectSystemOne(
        observation("unmapped", "unmapped", {
          topTargetId: "src/unmapped.ts#run",
        }),
        10,
        aliases,
      ),
    ];

    expect(results.map(({ status }) => status)).toEqual([
      "ambiguous",
      "ambiguous",
      "ambiguous",
      "ambiguous",
    ]);
    expect(results.map(({ reason }) => reason)).toEqual([
      "rank-tie",
      "truncated-candidate-list",
      "unsupported-call-shape",
      "unmapped-target",
    ]);
  });
});
