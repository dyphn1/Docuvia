import path from "node:path";
import {
  SYSTEM1_EVAL_OUTPUT_PATH,
  SYSTEM1_EVAL_OUTPUT_PATH_ERRORS,
} from "./system1-eval-constants.js";

export function system1EvalOutputDirectory(datasetDirectory: string): string {
  const resolvedDatasetDirectory = path.resolve(datasetDirectory);
  const datasetName = path.basename(resolvedDatasetDirectory);
  const versionedPrefix = `${SYSTEM1_EVAL_OUTPUT_PATH.DATASET_DIRECTORY_NAME}${SYSTEM1_EVAL_OUTPUT_PATH.VERSION_SEPARATOR}`;
  const versionSuffix = datasetName.startsWith(versionedPrefix)
    ? datasetName.slice(SYSTEM1_EVAL_OUTPUT_PATH.DATASET_DIRECTORY_NAME.length)
    : "";
  if (
    datasetName !== SYSTEM1_EVAL_OUTPUT_PATH.DATASET_DIRECTORY_NAME &&
    !versionSuffix
  )
    throw new Error(SYSTEM1_EVAL_OUTPUT_PATH_ERRORS.INVALID_DATASET_DIRECTORY);
  return path.join(
    path.dirname(resolvedDatasetDirectory),
    `${SYSTEM1_EVAL_OUTPUT_PATH.EVALUATION_DIRECTORY_NAME}${versionSuffix}`,
  );
}
