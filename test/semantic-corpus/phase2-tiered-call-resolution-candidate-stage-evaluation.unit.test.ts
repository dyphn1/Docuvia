import { describe, expect, it } from "vitest";
import {
  candidateOracleScopeKey,
  filterInputsToUniqueOracleTargets,
  type CandidateOracleTargetMapping,
} from "../../scripts/semantic-corpus/phase2-tiered-call-resolution-candidate-audit.mjs";
import {
  createCandidateStageEvidence,
  type CandidateStageEvidence,
  type CandidateTargetMapping,
} from "../../scripts/semantic-corpus/phase2-tiered-call-resolution-candidate-stage-evidence.mjs";
import { evaluateCandidateStageSplit } from "../../scripts/semantic-corpus/phase2-tiered-call-resolution-candidate-stage-evaluation.mjs";
import type {
  Phase2EvaluationLabel,
  Phase2EvaluationObservation,
} from "../../scripts/semantic-corpus/phase2-tiered-call-resolution-evaluation.mjs";

const HASH = "a".repeat(64);

function observation(
  sampleId: string,
  overrides: Partial<Phase2EvaluationObservation> = {},
): Phase2EvaluationObservation {
  return {
    sampleId,
    split: "train",
    duplicateGroup: `group-${sampleId}`,
    repoFamily: "family-a",
    snapshotId: "snapshot-a",
    repoId: "owner/repo",
    calleeKind: "member",
    ruleSignature: "rule-a",
    candidateTargetIds: [],
    topTargetId: null,
    topRankScore: null,
    tied: false,
    candidateSetComplete: false,
    truncated: false,
    unsupportedCallShape: false,
    generatedCandidateCount: 0,
    ambiguousCandidateMappingCount: 0,
    unmappedGeneratedCandidateCount: 0,
    proposedCandidateCount: 0,
    reason: "incomplete-inventory",
    ...overrides,
  };
}

function label(
  sampleId: string,
  positiveTargetIds: readonly string[],
  overrides: Partial<Phase2EvaluationLabel> = {},
): Phase2EvaluationLabel {
  return {
    sampleId,
    split: "train",
    duplicateGroup: `group-${sampleId}`,
    repoFamily: "family-a",
    repoId: "owner/repo",
    positiveTargetIds,
    reviewStatus: "confirmed",
    ...overrides,
  };
}

function stageEvidence(
  sampleId: string,
  split: string,
  generated: readonly [string, CandidateTargetMapping][],
  proposals: readonly [string, CandidateTargetMapping][],
): CandidateStageEvidence {
  const mappings = new Map(generated);
  const proposalMappings = new Map(proposals);
  return createCandidateStageEvidence(
    {
      sampleId,
      split,
      sourceContentHash: HASH,
      callSiteInputHash: HASH,
      generatedCandidateKeys: generated.map(([key]) => key),
      orderedProposalKeys: proposals.map(([key]) => key),
    },
    (key) =>
      mappings.get(key) ??
      proposalMappings.get(key) ?? {
        status: "unmapped",
        targetId: null,
        reason: "fixture-key-is-not-mapped",
      },
  );
}

function candidateMapping(): CandidateOracleTargetMapping {
  const unique = new Set(["src/a.ts#run", "src/b.ts#run", "src/c.ts#run"]);
  return {
    bySnapshotAndRepo: new Map([
      [
        candidateOracleScopeKey("snapshot-a", "owner/repo"),
        {
          snapshotId: "snapshot-a",
          repoId: "owner/repo",
          uniquelyMappedAliases: unique,
          allAliases: new Set([...unique, "src/ambiguous.ts#run"]),
        },
      ],
    ]),
  };
}

