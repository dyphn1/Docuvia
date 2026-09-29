import { describe, expect, it } from "vitest";
import { SemanticCorpusService } from "../semantic-corpus-service.js";
import {
  buildCorpusSample,
  type CorpusSampleParts,
} from "./semantic-sample-builder.js";

// TDD-SOURCE: docs/gitbook/analysis/semantic-decision-phase1-collection.md#c-04--population-and-independent-evidence
const hash = "a".repeat(64);
const parts = (
  overrides: Partial<CorpusSampleParts> = {},
): CorpusSampleParts => ({
  repo: {
    repoId: "github.com/o/r",
    repoFamily: "o/r",
    revision: "f".repeat(40),
    license: "MIT",
    usage: "training-and-evaluation",
  },
  projectId: "tsconfig.json",
  callSite: {
    filePath: "src/c.ts",
    line: 4,
    column: 2,
    calleeName: "run",
    calleeKind: "bare",
  },
  snapshotHashes: { source: hash, oracle: hash, review: hash },
  duplicateGroup: "g1",
  split: "train",
  candidates: {
    candidates: [
      { id: "tierA:1", targetId: "src/a.ts#run" },
      { id: "tierA:2", targetId: "src/b.ts#run" },
    ],
    truncated: false,
    matchCount: 2,
  },
  oracle: {
    status: "resolved",
    targetIds: ["src/a.ts#run"],
    unmappedLocations: 0,
    server: "typescript-language-server",
    version: "5.3.0",
    configHash: "b".repeat(64),
  },
  checker: {
    version: "5.9.3",
    declarations: [
      {
        nodeKey: "src/a.ts#run",
        ref: {
          filePath: "src/a.ts",
          name: "run",
          startLine: 1,
          nameLine: 1,
          concrete: true,
        },
      },
    ],
  },
  audit: { kind: "match", filePath: "src/a.ts" },
  ...overrides,
});
const label = (value: unknown) => new SemanticCorpusService().label(value);

describe("corpus sample builder", () => {
  it("[happy] builds a valid ready sample with checker positives and bare-call negatives", () => {
    const sample = buildCorpusSample(parts());
    expect(sample.sampleId).toBe("github.com/o/r@ffffffffffff::src/c.ts:4:2");
    expect(sample.review).toEqual({
      status: "confirmed",
      snapshotHash: hash,
      positiveTargetIds: ["src/a.ts#run"],
      negativeTargetIds: ["src/b.ts#run"],
      evidenceRefs: [
        "ts-checker:typescript@5.9.3:src/a.ts:L1",
        "source-audit:match:src/a.ts",
      ],
    });
    expect(label(sample)).toMatchObject({
      reason: "ready",
      missingTargetIds: [],
    });
  });

  it("[negative] receiver calls and non-concrete declarations get no negatives", () => {
    const member = buildCorpusSample(
      parts({ callSite: { ...parts().callSite, calleeKind: "member" } }),
    );
    expect(member.review.negativeTargetIds).toEqual([]);
    const signature = buildCorpusSample(
      parts({
        checker: {
          version: "5.9.3",
          declarations: [
            {
              ...parts().checker.declarations[0],
              ref: { ...parts().checker.declarations[0].ref, concrete: false },
            },
          ],
        },
      }),
    );
    expect(signature.review.negativeTargetIds).toEqual([]);
  });

  it("[state-diff] an audit mismatch quarantines the sample as a conflict", () => {
    const sample = buildCorpusSample(
      parts({ audit: { kind: "mismatch", filePath: "src/b.ts" } }),
    );
    expect(sample.review.status).toBe("conflict");
    expect(label(sample).reason).toBe("label-conflict");
  });

  it("[boundary] a gold target missing from the candidates stays a visible miss", () => {
    const sample = buildCorpusSample(
      parts({
        candidates: { candidates: [], truncated: false, matchCount: 0 },
      }),
    );
    expect(label(sample)).toMatchObject({
      reason: "ready",
      missingTargetIds: ["src/a.ts#run"],
    });
  });

  it("[error-handling] oracle failures and stale snapshots keep their own reasons", () => {
    const failed = buildCorpusSample(
      parts({
        oracle: { ...parts().oracle, status: "timeout", targetIds: [] },
      }),
    );
    expect(label(failed).reason).toBe("oracle-failure");
    const stale = buildCorpusSample(
      parts({
        snapshotHashes: { source: hash, oracle: "c".repeat(64), review: hash },
      }),
    );
    expect(label(stale).reason).toBe("freshness-mismatch");
  });

  it("[invalid-input] same-file checker declarations never become gold", () => {
    const sample = buildCorpusSample(
      parts({
        checker: {
          version: "5.9.3",
          declarations: [
            ...parts().checker.declarations,
            {
              nodeKey: "src/c.ts#run",
              ref: {
                filePath: "src/c.ts",
                name: "run",
                startLine: 9,
                nameLine: 9,
                concrete: true,
              },
            },
          ],
        },
      }),
    );
    expect(sample.review.positiveTargetIds).toEqual(["src/a.ts#run"]);
  });
});
