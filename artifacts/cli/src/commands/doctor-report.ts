import { DiagnosticStatus, type DiagnosticResult } from "@workspace/contracts";
import { UI_MESSAGES } from "../constants/ui-messages.js";
import { OUTPUT_FORMAT_MARKERS } from "../constants/cli-output-markers.js";
import { STATUS_ICONS } from "../constants/box-drawing.js";
import type { TableColumn } from "../ui/table.js";

interface CategoryRule {
  category: string;
  test: (key: string) => boolean;
}

/** Groups `DoctorWorkflow`'s flat `Record<string, DiagnosticResult>` (`doctor-workflow.ts`,
 *  `lib/schema`'s `SqliteDiagnosticRunner`, `lib/git-local`'s `GitDiagnosticRunner`) into the
 *  sections `doctorCommand` renders. Matched by prefix so a runner adding a new
 *  `sqlite_*`/`lsp_binary_<lang>`/`agent_hooks_*` key lands in its category without an edit here;
 *  anything unrecognized still renders, under `DOCTOR_CATEGORY_OTHER`. */
const CATEGORY_RULES: CategoryRule[] = [
  {
    category: UI_MESSAGES.DOCTOR_CATEGORY_DATABASE,
    test: (k) =>
      k.startsWith("sqlite_") ||
      k === "db_runner" ||
      k === "db_found" ||
      k === "graph_empty" ||
      // Issue #135: L2 semantic coverage is a graph-content property, rendered with the rest of
      // the database/knowledge-graph diagnostics.
      k === "l2_semantic_coverage" ||
      // Issue #221: call-graph resolution health is likewise a graph-content property.
      k === "call_graph_resolution" ||
      // Issue #221 P3: the canary self-test probes graph-content read paths (lookup + FTS).
      k === "canary_self_test",
  },
  {
    category: UI_MESSAGES.DOCTOR_CATEGORY_GIT_HOOKS,
    test: (k) => k === "git_hook" || k === "pre_push_hook",
  },
  {
    category: UI_MESSAGES.DOCTOR_CATEGORY_GIT,
    test: (k) =>
      k.startsWith("git_") ||
      // Issue #137: per-worktree fragmentation is a repo-structure property, grouped with the
      // other git diagnostics.
      k === "worktree_divergence",
  },
  { category: UI_MESSAGES.DOCTOR_CATEGORY_LOGS, test: (k) => k === "logs" },
  {
    category: UI_MESSAGES.DOCTOR_CATEGORY_TIER_B,
    test: (k) => k === "tier_b_commit_cap",
  },
  {
    category: UI_MESSAGES.DOCTOR_CATEGORY_TIER_B_COVERAGE,
    test: (k) => k === "tier_b_coverage",
  },
  {
    category: UI_MESSAGES.DOCTOR_CATEGORY_LLM,
    test: (k) =>
      k === "llm_reachability" ||
      // Issue #134: the permanently-stuck Tier C queue is an LLM-bridge symptom, grouped with
      // the reachability check that (on its own) misses it.
      k === "tier_c_queue",
  },
  {
    category: UI_MESSAGES.DOCTOR_CATEGORY_LSP,
    test: (k) => k.startsWith("lsp_binary"),
  },
  {
    category: UI_MESSAGES.DOCTOR_CATEGORY_AGENT_HOOKS,
    test: (k) => k.startsWith("agent_hooks_"),
  },
  {
    category: UI_MESSAGES.DOCTOR_CATEGORY_AGENT_ADOPTION,
    // Issue #139: docuvia-first workflow adoption -- a soft, informational diagnostic.
    test: (k) => k === "agent_authored_adoption",
  },
];

/** Render order for `doctorCommand`'s sections -- mirrors `DoctorWorkflow.execute()`'s check
 *  order, with the catch-all last. */
