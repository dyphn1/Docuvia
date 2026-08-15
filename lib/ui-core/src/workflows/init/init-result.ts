import type { AstParseFailure } from "@workspace/contracts";
import { INIT_MESSAGES } from "./init-messages.js";

export interface InitResult {
  success: boolean;
  partialFailure: boolean;
  message: string;
  filesRequested: number;
  filesParsed: number;
  filesFailed: number;
  failures: AstParseFailure[];
  filesSkippedOversized: number;
  /** true when `execute()` took the light "already initialized" path (roadmap item 35 / issue
   *  #43) -- discovery/parse/persist were skipped entirely because a populated graph already
   *  existed. `filesRequested`/`filesParsed`/etc. are all 0 in this case, which is NOT the same
   *  as "0 files found to parse" (a genuinely-empty repo) -- callers that care about the
   *  distinction should check this flag, not infer it from the zeroed counts. */
  skippedExistingGraph: boolean;
}

/** Success/partial-failure message selection: a parse failure takes precedence over an oversized-skip note, which in turn takes precedence over the plain success message. */
export function buildInitResult(input: {
  filesRequested: number;
  filesParsed: number;
  filesFailed: number;
  failures: AstParseFailure[];
  filesSkippedOversized: number;
}): InitResult {
  const {
    filesRequested,
    filesParsed,
    filesFailed,
    failures,
    filesSkippedOversized,
  } = input;

  const message =
    filesFailed > 0
      ? INIT_MESSAGES.PARTIAL_SUCCESS(filesFailed, filesRequested)
      : filesSkippedOversized > 0
        ? INIT_MESSAGES.SUCCESS_WITH_SKIPPED_OVERSIZED(filesSkippedOversized)
        : INIT_MESSAGES.SUCCESS;

  return {
    success: true,
    partialFailure: filesFailed > 0,
    message,
    filesRequested,
    filesParsed,
    filesFailed,
    failures,
    filesSkippedOversized,
    skippedExistingGraph: false,
  };
}

/** Result for `execute()`'s light "already initialized" path (roadmap item 35 / issue #43) --
 *  no discovery/parse/persist ran, so every file-count field is 0 (see `skippedExistingGraph`'s
 *  own doc comment for why that's not the same as an empty-repo full ingestion). */
export function buildSkippedInitResult(): InitResult {
  return {
    success: true,
    partialFailure: false,
    message: INIT_MESSAGES.ALREADY_INITIALIZED,
    filesRequested: 0,
    filesParsed: 0,
    filesFailed: 0,
    failures: [],
    filesSkippedOversized: 0,
    skippedExistingGraph: true,
  };
}