describe("P2-A candidate stage quality", () => {
  it("[happy][state-diff] keeps raw keys, mapped IDs, and proposals as separate exact stages", () => {
    const rows = [
      observation("site-a", {
        repoFamily: "family-a",
        generatedCandidateCount: 4,
        candidateTargetIds: ["src/a.ts#run", "src/b.ts#run"],
        proposedCandidateCount: 2,
      }),
      observation("site-b", {
        repoFamily: "family-b",
        calleeKind: "tagged-template",
        unsupportedCallShape: true,
        reason: "unsupported-call-shape",
      }),
    ];
    const labels = [
      label("site-a", ["src/a.ts#run", "src/b.ts#run", "src/c.ts#run"]),
      label("site-b", ["src/ambiguous.ts#run"], {
        repoFamily: "family-b",
      }),
    ];
    const evidence = [
      stageEvidence(
        "site-a",
        "train",
        [
          [
            "key-a",
            { status: "mapped", targetId: "src/a.ts#run", reason: null },
          ],
          [
            "key-b",
            { status: "mapped", targetId: "src/b.ts#run", reason: null },
          ],
          [
            "key-ambiguous",
            {
              status: "ambiguous",
              targetId: null,
              reason: "duplicate-alias",
            },
          ],
          [
            "key-unmapped",
            {
              status: "unmapped",
              targetId: null,
              reason: "target-not-in-facts",
            },
          ],
        ],
        [
          [
            "key-a",
            { status: "mapped", targetId: "src/a.ts#run", reason: null },
          ],
          [
            "key-ambiguous",
            {
              status: "ambiguous",
              targetId: null,
              reason: "duplicate-alias",
            },
          ],
        ],
      ),
      stageEvidence("site-b", "train", [], []),
    ];
    const uniqueInputs = filterInputsToUniqueOracleTargets(
      rows,
      labels,
      candidateMapping(),
    );

    const metrics = evaluateCandidateStageSplit({
      observations: rows,
      evidence,
      labels,
      uniqueInputs,
      split: "train",
    });

    expect(metrics.allConfirmedEligibleSiteCount).toBe(2);
    expect(metrics.uniqueMappablePositiveTargetOccurrenceCount).toBe(3);
    expect(metrics.ambiguousPositiveTargetOccurrenceCount).toBe(1);
    expect(metrics.stages.rawGeneratedKeys.overall).toMatchObject({
      eligibleSiteCount: 2,
      candidateSetSizeMax: 4,
      mappedTargetSetSizeMax: 2,
      coveredGoldTargetCount: 2,
      candidateRecall: 2 / 3,
    });
    expect(metrics.stages.mappedGeneratedTargetIds.overall).toMatchObject({
      candidateSetSizeMax: 2,
      zeroCandidateSiteCount: 1,
      coveredGoldTargetCount: 2,
      candidateRecall: 2 / 3,
    });
    expect(metrics.stages.orderedEvidenceProposals.overall).toMatchObject({
      candidateSetSizeMax: 2,
      mappedTargetSetSizeMax: 1,
      coveredGoldTargetCount: 1,
      candidateRecall: 1 / 3,
    });
    expect(metrics.missAudit).toMatchObject({
      rawMissTargetOccurrenceCount: 1,
      proposalMissTargetOccurrenceCount: 2,
      proposalOnlyDroppedTargetOccurrenceCount: 1,
      unsupportedZeroCandidateSiteCount: 1,
      supportedZeroCandidateSiteCount: 0,
    });
    expect(metrics.stages.orderedEvidenceProposals.byFamily).toEqual([
      expect.objectContaining({ name: "family-a", eligibleSiteCount: 1 }),
      expect.objectContaining({ name: "family-b", eligibleSiteCount: 1 }),
    ]);
    expect(metrics.stages.orderedEvidenceProposals.byCallShape).toEqual([
      expect.objectContaining({ name: "member", eligibleSiteCount: 1 }),
      expect.objectContaining({
        name: "tagged-template",
        eligibleSiteCount: 1,
      }),
    ]);
    expect(
      metrics.stages.orderedEvidenceProposals.byFamilyAndCallShape,
    ).toEqual([
      expect.objectContaining({ name: "family-a × member" }),
      expect.objectContaining({ name: "family-b × tagged-template" }),
    ]);
    expect(metrics.stages.rawGeneratedKeys.overall).toMatchObject({
      zeroCandidateSiteCount: 1,
      zeroCandidateRate: 0.5,
      zeroMappedTargetSiteCount: 1,
      candidateSetSizeP50: 0,
      candidateSetSizeP95: 4,
    });
    expect(metrics.stages.rawGeneratedKeys.byEvidenceAvailability).toEqual([
      expect.objectContaining({
        name: "raw-keys-with-ambiguous-or-unmapped-targets",
        eligibleSiteCount: 1,
      }),
      expect.objectContaining({
        name: "zero-candidates-unsupported-unscorable",
        eligibleSiteCount: 1,
        unscorableEligibleSiteCount: 1,
      }),
    ]);
  });

  it("[invalid-input][error-handling] rejects non-TRAIN rows and mismatched stage identities", () => {
    const row = observation("site-a");
    const trainLabel = label("site-a", ["src/a.ts#run"]);
    const evidence = stageEvidence("site-a", "train", [], []);
    const uniqueInputs = filterInputsToUniqueOracleTargets(
      [row],
      [trainLabel],
      candidateMapping(),
    );

    expect(() =>
      evaluateCandidateStageSplit({
        observations: [observation("site-a", { split: "test" })],
        evidence,
        labels: [trainLabel],
        uniqueInputs,
        split: "train",
      }),
    ).toThrow("Candidate stage metrics are TRAIN-only.");
    expect(() =>
      evaluateCandidateStageSplit({
        observations: [row],
        evidence: [stageEvidence("other-site", "train", [], [])],
        labels: [trainLabel],
        uniqueInputs,
        split: "train",
      }),
    ).toThrow("Candidate stage evidence must exactly match TRAIN predictions.");
  });

  it("[state-diff][error-handling] counts an absent call-shape fact as missing evidence", () => {
    const row = observation("site-a", { calleeKind: undefined });
    const trainLabel = label("site-a", ["src/a.ts#run"]);
    const evidence = stageEvidence("site-a", "train", [], []);
    const uniqueInputs = filterInputsToUniqueOracleTargets(
      [row],
      [trainLabel],
      candidateMapping(),
    );

    const metrics = evaluateCandidateStageSplit({
      observations: [row],
      evidence: [evidence],
      labels: [trainLabel],
      uniqueInputs,
      split: "train",
    });

    expect(metrics.stages.rawGeneratedKeys.byEvidenceAvailability).toEqual([
      expect.objectContaining({
        name: "zero-candidates-missing-call-shape-evidence-scorable",
        eligibleSiteCount: 1,
        uniqueMappablePositiveSiteCount: 1,
      }),
    ]);
    expect(metrics.missAudit).toMatchObject({
      supportedZeroCandidateSiteCount: 0,
      unsupportedZeroCandidateSiteCount: 0,
      missingCallShapeEvidenceZeroCandidateSiteCount: 1,
      rawMissReasons: {
        "missing-call-shape-evidence-expected-lsp-fallback": 1,
      },
    });
  });

  it("[state-diff][error-handling] treats unmapped call sites as missing shape evidence before unsupported syntax", () => {
    const row = observation("site-a", {
      calleeKind: "unmapped",
      unsupportedCallShape: true,
    });
    const trainLabel = label("site-a", ["src/a.ts#run"]);
    const evidence = stageEvidence("site-a", "train", [], []);
    const uniqueInputs = filterInputsToUniqueOracleTargets(
      [row],
      [trainLabel],
      candidateMapping(),
    );

    const metrics = evaluateCandidateStageSplit({
      observations: [row],
      evidence: [evidence],
      labels: [trainLabel],
      uniqueInputs,
      split: "train",
    });

    expect(metrics.stages.rawGeneratedKeys.byEvidenceAvailability).toEqual([
      expect.objectContaining({
        name: "zero-candidates-missing-call-shape-evidence-scorable",
        eligibleSiteCount: 1,
        uniqueMappablePositiveSiteCount: 1,
      }),
    ]);
    expect(metrics.missAudit).toMatchObject({
      supportedZeroCandidateSiteCount: 0,
      unsupportedZeroCandidateSiteCount: 0,
      missingCallShapeEvidenceZeroCandidateSiteCount: 1,
      rawMissReasons: {
        "missing-call-shape-evidence-expected-lsp-fallback": 1,
      },
    });
  });
});
