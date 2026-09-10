/**
 * Issue #192's regression corpus: a synthetic mini-repo whose dependency structure is fully
 * human-labeled (GOLDEN_CASES below), covering both edges the static graph models (controls)
 * and its documented blind spots (AGENTS.md:128 / docs/gitbook/user-guide/cli/impact.md
 * "What counts as a dependency edge"):
 *
 *   1. runtime-variable import      (`import()` of a specifier built from a variable)
 *   2. computed import() specifier  (template-literal module path)
 *   3. re-export chain              (barrel re-export between the definition and the caller)
 *   4. child_process spawn          (execFile of another project file)
 *
 * Plus receiver/method-call gaps issue #217's `ast_call_sites` fallback is intended to expose.
 * Files live as inline strings (not fixture files in a source tree) so intentional dynamic-import
 * patterns never enter typecheck/lint's purview. Symbol names are `eval`-prefixed to be globally
 * unique -- impact resolves targets by exact-then-LIKE name match.
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

  // ── Case 8: typed obj.method() call, kept in independent fixture files ────
  // Distinct paths/names are intentional: reusing Case 7's object keys would overwrite those
  // fixtures before the evaluator ever writes the synthetic repository, silently corrupting the
  // benchmark. This case measures whether a typed receiver call is linked/recovered correctly.
  "src/method-renderer.ts": [
    "export class EvalMethodRenderer {",
    '  evalRenderMethod() { return "rendered"; }',
    "}",
    "",
  ].join("\n"),
  "src/method-render-host.ts": [
    'import { EvalMethodRenderer } from "./method-renderer";',
    "",
    "export function evalMethodRenderHost(): void {",
    "  const renderer = new EvalMethodRenderer();",
    "  renderer.evalRenderMethod();",
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
    expectedDependentFiles: ["src/calculator.ts"],
  },
  {
    scenario: "plain-import-no-call",
    target: "EVAL_MAX_RETRIES",
    expectedDependentFiles: ["src/client.ts"],
  },
  {
    scenario: "re-export-chain",
    target: "evalChainHelper",
    expectedDependentFiles: ["src/app-main.ts", "src/mid/index.ts"],
  },
  {
    scenario: "runtime-variable-import",
    target: "runCleanupPlugin",
    expectedDependentFiles: ["src/plugin-loader.ts"],
  },
  {
    scenario: "computed-import-specifier",
    target: "EVAL_EN_MESSAGES",
    expectedDependentFiles: ["src/i18n.ts"],
  },
  {
    scenario: "child-process-spawn",
    target: "runMigrations",
    expectedDependentFiles: ["src/task-runner.ts"],
  },
  {
    scenario: "unresolved-receiver-call",
    target: "evalRenderTemplate",
    expectedDependentFiles: ["src/render-host.ts"],
  },
  {
    scenario: "unresolved-method-call",
    target: "evalRenderMethod",
    expectedDependentFiles: ["src/method-render-host.ts"],
  },
];
