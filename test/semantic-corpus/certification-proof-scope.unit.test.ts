import { describe, expect, it } from "vitest";
import { partitionProofSites } from "../../scripts/semantic-corpus/certification-proof-scope.mts";

describe("frozen certification proof scope", () => {
  it("[happy][state-diff] partitions whole-source proof sites by exact frozen positions", () => {
    const inScope = {
      filePath: "src/caller.ts",
      startLine: 4,
      startColumn: 7,
      calleeName: "run",
      targetNodeKey: "src/impl.ts#run",
    };
    const outsideScope = {
      filePath: "src/other.ts",
      startLine: 8,
      startColumn: 2,
      calleeName: "load",
      targetNodeKey: "src/impl.ts#load",
    };
    const sample = {
      sampleId: "repo@rev::src/caller.ts:4:7",
      filePath: "src/caller.ts",
      line: 4,
      column: 7,
      calleeName: "run",
      duplicateGroup: "group-1",
    };

    expect(partitionProofSites([inScope, outsideScope], [sample])).toEqual({
      inScope: [{ proof: inScope, sample }],
      outsideScope: [outsideScope],
    });
  });

  it("[invalid-input] rejects duplicate frozen locations before matching proofs", () => {
    const sample = {
      sampleId: "sample-one",
      filePath: "src/caller.ts",
      line: 4,
      column: 7,
      calleeName: "run",
    };

    expect(() =>
      partitionProofSites([], [sample, { ...sample, sampleId: "sample-two" }]),
    ).toThrow("Duplicate prelabel location: sample-two");
  });

  it("[error-handling] keeps out-of-scope proofs distinct from matched sites", () => {
    const proof = {
      filePath: "src/caller.ts",
      startLine: 1,
      startColumn: 1,
      calleeName: "missing",
    };

    const result = partitionProofSites([proof], []);
    expect(result.inScope).toEqual([]);
    expect(result.outsideScope).toEqual([proof]);
  });
});