export const DOCTOR_CATEGORY_ORDER: readonly string[] = [
  UI_MESSAGES.DOCTOR_CATEGORY_DATABASE,
  UI_MESSAGES.DOCTOR_CATEGORY_GIT,
  UI_MESSAGES.DOCTOR_CATEGORY_GIT_HOOKS,
  UI_MESSAGES.DOCTOR_CATEGORY_LOGS,
  UI_MESSAGES.DOCTOR_CATEGORY_TIER_B,
  UI_MESSAGES.DOCTOR_CATEGORY_TIER_B_COVERAGE,
  UI_MESSAGES.DOCTOR_CATEGORY_LLM,
  UI_MESSAGES.DOCTOR_CATEGORY_LSP,
  UI_MESSAGES.DOCTOR_CATEGORY_AGENT_HOOKS,
  UI_MESSAGES.DOCTOR_CATEGORY_AGENT_ADOPTION,
  UI_MESSAGES.DOCTOR_CATEGORY_OTHER,
];

export function categorizeDiagnosticKey(key: string): string {
  return (
    CATEGORY_RULES.find((rule) => rule.test(key))?.category ??
    UI_MESSAGES.DOCTOR_CATEGORY_OTHER
  );
}

/** `[key, result]` pairs, grouped by `categorizeDiagnosticKey`, insertion order preserved within
 *  each group. */
export function groupDiagnosticsByCategory(
  diagnostics: Record<string, DiagnosticResult>,
): Map<string, [string, DiagnosticResult][]> {
  const groups = new Map<string, [string, DiagnosticResult][]>();
  for (const [key, result] of Object.entries(diagnostics)) {
    const category = categorizeDiagnosticKey(key);
    const bucket = groups.get(category) ?? [];
    bucket.push([key, result]);
    groups.set(category, bucket);
  }
  return groups;
}

/** Column layout shared by every per-category `ui.table()` call in `doctor.ts`. `Message`/`Fix`
 *  are capped so a long `DOCTOR_MESSAGES` string wraps inside the cell instead of stretching the
 *  whole table past a readable width. */
export const DOCTOR_TABLE_COLUMNS: TableColumn[] = [
  { header: UI_MESSAGES.DOCTOR_COL_CHECK },
  { header: UI_MESSAGES.DOCTOR_COL_STATUS },
  { header: UI_MESSAGES.DOCTOR_COL_MESSAGE, maxWidth: 70 },
  { header: UI_MESSAGES.DOCTOR_COL_FIX, maxWidth: 50 },
];

/** Builds one `ui.table()` row for a diagnostic -- `details` (present only on some FAIL results,
 *  e.g. `SqliteDiagnosticRunner`'s raw error/size dump) folds into the Message cell rather than
 *  taking its own column, keeping the table to four columns regardless of which runner produced
 *  the result. */
export function buildDiagnosticRow(
  key: string,
  result: DiagnosticResult,
): string[] {
  const statusLabel =
    result.status === DiagnosticStatus.PASS
      ? `${STATUS_ICONS.PASS} ${UI_MESSAGES.DOCTOR_STATUS_PASS}`
      : `${STATUS_ICONS.FAIL} ${UI_MESSAGES.DOCTOR_STATUS_FAIL}`;
  const message = result.details
    ? `${result.message}${OUTPUT_FORMAT_MARKERS.OPEN_PAREN}${result.details}${OUTPUT_FORMAT_MARKERS.CLOSE_PAREN}`
    : result.message;
  return [
    key,
    statusLabel,
    message,
    result.suggestion ?? OUTPUT_FORMAT_MARKERS.EMPTY,
  ];
}

export interface DoctorSummaryCounts {
  passed: number;
  total: number;
}

export function summarizeDiagnostics(
  diagnostics: Record<string, DiagnosticResult>,
): DoctorSummaryCounts {
  const entries = Object.values(diagnostics);
  const passed = entries.filter(
    (r) => r.status === DiagnosticStatus.PASS,
  ).length;
  return { passed, total: entries.length };
}
