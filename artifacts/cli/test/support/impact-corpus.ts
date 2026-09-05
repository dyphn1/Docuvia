/**
 * Issue #192's regression corpus: a synthetic mini-repo whose dependency structure is fully
 * human-labeled (GOLDEN_CASES below), covering both edges the static graph models (controls)
 * and its four documented blind spots (AGENTS.md:128 / docs/gitbook/user-guide/cli/impact.md
 * "What counts as a dependency edge"):
 *
 *   1. runtime-variable import      (`import()` of a specifier built from a variable)
 *   2. computed import() specifier  (template-literal module path)
 *   3. re-export chain              (barrel re-export between the definition and the caller)
 *   4. child_process spawn          (execFile of another project file)
 *
 * Plus the gap issue #217's `ast_call_sites` fallback is meant to close but currently does
 * not -- kept as a failing row on purpose so the miss stays visible (see the case's own
 * comment for the dotted-vs-bare `target_function` mismatch behind it):
 *
 *   5. unresolved receiver call     (cross-file method call on a value whose type
 *                                    ScopeResolver can't resolve, so no static edge is built)
 *
 * Files live as inline strings (not fixture files in a source tree) so intentional dynamic-
 * import patterns never enter typecheck/lint's purview. Symbol names are `eval`-prefixed to be
 * globally unique -- impact resolves targets by exact-then-LIKE name match.
 */

export const CORPUS_FILES: Record<string, string> = {
  "package.json": JSON.stringify({ name: "impact-eval-corpus" }, null, 2),

  // ── Case 1 (control): static call edge ────────────────────────────────────
  "src/math-utils.ts": [
    "export function evalAdd(a: number, b: number): number {",
    "  return a + b;",
    "}",
    "",
  ].join("\n"),
  "src/calculator.ts": [
    'import { evalAdd } from "./math-utils";',
    "",
    "export function runCalc(): number {",
    "  return evalAdd(2, 3);",
    "}",
    "",
  ].join("\n"),

  // ── Case 2 (blind-spot candidate): plain value import with no call site ──
  "src/config.ts": ["export const EVAL_MAX_RETRIES = 3;", ""].join("\n"),
  "src/client.ts": [
    'import { EVAL_MAX_RETRIES } from "./config";',
    "",
    "export function evalFetchWithRetry(): string {",
    '  return EVAL_MAX_RETRIES > 0 ? "retry" : "once";',
    "}",
    "",
  ].join("\n"),

  // ── Case 3: re-export chain between the definition and the caller ────────
  "src/deep/util.ts": [
    "export function evalChainHelper(): string {",
    '  return "chained";',
    "}",
    "",
  ].join("\n"),
  "src/mid/index.ts": [
    'export { evalChainHelper } from "../deep/util";',
    "",
  ].join("\n"),
  "src/app-main.ts": [
    'import { evalChainHelper } from "./mid";',
    "",
    "export function runApp(): string {",
    "  return evalChainHelper();",
    "}",
    "",
  ].join("\n"),

  // ── Case 4 (blind spot #1): import() of a runtime-built specifier ─────────
  "src/plugins/cleanup-plugin.ts": [
    "export default function runCleanupPlugin(): string {",
    '  return "cleaned";',
    "}",
    "",
  ].join("\n"),
  "src/plugin-loader.ts": [
    "export async function loadPlugin(): Promise<unknown> {",
    '  const pluginName = process.env.PLUGIN_NAME ?? "cleanup-plugin";',
    "  const mod = await import(`./plugins/${pluginName}`);",
    "  return (mod as { default: () => unknown }).default();",
    "}",
    "",
  ].join("\n"),

  // ── Case 5 (blind spot #2): computed template-literal import() path ───────
  "src/locales/en-messages.ts": [
    'export const EVAL_EN_MESSAGES = { greeting: "hello" };',
    "",
  ].join("\n"),
  "src/i18n.ts": [
    "export async function loadMessages(): Promise<unknown> {",
    '  const lang = process.env.LANG ?? "en";',
    "  const mod = await import(`./locales/${lang}-messages`);",
    "  return mod.EVAL_EN_MESSAGES;",
    "}",
    "",
  ].join("\n"),

  // ── Case 7 (open gap): receiver-method call ScopeResolver can't type-resolve ──
  // `engine` has no resolvable type, so no `calls` edge is built from render-host.ts to
  // EvalRenderer.evalRenderTemplate. Issue #217's fallback is supposed to recover this, and
  // currently does NOT: Tier A stores the call site's target_function as the full dotted text
  // `engine.evalRenderTemplate`, while ImpactService.resolveCallSiteFallback looks up the
  // node's bare name `evalRenderTemplate` with an exact IN (...) match, so the two never meet.
  // Verified against a live `docuvia init` + `impact` run, 2026-08-25.
  //
  // This case therefore scores 0.000 today, on purpose: the fallback DOES work for bare
  // identifier calls (`evalPlainHelper()`), so without a case like this the corpus would
  // report the feature as fine while its headline use case silently misses.
  "src/renderer.ts": [
    "export class EvalRenderer {",
    "  evalRenderTemplate(): string {",
    '    return "rendered";',
    "  }",
    "}",
    "",
  ].join("\n"),
  "src/render-host.ts": [
    "export function evalRunRender(engine) {",
    "  return engine.evalRenderTemplate();",
    "}",
    "",
  ].join("\n"),

  // ── Case 6 (blind spot #4): child_process spawning a project file ─────────
  "scripts/migrate.ts": [
    "export function runMigrations(): string {",
    '  return "migrated";',
    "}",
    "",
  ].join("\n"),
  "src/task-runner.ts": [
    'import { execFile } from "child_process";',
    "",
    "export function runTasks(): void {",
    '  execFile("node", ["scripts/migrate.js"]);',
    "}",
    "",
  ].join("\n"),

  // ── Case 8 (blind spot #5): unresolved method call (obj.method()) ───────────
  "src/renderer.ts": [
    "export class Renderer {",
    '  render() { return "rendered"; }',
    "}",
    "",
  ].join("\n"),
  "src/render-host.ts": [
    'import { Renderer } from "./renderer";',
    "",
    "export function renderHost(): void {",
    "  const r = new Renderer();",
    "  r.render();",
    "}",
    "",
  ].join("\n"),
};

