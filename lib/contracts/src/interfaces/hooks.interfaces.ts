/**
 * Shared vocabulary for Docuvia's three toggleable automation hooks (issue #42, roadmap items
 * 32-34): `context-injection` (the PreToolUse Claude/Cursor script that shells out to `docuvia
 * query` before Grep/Glob/Bash/Read -- roadmap item 26), `commit-l3-write` (the post-commit
 * flush of agent-staged L3 decisions, Decision 2's two-stage stage-and-flush design), and
 * `tier-b-c-prepush` (the pre-push Tier B/C batch). Consumed both by the compiled CLI (`docuvia
 * hooks list/enable/disable`, `lib/ui-core`'s `HooksWorkflow`) and by raw, dependency-free
 * platform scripts written to disk (`artifacts/cli/src/constants/init-templates.ts`'s
 * `DOCUVIA_HOOK_JS`) -- those scripts can't `import` this module at runtime (no
 * `@workspace/contracts` inside a standalone `.js` hook file), so `init-templates.ts` interpolates
 * the resolved literal string values in at template-build time instead; see that file's own doc
 * comment.
 */
export const HookNames = {
  CONTEXT_INJECTION: "context-injection",
  COMMIT_L3_WRITE: "commit-l3-write",
  TIER_B_C_PREPUSH: "tier-b-c-prepush",
} as const;
export type HookName = (typeof HookNames)[keyof typeof HookNames];

export type HooksConfig = Record<HookName, boolean>;

/** Per Decision 2/roadmap item 34: `commit-l3-write` ships enabled by default (matches Docuvia's
 *  incremental-accumulation philosophy). `context-injection` and `tier-b-c-prepush` are pre-
 *  existing, always-on behaviors this issue is retrofitting a toggle onto -- also default enabled,
 *  so `docuvia hooks list` on an already-set-up repo reports the status quo, not a surprise
 *  opt-out. */
export const DEFAULT_HOOKS_CONFIG: HooksConfig = {
  [HookNames.CONTEXT_INJECTION]: true,
  [HookNames.COMMIT_L3_WRITE]: true,
  [HookNames.TIER_B_C_PREPUSH]: true,
};
