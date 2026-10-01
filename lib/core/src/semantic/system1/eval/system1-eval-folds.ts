import { SYSTEM1_EVAL_TRAINING_MODES } from "./system1-eval-constants.js";
import type {
  System1RepoFamilyFold,
  System1ScorerResponse,
  System1ScorerTrainingManifest,
} from "./system1-eval-types.js";
import type { System1DatasetRecord } from "../system1-types.js";
import { SYSTEM1_SPLITS } from "../system1-constants.js";

function normalizedFamily(repoId: string): string {
  const value = repoId
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/^git@/, "")
    .replace(/:/, "/")
    .replace(/\.git$/, "");
  const parts = value.split("/").filter(Boolean);
  return (parts.length > 2 ? parts.slice(-2) : parts).join("/");
}

/** Returns the stable owner/repository key used to partition corpus requests. */
export function system1RepoFamily(state: System1DatasetRecord): string {
  const repoId = state.request.evidence.repoId;
  if (typeof repoId !== "string" || repoId.trim().length === 0)
    throw new Error("A request is missing its repository-family identity.");
  const family = normalizedFamily(repoId);
  if (family.split("/").length !== 2)
    throw new Error(`Invalid repository-family identity: ${repoId}`);
  return family;
}

/** Creates one deterministic, family-disjoint fold for every unique family. */
export function buildSystem1RepoFamilyFolds(
  repositoryIdsOrFamilies: readonly string[],
): readonly System1RepoFamilyFold[] {
  const families = [
    ...new Set(repositoryIdsOrFamilies.map(normalizedFamily)),
  ].sort();
  if (families.length < 2)
    throw new Error("LOFO requires at least two repository families.");
  if (families.some((family) => family.split("/").length !== 2))
    throw new Error("LOFO received an invalid repository-family identity.");
  return families.map((foldFamily) => ({
    foldFamily,
    trainingFamilies: families.filter((family) => family !== foldFamily),
  }));
}

/** Builds the exact model-training declaration required by a scorer manifest. */
export function createSystem1ScorerTrainingManifest(
  mode: System1ScorerTrainingManifest["mode"],
  folds: readonly System1RepoFamilyFold[],
  allFamilies: readonly string[],
): System1ScorerTrainingManifest {
  const foldTrainingFamilies = Object.fromEntries(
    folds.map(({ foldFamily, trainingFamilies }) => [
      foldFamily,
      mode === SYSTEM1_EVAL_TRAINING_MODES.NO_TRAINING
        ? []
        : [...trainingFamilies],
    ]),
  );
  return {
    mode,
    foldTrainingFamilies,
    heldOutTrainingFamilies:
      mode === SYSTEM1_EVAL_TRAINING_MODES.NO_TRAINING
        ? []
        : [...allFamilies].sort(),
  };
}

function sameStringSet(
  actual: readonly string[] | undefined,
  expected: readonly string[],
): boolean {
  if (!actual) return false;
  const left = [...new Set(actual)].sort();
  const right = [...new Set(expected)].sort();
  return (
    actual.length === left.length &&
    left.length === right.length &&
    left.every((item, index) => item === right[index])
  );
}

function validateOutOfFoldRow(
  state: System1DatasetRecord,
  response: System1ScorerResponse & { readonly foldFamily?: string },
  familyByFold: ReadonlyMap<string, System1RepoFamilyFold>,
  manifest: System1ScorerTrainingManifest,
  seenRequestIds: Set<string>,
): void {
  const requestId = state.request.requestId;
  if (seenRequestIds.has(requestId))
    throw new Error(`Duplicate request in out-of-fold pool: ${requestId}`);
  seenRequestIds.add(requestId);
  if (response.requestId !== requestId)
    throw new Error(
      `Out-of-fold response order or request id mismatch: ${requestId}`,
    );
  const family = system1RepoFamily(state);
  if (response.foldFamily !== family)
    throw new Error(
      `OOF fold assignment does not match request family: ${requestId}`,
    );
  const fold = familyByFold.get(family);
  if (!fold) throw new Error(`Missing out-of-fold fold for ${family}.`);
  validateFoldTrainingSet(family, fold, manifest);
}

function validateFoldTrainingSet(
  family: string,
  fold: System1RepoFamilyFold,
  manifest: System1ScorerTrainingManifest,
): void {
  const declared = manifest.foldTrainingFamilies[fold.foldFamily];
  if (manifest.mode === SYSTEM1_EVAL_TRAINING_MODES.NO_TRAINING) {
    if (!sameStringSet(declared, []))
      throw new Error(`No-training fold declared training families: ${family}`);
    return;
  }
  if (declared?.includes(family))
    throw new Error(`Scorer trained on its own family for fold ${family}.`);
  if (!sameStringSet(declared, fold.trainingFamilies))
    throw new Error(
      `Fold training family declaration is incomplete: ${family}`,
    );
}

function validateFoldCoverage(
  folds: readonly System1RepoFamilyFold[],
  familyByFold: ReadonlyMap<string, System1RepoFamilyFold>,
  manifest: System1ScorerTrainingManifest,
): void {
  if (familyByFold.size !== folds.length)
    throw new Error("Duplicate fold assignment in out-of-fold pool.");
  if (Object.keys(manifest.foldTrainingFamilies).length !== folds.length)
    throw new Error(
      "Scorer manifest is missing or duplicates a fold declaration.",
    );
}

function validateHeldOutTrainingSet(
  folds: readonly System1RepoFamilyFold[],
  manifest: System1ScorerTrainingManifest,
): void {
  const expectedFamilies = folds.map(({ foldFamily }) => foldFamily).sort();
  const expectedHeldOut =
    manifest.mode === SYSTEM1_EVAL_TRAINING_MODES.FOLDED
      ? expectedFamilies
      : [];
  if (!sameStringSet(manifest.heldOutTrainingFamilies, expectedHeldOut))
    throw new Error(
      manifest.mode === SYSTEM1_EVAL_TRAINING_MODES.FOLDED
        ? "Held-out scorer must declare training on the full fitting pool."
        : "No-training scorer cannot declare held-out training families.",
    );
}

/**
 * Validates every pool row against the declared scorer training plan. Inputs
 * and responses must be in request order, which makes missing/duplicate rows
 * and fold assignments detectable before calibration sees the scores.
 */
export function validateSystem1OutOfFoldAssignments(
  states: readonly System1DatasetRecord[],
  responses: readonly (System1ScorerResponse & {
    readonly foldFamily?: string;
  })[],
  folds: readonly System1RepoFamilyFold[],
  manifest: System1ScorerTrainingManifest,
): void {
  if (states.length !== responses.length)
    throw new Error("Out-of-fold response count does not match pool requests.");
  const familyByFold = new Map(folds.map((fold) => [fold.foldFamily, fold]));
  const seenRequestIds = new Set<string>();
  for (let index = 0; index < states.length; index += 1) {
    validateOutOfFoldRow(
      states[index],
      responses[index],
      familyByFold,
      manifest,
      seenRequestIds,
    );
  }
  validateFoldCoverage(folds, familyByFold, manifest);
  validateHeldOutTrainingSet(folds, manifest);
}

/** Rejects attempts to fit or certify on sealed/evaluation-only split rows. */
export function assertSystem1FittingPoolSplits(
  splits: readonly string[],
): void {
  if (
    splits.some(
      (split) =>
        split !== SYSTEM1_SPLITS.TRAIN && split !== SYSTEM1_SPLITS.CALIBRATION,
    )
  )
    throw new Error(
      "The fitting pool accepts train and calibration splits only.",
    );
}
