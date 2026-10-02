import type { SemanticCorpusSplit } from "@workspace/contracts";
import { SYSTEM1_JSON_LINE_ENDING } from "./system1-constants.js";
import { system1RequestId } from "./system1-state-builder.js";

export interface System1ExcludedSample {
  readonly sampleId: string;
  readonly requestId: string;
  readonly split: SemanticCorpusSplit;
  readonly reason: string;
}

export function createSystem1ExclusionRecord(
  sampleId: string,
  split: SemanticCorpusSplit,
  reason: string,
): System1ExcludedSample {
  return {
    sampleId,
    requestId: system1RequestId(sampleId),
    split,
    reason,
  };
}

export function serializeSystem1Exclusions(
  records: readonly System1ExcludedSample[],
): string {
  return records.length === 0
    ? ""
    : `${[...records]
        .sort((left, right) =>
          left.requestId < right.requestId
            ? -1
            : left.requestId > right.requestId
              ? 1
              : left.sampleId < right.sampleId
                ? -1
                : left.sampleId > right.sampleId
                  ? 1
                  : 0,
        )
        .map((record) => JSON.stringify(record))
        .join(SYSTEM1_JSON_LINE_ENDING)}${SYSTEM1_JSON_LINE_ENDING}`;
}
