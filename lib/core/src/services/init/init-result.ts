import type { AstParseFailure } from "../../interfaces/analyzer.interfaces.js";
import { INIT_SERVICE_MESSAGES } from "../../constants/init-service-messages.js";

/** Shared result shape, matching old `InitService.init()`'s return value exactly (field names
 *  and semantics, including `success` always being `true` — old `init()` never returned
 *  `success: false`; unrecoverable failures throw instead). */
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

/**
 * Builds the final `InitResult`, including old `InitService.init()`'s success/partial-failure
 * message-selection logic: a parse failure takes precedence over an oversized-skip note, which
 * in turn takes precedence over the plain success message.
 */
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
      ? INIT_SERVICE_MESSAGES.PARTIAL_SUCCESS(filesFailed, filesRequested)
      : filesSkippedOversized > 0
        ? INIT_SERVICE_MESSAGES.SUCCESS_WITH_SKIPPED_OVERSIZED(filesSkippedOversized)
        : INIT_SERVICE_MESSAGES.SUCCESS;

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