export interface GoldenCase {
  /** Unique scenario tag surfaced in the CSV/markdown report for per-category diagnosis. */
  scenario:
    | "control-static-call"
    | "plain-import-no-call"
    | "re-export-chain"
    | "runtime-variable-import"
    | "computed-import-specifier"
    | "child-process-spawn"
    | "unresolved-receiver-call"
    | "unresolved-method-call";
  /** Impact target resolved via `findNodeByName` (exact match by design). */
  target: string;
  /** Human-labeled ground truth: workspace-relative files that genuinely depend on `target`. */
  expectedDependentFiles: string[];
}

export const GOLDEN_CASES: GoldenCase[] = [
  {
    scenario: "control-static-call",
    target: "evalAdd",
    // client.ts calls evalAdd through a static call edge -- the one relation the graph models.
    expectedDependentFiles: ["src/calculator.ts"],
  },
  {
    scenario: "plain-import-no-call",
    target: "EVAL_MAX_RETRIES",
    // A value import with no call site creates no edge -- documented blind spot, but still a
    // true dependency: deleting config.ts breaks client.ts.
    expectedDependentFiles: ["src/client.ts"],
  },
  {
    scenario: "re-export-chain",
    target: "evalChainHelper",
    // Both the barrel re-export and the ultimate caller genuinely depend on util.ts; whether
    // the graph resolves *through* the barrel is exactly what this case measures.
    expectedDependentFiles: ["src/app-main.ts", "src/mid/index.ts"],
  },
  {
    scenario: "runtime-variable-import",
    target: "runCleanupPlugin",
    // plugin-loader imports `./plugins/${pluginName}` built at runtime -- invisible to static
    // edge construction, yet loadPlugin executes runCleanupPlugin.
    expectedDependentFiles: ["src/plugin-loader.ts"],
  },
  {
    scenario: "computed-import-specifier",
    target: "EVAL_EN_MESSAGES",
    // i18n.ts's template-literal specifier names en-messages.ts only at runtime.
    expectedDependentFiles: ["src/i18n.ts"],
  },
  {
    scenario: "child-process-spawn",
    target: "runMigrations",
    // task-runner execFile's the compiled migrate script -- a real operational dependency the
    // edge graph does not model (only literal `new Worker(...)` spawns are special-cased).
    expectedDependentFiles: ["src/task-runner.ts"],
  },
  {
    scenario: "unresolved-receiver-call",
    target: "evalRenderTemplate",
    // render-host.ts genuinely depends on evalRenderTemplate -- deleting renderer.ts breaks it.
    // Expected to fail today (see the fixture comment above for the dotted-vs-bare mismatch);
    // this row is the regression signal that will flip to 1.000 when that lookup is fixed.
    expectedDependentFiles: ["src/render-host.ts"],
  },
  {
    scenario: "unresolved-method-call",
    target: "render",
    // render-host.ts calls r.render() -- the method call is stored as "Renderer.render" but
    // the call site is "r.render" (receiver stripped), so the static resolver cannot link it.
    // This is a documented blind spot (AGENTS.md: method calls written obj.method() are not
    // recovered today). Expected to fail until the call-site fallback matches method calls.
    expectedDependentFiles: ["src/render-host.ts"],
  },
];
