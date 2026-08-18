import { DocuviaError } from "@workspace/contracts";

/**
 * Extracts a user-displayable message from any thrown value -- `DocuviaError` (and any `Error`)
 * surface `.message`, anything else (a string, an object, `undefined`) is stringified. Extracted
 * from each command's `catch` so its `instanceof`-`||`-ternary doesn't count toward the command's
 * cyclomatic complexity budget, and so all commands report the same message for the same error.
 */
export function resolveErrorMessage(error: unknown): string {
  return error instanceof DocuviaError || error instanceof Error
    ? error.message
    : String(error);
}
