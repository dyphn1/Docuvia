import { SYSTEM1_EVAL_CORPUS_MANIFEST_ERRORS } from "./system1-eval-constants.js";
import type { System1CorpusManifestReference } from "./system1-eval-types.js";

export function assertSystem1CorpusManifestPin(
  expected: System1CorpusManifestReference,
  actual: System1CorpusManifestReference,
): void {
  if (expected.path !== actual.path || expected.sha256 !== actual.sha256)
    throw new Error(SYSTEM1_EVAL_CORPUS_MANIFEST_ERRORS.PIN_MISMATCH);
}
