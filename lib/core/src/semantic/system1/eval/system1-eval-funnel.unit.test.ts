import { describe, expect, it } from "vitest";
import { computeSystem1AccountingFunnel } from "./system1-eval-funnel.js";

describe("System-1 accounting funnel", () => {
  it("keeps row and duplicate-group counts monotone across every stage", () => {
    const result = computeSystem1AccountingFunnel("test", [
      {
        duplicateGroup: "group-a",
        exportExclusionReason: null,
        labelExclusionReason: null,
        hasCandidates: true,
        candidateMiss: false,
        committed: true,
        exact: true,
      },
      {
        duplicateGroup: "group-a",
        exportExclusionReason: null,
        labelExclusionReason: null,
        hasCandidates: true,
        candidateMiss: false,
        committed: true,
        exact: false,
      },
      {
        duplicateGroup: "group-b",
        exportExclusionReason: null,
        labelExclusionReason: "oracle-not-resolved",
        hasCandidates: true,
        candidateMiss: false,
        committed: false,
        exact: false,
      },
      {
        duplicateGroup: "group-c",
        exportExclusionReason: "caller-file-unavailable",
        labelExclusionReason: null,
        hasCandidates: false,
        candidateMiss: false,
        committed: false,
        exact: false,
      },
      {
        duplicateGroup: "group-d",
        exportExclusionReason: null,
        labelExclusionReason: null,
        hasCandidates: true,
        candidateMiss: true,
        committed: true,
        exact: false,
      },
      {
        duplicateGroup: "group-e",
        exportExclusionReason: null,
        labelExclusionReason: null,
        hasCandidates: false,
        candidateMiss: true,
        committed: false,
        exact: false,
      },
    ]);

    expect(result.rawCorpus).toEqual({ rows: 6, duplicateGroups: 5 });
    expect(result.exportExclusions).toEqual({ rows: 1, duplicateGroups: 1 });
    expect(result.trusted).toEqual({ rows: 4, duplicateGroups: 3 });
    expect(result.eligibleWithCandidates).toEqual({
      rows: 3,
      duplicateGroups: 2,
    });
    expect(result.candidateMisses).toEqual({ rows: 1, duplicateGroups: 1 });
    expect(result.candidateMissesWithoutCandidates).toEqual({
      rows: 1,
      duplicateGroups: 1,
    });
    expect(result.eligibleWithoutCandidateMiss).toEqual({
      rows: 2,
      duplicateGroups: 1,
    });
    expect(result.committed).toEqual({ rows: 2, duplicateGroups: 1 });
    expect(result.exact).toEqual({ rows: 1, duplicateGroups: 0 });
    expect(result.candidateMissCommits).toEqual({
      rows: 1,
      duplicateGroups: 1,
    });
    expect(result.untrustedLabelsByReason["oracle-not-resolved"]).toEqual({
      rows: 1,
      duplicateGroups: 1,
    });
    const stages = [
      result.rawCorpus,
      result.afterExportExclusions,
      result.trusted,
      result.eligibleWithCandidates,
      result.eligibleWithoutCandidateMiss,
      result.committed,
      result.exact,
    ];
    for (let index = 1; index < stages.length; index += 1) {
      expect(stages[index].rows).toBeLessThanOrEqual(stages[index - 1].rows);
      expect(stages[index].duplicateGroups).toBeLessThanOrEqual(
        stages[index - 1].duplicateGroups,
      );
    }
  });
});
