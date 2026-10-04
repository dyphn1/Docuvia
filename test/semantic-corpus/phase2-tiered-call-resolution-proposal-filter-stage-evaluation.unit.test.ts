import { describe, expect, it } from "vitest";
import {
  candidateOracleScopeKey,
  filterInputsToUniqueOracleTargets,
  type CandidateOracleTargetMapping,
} from "../../scripts/semantic-corpus/phase2-tiered-call-resolution-candidate-audit.mjs";
import {
  createCandidateStageEvidence,
  type CandidateStageEvidence,
} from "../../scripts/semantic-corpus/phase2-tiered-call-resolution-candidate-stage-evidence.mjs";
import type { CandidateTargetMapping } from "../../scripts/semantic-corpus/phase2-tiered-call-resolution-candidate-stage-evidence.mjs";
import {
  PROPOSAL_FILTER_STAGES,
  type ProposalFilterStageEvidence,
  type ProposalFilterStageName,
} from "../../scripts/semantic-corpus/phase2-tiered-call-resolution-proposal-filter-stage-evidence.mjs";
import { evaluateProposalFilterStageSplit } from "../../scripts/semantic-corpus/phase2-tiered-call-resolution-proposal-filter-stage-evaluation.mjs";
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

function mapped(targetId: string): CandidateTargetMapping {
  return { status: "mapped", targetId, reason: null };
}

function unmapped(reason = "not-in-facts"): CandidateTargetMapping {
  return { status: "unmapped", targetId: null, reason };
}

function stageEvidence(
  sampleId: string,
  keysByStage: Readonly<Record<ProposalFilterStageName, readonly string[]>>,
  mappingByKey: ReadonlyMap<string, CandidateTargetMapping>,
): ProposalFilterStageEvidence {
  return {
    schemaVersion: 1,
    measurement: "phase2-p2a-proposal-filter-stage-evidence/1",
    sampleId,
    split: "train",
    sourceContentHash: HASH,
    callSiteInputHash: HASH,
    stages: PROPOSAL_FILTER_STAGES.map((stage) => {
      const candidateKeys = [...keysByStage[stage]];
      const targetMappings = candidateKeys.map((targetKey) => {
        const result = mappingByKey.get(targetKey) ?? unmapped();
        return {
          targetKey,
          status: result.status,
          targetId: result.targetId,
          reason: result.reason,
        };
      });
      const uniqueMappedTargetIds = [
        ...new Set(
          targetMappings.flatMap(({ targetId }) =>
            targetId === null ? [] : [targetId],
          ),
        ),
      ].sort();
      return {
        stage,
        candidateKeys,
        targetMappings,
        targetIdsInOrder: targetMappings.map(({ targetId }) => targetId),
        uniqueMappedTargetIds,
        mappingCounts: {
          candidateKeyCount: candidateKeys.length,
          mappedKeyCount: targetMappings.filter(
            ({ status }) => status === "mapped",
          ).length,
          ambiguousKeyCount: targetMappings.filter(
            ({ status }) => status === "ambiguous",
          ).length,
          unmappedKeyCount: targetMappings.filter(
            ({ status }) => status === "unmapped",
          ).length,
          uniqueMappedTargetCount: uniqueMappedTargetIds.length,
        },
      };
    }),
  };
}

function rawCandidateEvidence(
  sampleId: string,
  keys: readonly string[],
  proposals: readonly string[],
  mappingByKey: ReadonlyMap<string, CandidateTargetMapping>,
): CandidateStageEvidence {
  return createCandidateStageEvidence(
    {
      sampleId,
      split: "train",
      sourceContentHash: HASH,
      callSiteInputHash: HASH,
      generatedCandidateKeys: keys,
      orderedProposalKeys: proposals,
    },
    (key) => mappingByKey.get(key) ?? unmapped(),
  );
}

