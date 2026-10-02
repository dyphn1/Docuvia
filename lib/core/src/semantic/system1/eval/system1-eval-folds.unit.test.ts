import { describe, expect, it } from "vitest";
import {
  buildSystem1RepoFamilyFolds,
  createSystem1ScorerTrainingManifest,
  system1RepoFamily,
  validateSystem1OutOfFoldAssignments,
} from "./system1-eval-folds.js";
import type { System1DatasetRecord } from "../system1-types.js";
import type { System1ScorerResponse } from "./system1-eval-types.js";

function state(requestId: string, repoId: string): System1DatasetRecord {
  return {
    request: { requestId, evidence: { repoId } },
  } as unknown as System1DatasetRecord;
}

function response(requestId: string, foldFamily: string) {
  return {
    requestId,
    foldFamily,
    status: "ok",
    scoreKind: "raw",
    scores: {},
  } as System1ScorerResponse & { readonly foldFamily: string };
}

describe("System-1 repository-family folds", () => {
  it("[happy] constructs deterministic disjoint folds for each family", () => {
    const families = ["z/repo", "a/repo", "m/repo", "a/repo"];
    const folds = buildSystem1RepoFamilyFolds(families);
    expect(folds).toEqual(buildSystem1RepoFamilyFolds([...families].reverse()));
    expect(folds.map(({ foldFamily }) => foldFamily)).toEqual([
      "a/repo",
      "m/repo",
      "z/repo",
    ]);
    for (const fold of folds) {
      expect(fold.trainingFamilies).not.toContain(fold.foldFamily);
      expect(fold.trainingFamilies.length).toBe(families.length - 2);
    }
  });

  it("normalizes repository identity to owner/repository", () => {
    expect(system1RepoFamily(state("r1", "github.com/Acme/Repo.git"))).toBe(
      "Acme/Repo",
    );
  });

  it("[invalid-input] [error-handling] rejects an out-of-fold row when its family was in fold training", () => {
    const folds = buildSystem1RepoFamilyFolds(["acme/a", "acme/b"]);
    expect(() =>
      validateSystem1OutOfFoldAssignments(
        [state("r1", "github.com/acme/a")],
        [response("r1", "acme/a")],
        folds,
        {
          mode: "folded",
          foldTrainingFamilies: {
            "acme/a": ["acme/a"],
            "acme/b": ["acme/a"],
          },
          heldOutTrainingFamilies: ["acme/a", "acme/b"],
        },
      ),
    ).toThrow(/trained on its own family/i);
  });

  it("[invalid-input] [error-handling] rejects missing, duplicated, or wrong fold assignments", () => {
    const folds = buildSystem1RepoFamilyFolds(["acme/a", "acme/b"]);
    const declaration = {
      mode: "no-training" as const,
      foldTrainingFamilies: { "acme/a": [], "acme/b": [] },
      heldOutTrainingFamilies: [],
    };
    expect(() =>
      validateSystem1OutOfFoldAssignments(
        [state("r1", "github.com/acme/a")],
        [],
        folds,
        declaration,
      ),
    ).toThrow(/response count/i);
    expect(() =>
      validateSystem1OutOfFoldAssignments(
        [state("r1", "github.com/acme/a")],
        [response("r1", "acme/b")],
        folds,
        declaration,
      ),
    ).toThrow(/does not match request family/i);
    expect(() =>
      validateSystem1OutOfFoldAssignments(
        [state("r1", "github.com/acme/a"), state("r1", "github.com/acme/a")],
        [response("r1", "acme/a"), response("r1", "acme/a")],
        folds,
        declaration,
      ),
    ).toThrow(/duplicate request/i);
    expect(() =>
      validateSystem1OutOfFoldAssignments(
        [state("r1", "github.com/acme/a")],
        [response("r1", "acme/a")],
        [...folds, folds[0]],
        declaration,
      ),
    ).toThrow(/duplicate fold/i);
    expect(() =>
      validateSystem1OutOfFoldAssignments(
        [state("r1", "github.com/acme/a")],
        [response("r1", "acme/a")],
        folds,
        {
          ...declaration,
          foldTrainingFamilies: { "acme/a": [] },
        },
      ),
    ).toThrow(/missing or duplicates a fold declaration/i);
  });

  it("accepts no-training baselines while requiring the complete declared learned plan", () => {
    const folds = buildSystem1RepoFamilyFolds(["acme/a", "acme/b"]);
    const states = [
      state("a-1", "github.com/acme/a"),
      state("b-1", "github.com/acme/b"),
    ];
    const responses = [response("a-1", "acme/a"), response("b-1", "acme/b")];
    const baseline = createSystem1ScorerTrainingManifest("no-training", folds, [
      "acme/a",
      "acme/b",
    ]);
    validateSystem1OutOfFoldAssignments(states, responses, folds, baseline);

    const learned = createSystem1ScorerTrainingManifest("folded", folds, [
      "acme/a",
      "acme/b",
    ]);
    validateSystem1OutOfFoldAssignments(states, responses, folds, learned);
    expect(() =>
      validateSystem1OutOfFoldAssignments(states, responses, folds, {
        ...learned,
        heldOutTrainingFamilies: ["acme/a"],
      }),
    ).toThrow(/full fitting pool/i);
  });
});
