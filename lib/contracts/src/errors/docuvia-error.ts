import type { ErrorCode } from "./error-codes.js";

const DOCUVIA_ERROR_NAME = "DocuviaError" as const;

/**
 * The single base error class used across the entire workspace — see
 * docs/gitbook/architecture/error-handling-architecture.md's "Catch, Wrap, and Bubble"
 * pipeline. Implementation libraries catch a native/third-party error, map it to an
 * `ErrorCode`, and throw a `DocuviaError` wrapping the original as `cause`. Only the
 * Presentation layer is allowed to log one.
 */
export class DocuviaError extends Error {
  public readonly code: ErrorCode;
  public readonly cause?: unknown;

  constructor(code: ErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = DOCUVIA_ERROR_NAME;
    this.code = code;
    this.cause = cause;
  }

  static wrap(code: ErrorCode, message: string, cause: unknown): DocuviaError {
    if (cause instanceof DocuviaError) return cause;
    const causeMessage = cause instanceof Error ? cause.message : String(cause);
    return new DocuviaError(code, `${message}: ${causeMessage}`, cause);
  }
}
