/**
 * Repo-relative directories where `init`'s platform installers (`artifacts/cli/src/platforms/*`)
 * write each AI-agent platform's hook script. Shared with `DoctorWorkflow`'s agent-hooks presence
 * diagnostic (workflows/doctor-execution-flow.md's Presentation-layer-asymmetry cleanup) so both
 * sides read the same path. Moved here from `lib/core` (issue #69) so the Presentation layer only
 * ever imports `@workspace/contracts` for plain constants.
 */
export const CLAUDE_HOOKS_DIR = ".claude/hooks";
export const CURSOR_HOOKS_DIR = ".cursor/hooks";

/** Filenames of the hook script `init` writes under each platform's hooks dir above. */
export const DOCUVIA_HOOK_JS_FILENAME = "docuvia-hook.js";
export const DOCUVIA_HOOK_CJS_FILENAME = "docuvia-hook.cjs";
