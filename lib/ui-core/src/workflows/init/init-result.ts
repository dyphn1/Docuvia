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
}

/** Success/partial-failure message selection: a parse failure takes precedence over an oversized-skip note, which in turn takes precedence over the plain success message. */
export function buildInitResult(input: {
  filesRequested: number;
  filesParsed: number;
  filesFailed: number;
  failures: AstParseFailure[];
  filesSkippedOversized: number;
}): InitResult {
  const { filesRequested, filesParsed, filesFailed, failures, filesSkippedOversized } = input;

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
  };
}