function candidateMapping(): CandidateOracleTargetMapping {
  const unique = new Set([
    "src/a.ts#run",
    "src/b.ts#run",
    "src/c.ts#run",
    "src/d.ts#run",
    "src/cap.ts#run",
  ]);
  return {
    bySnapshotAndRepo: new Map([
      [
        candidateOracleScopeKey("snapshot-a", "owner/repo"),
        {
          snapshotId: "snapshot-a",
          repoId: "owner/repo",
          uniquelyMappedAliases: unique,
          allAliases: unique,
        },
      ],
    ]),
  };
}

describe("P2-A ordered proposal-filter stage quality", () => {
  it("[happy][state-diff] keeps filter drops, cap drops, and all-site denominators distinct", () => {
    const observations = [
      observation("site-a", {
        repoFamily: "family-a",
        generatedCandidateCount: 3,
        candidateTargetIds: ["src/a.ts#run", "src/b.ts#run"],
        proposedCandidateCount: 1,
      }),
      observation("site-b", {
        repoFamily: "family-b",
        calleeKind: "tagged-template",
        unsupportedCallShape: true,
      }),
      observation("site-c", {
        repoFamily: "family-a",
        generatedCandidateCount: 1,
        unmappedGeneratedCandidateCount: 1,
        proposedCandidateCount: 1,
        candidateTargetIds: [],
      }),
      observation("site-d", {
        repoFamily: "family-c",
        calleeKind: "bare",
        generatedCandidateCount: 26,
        unmappedGeneratedCandidateCount: 25,
        candidateTargetIds: ["src/cap.ts#run"],
        proposedCandidateCount: 25,
        truncated: true,
      }),
    ];
    const labels = [
      label("site-a", ["src/a.ts#run", "src/b.ts#run"]),
      label("site-b", ["src/c.ts#run"], { repoFamily: "family-b" }),
      label("site-c", ["src/d.ts#run"], { repoFamily: "family-a" }),
      label("site-d", ["src/cap.ts#run"], { repoFamily: "family-c" }),
    ];
    const keyMap = new Map<string, CandidateTargetMapping>([
      ["key-a", mapped("src/a.ts#run")],
      ["key-b", mapped("src/b.ts#run")],
      ["key-noise", unmapped()],
      ...Array.from(
        { length: 25 },
        (_, index) => [`key-cap-noise-${index}`, unmapped()] as const,
      ),
      ["key-cap-target", mapped("src/cap.ts#run")],
    ]);
    const evidence = [
      stageEvidence(
        "site-a",
        {
          beforeVisibility: ["key-a", "key-b", "key-noise"],
          afterVisibility: ["key-a", "key-b"],
          afterExplicitReceiverType: ["key-a", "key-b"],
          afterPeerMembers: ["key-a"],
          afterArgumentShape: ["key-a"],
          beforeMaxCandidates: ["key-a"],
          afterMaxCandidates: ["key-a"],
        },
        keyMap,
      ),
      stageEvidence(
        "site-b",
        {
          beforeVisibility: [],
          afterVisibility: [],
          afterExplicitReceiverType: [],
          afterPeerMembers: [],
          afterArgumentShape: [],
          beforeMaxCandidates: [],
          afterMaxCandidates: [],
        },
        keyMap,
      ),
      stageEvidence(
        "site-c",
        {
          beforeVisibility: ["key-noise"],
          afterVisibility: ["key-noise"],
          afterExplicitReceiverType: ["key-noise"],
          afterPeerMembers: ["key-noise"],
          afterArgumentShape: ["key-noise"],
          beforeMaxCandidates: ["key-noise"],
          afterMaxCandidates: ["key-noise"],
        },
        keyMap,
      ),
      stageEvidence(
        "site-d",
        {
          beforeVisibility: [
            ...Array.from(
              { length: 25 },
              (_, index) => `key-cap-noise-${index}`,
            ),
            "key-cap-target",
          ],
          afterVisibility: [
            ...Array.from(
              { length: 25 },
              (_, index) => `key-cap-noise-${index}`,
            ),
            "key-cap-target",
          ],
          afterExplicitReceiverType: [
            ...Array.from(
              { length: 25 },
              (_, index) => `key-cap-noise-${index}`,
            ),
            "key-cap-target",
          ],
          afterPeerMembers: [
            ...Array.from(
              { length: 25 },
              (_, index) => `key-cap-noise-${index}`,
            ),
            "key-cap-target",
          ],
          afterArgumentShape: [
            ...Array.from(
              { length: 25 },
              (_, index) => `key-cap-noise-${index}`,
            ),
            "key-cap-target",
          ],
          beforeMaxCandidates: [
            ...Array.from(
              { length: 25 },
              (_, index) => `key-cap-noise-${index}`,
            ),
            "key-cap-target",
          ],
          afterMaxCandidates: Array.from(
            { length: 25 },
            (_, index) => `key-cap-noise-${index}`,
          ),
        },
        keyMap,
      ),
    ];
    const candidateStages = [
      rawCandidateEvidence(
        "site-a",
        ["key-a", "key-b", "key-noise"],
        ["key-a"],
        keyMap,
      ),
      rawCandidateEvidence("site-b", [], [], keyMap),
      rawCandidateEvidence("site-c", ["key-noise"], ["key-noise"], keyMap),
      rawCandidateEvidence(
        "site-d",
        [
          ...Array.from({ length: 25 }, (_, index) => `key-cap-noise-${index}`),
          "key-cap-target",
        ],
        Array.from({ length: 25 }, (_, index) => `key-cap-noise-${index}`),
        keyMap,
      ),
    ];
    const uniqueInputs = filterInputsToUniqueOracleTargets(
      observations,
      labels,
      candidateMapping(),
    );

    const metrics = evaluateProposalFilterStageSplit({
      observations,
      evidence,
      candidateStages,
      labels,
      uniqueInputs,
      split: "train",
    });

    expect(metrics.allConfirmedEligibleSiteCount).toBe(4);
    expect(metrics.uniqueMappablePositiveTargetOccurrenceCount).toBe(5);
    expect(metrics.stages.afterPeerMembers.overall).toMatchObject({
      eligibleSiteCount: 4,
      candidateGoldTargetOccurrenceCount: 5,
      coveredGoldTargetOccurrenceCount: 2,
      candidateRecall: 2 / 5,
      zeroCandidateSiteCount: 1,
      zeroMappedTargetSiteCount: 2,
    });
    expect(metrics.stages.afterPeerMembers.overall.candidateKeySize).toEqual({
      p50: 1,
      p95: 26,
      max: 26,
    });
    expect(metrics.dropAudit.rawPresentThenDroppedByFirstStage).toEqual({
      afterMaxCandidates: 1,
      afterPeerMembers: 1,
    });
    expect(
      metrics.dropAudit.rawPresentThenDroppedByFamilyShapeAndFirstStage,
    ).toEqual([
      {
        family: "family-a",
        callShape: "member",
        firstMissingStage: "afterPeerMembers",
        targetOccurrenceCount: 1,
      },
      {
        family: "family-c",
        callShape: "bare",
        firstMissingStage: "afterMaxCandidates",
        targetOccurrenceCount: 1,
      },
    ]);
    expect(metrics.dropAudit.rawAbsentByFamilyAndCallShape).toEqual([
      { family: "family-a", callShape: "member", targetOccurrenceCount: 1 },
      {
        family: "family-b",
        callShape: "tagged-template",
        targetOccurrenceCount: 1,
      },
    ]);
    expect(metrics.dropAudit.rawPresentGoldTargetOccurrenceCount).toBe(3);
    expect(metrics.dropAudit.afterCapDroppedGoldTargetOccurrenceCount).toBe(1);
    expect(metrics.dropAudit.sitesTruncatedByMaxCandidates).toBe(1);
    expect(
      metrics.stages.beforeMaxCandidates.overall.candidateKeySize.max,
    ).toBe(26);
    expect(metrics.stages.afterMaxCandidates.overall.candidateKeySize.max).toBe(
      25,
    );
    expect(metrics.stages.afterPeerMembers.byFamilyAndCallShape).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "family-b × tagged-template",
          eligibleSiteCount: 1,
          zeroCandidateSiteCount: 1,
        }),
      ]),
    );
  });

  it("[invalid-input][error-handling] rejects stage data from another split or non-monotonic filter output", () => {
    const row = observation("site-a", {
      generatedCandidateCount: 1,
      proposedCandidateCount: 1,
      candidateTargetIds: ["src/a.ts#run"],
    });
    const trainLabel = label("site-a", ["src/a.ts#run"]);
    const valid = stageEvidence(
      "site-a",
      {
        beforeVisibility: ["key-a"],
        afterVisibility: ["key-a"],
        afterExplicitReceiverType: ["key-a"],
        afterPeerMembers: ["key-a"],
        afterArgumentShape: ["key-a"],
        beforeMaxCandidates: ["key-a"],
        afterMaxCandidates: ["key-a"],
      },
      new Map([["key-a", mapped("src/a.ts#run")]]),
    );
    const uniqueInputs = filterInputsToUniqueOracleTargets(
      [row],
      [trainLabel],
      candidateMapping(),
    );
    const input = {
      observations: [row],
      evidence: [valid],
      candidateStages: [
        rawCandidateEvidence(
          "site-a",
          ["key-a"],
          ["key-a"],
          new Map([["key-a", mapped("src/a.ts#run")]]),
        ),
      ],
      labels: [trainLabel],
      uniqueInputs,
      split: "train" as const,
    };

    expect(() =>
      evaluateProposalFilterStageSplit({
        ...input,
        evidence: [{ ...valid, split: "test" as "train" }],
      }),
    ).toThrow(/TRAIN/u);
    const nonMonotonic = stageEvidence(
      "site-a",
      {
        beforeVisibility: ["key-a"],
        afterVisibility: [],
        afterExplicitReceiverType: ["key-a"],
        afterPeerMembers: ["key-a"],
        afterArgumentShape: ["key-a"],
        beforeMaxCandidates: ["key-a"],
        afterMaxCandidates: ["key-a"],
      },
      new Map([["key-a", mapped("src/a.ts#run")]]),
    );
    expect(() =>
      evaluateProposalFilterStageSplit({
        ...input,
        evidence: [nonMonotonic],
      }),
    ).toThrow(/monotonic/u);
  });

  it("[invalid-input][error-handling] requires the maxCandidates stage to retain exactly the first 25 proposals", () => {
    const allKeys = Array.from({ length: 26 }, (_, index) => `key-${index}`);
    const cappedKeys = allKeys.slice(0, 24);
    const row = observation("site-cap", {
      generatedCandidateCount: allKeys.length,
      unmappedGeneratedCandidateCount: allKeys.length,
      proposedCandidateCount: cappedKeys.length,
      candidateTargetIds: [],
      truncated: true,
    });
    const trainLabel = label("site-cap", ["src/a.ts#run"]);
    const stageKeys = {
      beforeVisibility: allKeys,
      afterVisibility: allKeys,
      afterExplicitReceiverType: allKeys,
      afterPeerMembers: allKeys,
      afterArgumentShape: allKeys,
      beforeMaxCandidates: allKeys,
      afterMaxCandidates: cappedKeys,
    };
    const rawEvidence = rawCandidateEvidence(
      "site-cap",
      allKeys,
      cappedKeys,
      new Map(),
    );
    const filterEvidence = stageEvidence("site-cap", stageKeys, new Map());
    const uniqueInputs = filterInputsToUniqueOracleTargets(
      [row],
      [trainLabel],
      candidateMapping(),
    );

    expect(() =>
      evaluateProposalFilterStageSplit({
        observations: [row],
        candidateStages: [rawEvidence],
        evidence: [filterEvidence],
        labels: [trainLabel],
        uniqueInputs,
        split: "train",
      }),
    ).toThrow(/first 25/u);
  });
});
