import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  SYSTEM1_DATASET_IMPACT_FILE_NAME,
  SYSTEM1_DATASET_IMPACT_FIELD_NAMES,
  SYSTEM1_DATASET_IMPACT_SCHEMA,
  SYSTEM1_DATASET_V2_DIRECTORY,
  SYSTEM1_DATASET_IMPACT_ERRORS,
  SYSTEM1_FEATURE_SCHEMA_VERSION,
  SYSTEM1_FILE_NAMES,
  SYSTEM1_JSON_LINE_ENDING,
  SYSTEM1_PARTITIONS,
  SYSTEM1_PREVIOUS_DATASET_DIRECTORY,
  SYSTEM1_PREVIOUS_FEATURE_SCHEMA_VERSION,
  SYSTEM1_SPLITS,
} from "../../lib/core/src/semantic/system1/system1-constants.js";
import { compareSystem1DatasetEvidence } from "../../lib/core/src/semantic/system1/eval/system1-dataset-impact.js";
import type {
  System1DatasetRecord,
  System1Split,
} from "../../lib/core/src/semantic/system1/system1-types.js";

const REPOSITORY_ROOT = path.resolve(import.meta.dirname, "../..");
const UTF8 = "utf8";
const SHA256 = "sha256";

function stateRecords(file: string): System1DatasetRecord[] {
  const contents = readFileSync(file, UTF8);
  const lines = contents.split(SYSTEM1_JSON_LINE_ENDING);
  if (lines.at(-1) === "") lines.pop();
  if (lines.some((line) => line.length === 0))
    throw new Error(SYSTEM1_DATASET_IMPACT_ERRORS.BLANK_STATE_ROW);
  return lines.map((line) => JSON.parse(line) as System1DatasetRecord);
}

function stateFile(directory: string, split: System1Split): string {
  return path.join(directory, SYSTEM1_FILE_NAMES.STATE(split));
}

function sha256(file: string): string {
  return createHash(SHA256).update(readFileSync(file)).digest("hex");
}

function stableJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}${SYSTEM1_JSON_LINE_ENDING}`;
}

const baselineDirectory = path.join(
  REPOSITORY_ROOT,
  SYSTEM1_PREVIOUS_DATASET_DIRECTORY,
);
const updatedDirectory = path.join(
  REPOSITORY_ROOT,
  SYSTEM1_DATASET_V2_DIRECTORY,
);
const bySplit = Object.fromEntries(
  SYSTEM1_PARTITIONS.map((split) => {
    const baselineFile = stateFile(baselineDirectory, split);
    const updatedFile = stateFile(updatedDirectory, split);
    const impact = compareSystem1DatasetEvidence(
      stateRecords(baselineFile),
      stateRecords(updatedFile),
    );
    return [
      split,
      {
        ...impact,
        baselineStateSha256: sha256(baselineFile),
        updatedStateSha256: sha256(updatedFile),
      },
    ];
  }),
) as Record<System1Split, unknown>;

const report = {
  schema: SYSTEM1_DATASET_IMPACT_SCHEMA,
  baselineFeatureSchemaVersion: SYSTEM1_PREVIOUS_FEATURE_SCHEMA_VERSION,
  updatedFeatureSchemaVersion: SYSTEM1_FEATURE_SCHEMA_VERSION,
  labelsRead: false,
  decisionSplits: [SYSTEM1_SPLITS.TRAIN, SYSTEM1_SPLITS.CALIBRATION],
  heldOutSplitsReportedOnly: [SYSTEM1_SPLITS.TEMPORAL, SYSTEM1_SPLITS.TEST],
  comparedCandidateFields: [
    SYSTEM1_DATASET_IMPACT_FIELD_NAMES.DECLARATION_KIND,
    SYSTEM1_DATASET_IMPACT_FIELD_NAMES.SIGNATURE,
    SYSTEM1_DATASET_IMPACT_FIELD_NAMES.EVIDENCE_STATUS,
  ],
  bySplit,
};

const outputFile = path.join(
  updatedDirectory,
  SYSTEM1_DATASET_IMPACT_FILE_NAME,
);
writeFileSync(outputFile, stableJson(report), UTF8);
process.stdout.write(stableJson({ outputFile, report }));
