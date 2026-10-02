import { DocuviaError, ErrorCodes } from "@workspace/contracts";
import {
  SYSTEM1_LICENSE_LEAKAGE_ERROR_MESSAGE,
  SYSTEM1_SPLITS,
  SYSTEM1_USAGE,
} from "./system1-constants.js";
import type { System1Split, System1Usage } from "./system1-types.js";

/** Evaluation-only material is legal only in the sealed temporal/test holdouts. */
export function assertSystem1SplitLicense(
  split: System1Split,
  usage: System1Usage,
): void {
  if (
    usage === SYSTEM1_USAGE.EVALUATION_ONLY &&
    (split === SYSTEM1_SPLITS.TRAIN || split === SYSTEM1_SPLITS.CALIBRATION)
  )
    throw new DocuviaError(
      ErrorCodes.SEMANTIC_CORPUS_LEAKAGE,
      SYSTEM1_LICENSE_LEAKAGE_ERROR_MESSAGE,
    );
}
