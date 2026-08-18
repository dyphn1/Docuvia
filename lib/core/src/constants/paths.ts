/** Core-internal shim — these workspace-layout/path constants now live in `@workspace/contracts`
 *  (shared with `lib/ui-core` and `artifacts/cli`, Virtual Contracts §8). Kept as a re-export so
 *  existing `../constants/paths.js` importers (e.g. `file-discovery.service.ts`) don't churn. */
export {
  MAX_FILE_SIZE_BYTES,
  CLAUDE_HOOKS_DIR,
  CURSOR_HOOKS_DIR,
  DOCUVIA_HOOK_JS_FILENAME,
  DOCUVIA_HOOK_CJS_FILENAME,
} from "@workspace/contracts";
