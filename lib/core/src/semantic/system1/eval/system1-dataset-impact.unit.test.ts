import { describe, expect, it } from "vitest";
import type { System1DatasetRecord } from "../system1-types.js";
import { compareSystem1DatasetEvidence } from "./system1-dataset-impact.js";

function state(
  requestId: string,
  repoId: string,
  candidates: readonly {
    readonly id: string;
    readonly targetId: string;
    readonly signature: string;
    readonly declarationKind: string;
    readonly evidenceStatus: string;
  }[],
): System1DatasetRecord {
  return {
    request: {
      requestId,
      evidence: { repoId },
      options: candidates.map((candidate) => ({
        id: candidate.id,
        kind: "candidate",
        text: candidate.signature,
        attributes: {
          targetId: candidate.targetId,
          declarationKind: candidate.declarationKind,
          evidenceStatus: candidate.evidenceStatus,
        },
      })),
    },
  } as unknown as System1DatasetRecord;
}

describe("System-1 dataset evidence impact", () => {
  it("counts changed samples, candidates, fields, and repository families", () => {
    const before = [
      state("request-a", "github.com/acme/alpha", [
        {
          id: "candidate-a",
          targetId: "src/a.ts#run",
          signature: "run(): void",
          declarationKind: "unknown",
          evidenceStatus: "missing",
        },
        {
          id: "candidate-b",
          targetId: "src/b.ts#run",
          signature: "consume(): void",
          declarationKind: "method",
          evidenceStatus: "present",
        },
        {
          id: "candidate-c",
          targetId: "src/c.ts#run",
          signature: "before(): void",
          declarationKind: "method",
          evidenceStatus: "present",
        },
        {
          id: "candidate-d",
          targetId: "src/d.ts#run",
          signature: "call(): void",
          declarationKind: "function",
          evidenceStatus: "present",
        },
      ]),
      state("request-b", "github.com/acme/beta", [
        {
          id: "candidate-c",
          targetId: "src/c.ts#run",
          signature: "run(): void",
          declarationKind: "function",
          evidenceStatus: "present",
        },
      ]),
    ];
    const after = [
      state("request-a", "github.com/acme/alpha", [
        {
          id: "candidate-a",
          targetId: "src/a.ts#run",
          signature: "run(value: string): string",
          declarationKind: "method",
          evidenceStatus: "present",
        },
        {
          id: "candidate-b",
          targetId: "src/b.ts#run",
          signature: "",
          declarationKind: "unknown",
          evidenceStatus: "missing",
        },
        {
          id: "candidate-c",
          targetId: "src/c.ts#run",
          signature: "after(): void",
          declarationKind: "method",
          evidenceStatus: "present",
        },
        {
          id: "candidate-d",
          targetId: "src/d.ts#run",
          signature: "call(): void",
          declarationKind: "method",
          evidenceStatus: "present",
        },
      ]),
      state("request-b", "github.com/acme/beta", [
        {
          id: "candidate-c",
          targetId: "src/c.ts#run",
          signature: "run(): void",
          declarationKind: "function",
          evidenceStatus: "present",
        },
      ]),
    ];

    expect(compareSystem1DatasetEvidence(before, after)).toEqual({
      rowCount: 2,
      candidateCount: 5,
      changedRowCount: 1,
      changedCandidateCount: 4,
      changedDeclarationKindCandidateCount: 3,
      changedSignatureCandidateCount: 3,
      changedEvidenceStatusCandidateCount: 2,
      evidencePresentToMissingCandidateCount: 1,
      evidenceMissingToPresentCandidateCount: 1,
      textOnlyChangedCandidateCount: 1,
      byFamily: {
        "acme/alpha": {
          rowCount: 1,
          candidateCount: 4,
          changedRowCount: 1,
          changedCandidateCount: 4,
          changedDeclarationKindCandidateCount: 3,
          changedSignatureCandidateCount: 3,
          changedEvidenceStatusCandidateCount: 2,
          evidencePresentToMissingCandidateCount: 1,
          evidenceMissingToPresentCandidateCount: 1,
          textOnlyChangedCandidateCount: 1,
        },
        "acme/beta": {
          rowCount: 1,
          candidateCount: 1,
          changedRowCount: 0,
          changedCandidateCount: 0,
          changedDeclarationKindCandidateCount: 0,
          changedSignatureCandidateCount: 0,
          changedEvidenceStatusCandidateCount: 0,
          evidencePresentToMissingCandidateCount: 0,
          evidenceMissingToPresentCandidateCount: 0,
          textOnlyChangedCandidateCount: 0,
        },
      },
    });
  });

  it("rejects candidate identity changes instead of counting them as evidence deltas", () => {
    const before = state("request-a", "github.com/acme/alpha", [
      {
        id: "candidate-a",
        targetId: "src/a.ts#run",
        signature: "run(): void",
        declarationKind: "method",
        evidenceStatus: "present",
      },
    ]);
    const after = state("request-a", "github.com/acme/alpha", [
      {
        id: "candidate-a",
        targetId: "src/other.ts#run",
        signature: "run(): void",
        declarationKind: "method",
        evidenceStatus: "present",
      },
    ]);

    expect(() => compareSystem1DatasetEvidence([before], [after])).toThrow(
      "candidate target ids differ",
    );
  });
});
