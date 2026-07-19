/**
 * Files at/above this size are skipped during discovery rather than fully read and
 * handed to a parse worker. Matches GitNexus's documented oversized-file threshold,
 * so file-count comparisons between the two tools are apples-to-apples.
 */
export const MAX_FILE_SIZE_BYTES = 512_000;

/**
 * Repo-relative directories where `init`'s platform installers (`artifacts/cli/src/platforms/*`)
 * write each AI-agent platform's hook script. Shared with `DoctorWorkflow`'s agent-hooks presence
 * diagnostic (workflows/doctor-execution-flow.md's Presentation-layer-asymmetry cleanup) so both
 * sides read the same path without a `lib/ui-core` -> `artifacts/cli` dependency.
 */
export const CLAUDE_HOOKS_DIR = ".claude/hooks";
export const CURSOR_HOOKS_DIR = ".cursor/hooks";

/** Filenames of the hook script `init` writes under each platform's hooks dir above. */
export const DOCUVIA_HOOK_JS_FILENAME = "docuvia-hook.js";
export const DOCUVIA_HOOK_CJS_FILENAME = "docuvia-hook.cjs";
