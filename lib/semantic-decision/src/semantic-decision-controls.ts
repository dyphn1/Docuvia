import {
  DocuviaError,
  ErrorCodes,
  type SemanticDecisionCallOptions,
} from "@workspace/contracts";

function isValidDeadline(value: unknown): boolean {
  return (
    value === undefined ||
    (typeof value === "number" && Number.isSafeInteger(value) && value >= 0)
  );
}

function isValidControls(value: unknown): value is SemanticDecisionCallOptions {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return false;
  const options = value as Record<string, unknown>;
  if (
    !Reflect.ownKeys(options).every(
      (key) => key === "deadlineUnixMs" || key === "signal",
    )
  )
    return false;
  return (
    isValidDeadline(options.deadlineUnixMs) &&
    (options.signal === undefined || options.signal instanceof AbortSignal)
  );
}

/** The no-runtime provider does no asynchronous work; runtime supervision is a Phase 3 gate. */
export function checkSemanticDecisionControls(
  options?: SemanticDecisionCallOptions,
): void {
  if (options === undefined) return;
  if (!isValidControls(options)) {
    throw new DocuviaError(
      ErrorCodes.SEMANTIC_INVALID_REQUEST,
      "Invalid semantic decision call controls",
    );
  }
  if (options.signal?.aborted) {
    throw new DocuviaError(
      ErrorCodes.SEMANTIC_CANCELLED,
      "Semantic decision call cancelled",
    );
  }
  if (
    options.deadlineUnixMs !== undefined &&
    options.deadlineUnixMs <= Date.now()
  ) {
    throw new DocuviaError(
      ErrorCodes.SEMANTIC_DEADLINE_EXCEEDED,
      "Semantic decision deadline exceeded",
    );
  }
}
