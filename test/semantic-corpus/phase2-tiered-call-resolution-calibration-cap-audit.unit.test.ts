import { describe, expect, it } from "vitest";
import {
  assertCalibrationAuditRows,
  assertCalibrationParserEvidence,
  measureCalibrationCapAudit,
  type CalibrationCandidateRow,
} from "../../scripts/semantic-corpus/phase2-tiered-call-resolution-calibration-cap-audit.mjs";

function row(
  sampleId: string,
  patch: Partial<CalibrationCandidateRow> = {},
): CalibrationCandidateRow {
  return {
    sampleId,
    split: "calibration",
    repoFamily: "fixture-family",
    calleeKind: "member",
    evidenceKind: "receiver-local-with-peers",
    confirmed: true,
    goldTargetIds: ["gold"],
    generatedTargetIdsInOrder: ["gold"],
    beforeMaxTargetIdsInOrder: ["gold"],
    ...patch,
  };
}

describe("CALIBRATION candidate cap audit", () => {
  it("[error-handling] fails closed on excluded positions, missing facts, or null hashes", () => {
    const evidence = {
      positionStatus: "unique",
      exactParserFact: true,
      sourceContentHash: "a".repeat(64),
      callSiteInputHash: "b".repeat(64),
    };
    expect(() => assertCalibrationParserEvidence([evidence], 1)).not.toThrow();
    for (const patch of [
      { positionStatus: "excluded" },
      { exactParserFact: false },
      { sourceContentHash: null },
      { callSiteInputHash: null },
    ])
      expect(() =>
        assertCalibrationParserEvidence([{ ...evidence, ...patch }], 1),
      ).toThrow("every exact parser fact");
    expect(() => assertCalibrationParserEvidence([evidence], 2)).toThrow(
      "every exact parser fact",
    );
  });

  it("[happy] retains every site in zero/size distributions and counts unique targets", () => {
    const rows = [
      row("one", {
        generatedTargetIdsInOrder: [null, "other", "gold", "gold"],
        beforeMaxTargetIdsInOrder: [null, "other", "gold", "gold"],
      }),
      row("unscorable", {
        confirmed: false,
        goldTargetIds: [],
        generatedTargetIdsInOrder: [],
        beforeMaxTargetIdsInOrder: [],
      }),
    ];
    const result = measureCalibrationCapAudit(rows, [2, 3, 4]);
    expect(result.raw.overall).toMatchObject({
      allSiteCount: 2,
      goldTargetOccurrences: 1,
      coveredGoldTargetOccurrences: 1,
      keyMemberships: 4,
      mappedMemberships: 2,
      keyZeroSites: 1,
      mappedZeroSites: 1,
      keySize: { p50: 0, p95: 4, max: 4 },
      mappedSize: { p50: 0, p95: 2, max: 2 },
    });
    expect(
      result.caps.map(({ overall }) => overall.coveredGoldTargetOccurrences),
    ).toEqual([0, 1, 1]);
    expect(result.caps[2]!.overall.mappedMemberships).toBe(2);
    expect(result.caps[0]!.byFamilyCallShape[0]!.allSiteCount).toBe(2);
    expect(result.caps[0]!.byFamilyCallShapeEvidence[0]!.allSiteCount).toBe(2);
  });

  it("does not count an unconfirmed positive toward recall", () => {
    const result = measureCalibrationCapAudit(
      [row("uncertain", { confirmed: false })],
      [25],
    );
    expect(result.raw.overall.goldTargetOccurrences).toBe(0);
    expect(result.raw.overall.candidateRecall).toBeNull();
    expect(result.caps[0]!.overall.allSiteCount).toBe(1);
  });

  it("[invalid-input] rejects split contamination and duplicate or incomplete IDs", () => {
    expect(() =>
      measureCalibrationCapAudit([row("held", { split: "test" })], [25]),
    ).toThrow("CALIBRATION-only");
    expect(() =>
      assertCalibrationAuditRows([row("one"), row("one")], new Set(["one"])),
    ).toThrow("complete unique");
    expect(() =>
      assertCalibrationAuditRows([row("one")], new Set(["one", "missing"])),
    ).toThrow("complete unique");
  });

  it("[invalid-input] rejects invalid caps and duplicate gold target IDs", () => {
    expect(() => measureCalibrationCapAudit([row("one")], [0])).toThrow(
      "positive integer",
    );
    expect(() =>
      measureCalibrationCapAudit(
        [row("one", { goldTargetIds: ["gold", "gold"] })],
        [25],
      ),
    ).toThrow("unique gold");
  });
});
