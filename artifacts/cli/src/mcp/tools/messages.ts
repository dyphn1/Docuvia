/**
 * Trimmed to the messages the registered tools actually use (per the migration plan's step 9).
 * Old Docuvia's file also carried messages for `context`/`analyze`/`extract`/`clean`/`sync`
 * tools that don't exist in this milestone. Port the rest in alongside each tool as it's rebuilt.
 */
export const MCP_TOOL_MESSAGES = {
  ERROR_INITIALIZING: "Error initializing Docuvia",
  ERROR_QUERYING: "Error querying Docuvia knowledge graph",
  ERROR_ANALYZING_IMPACT: "Error analyzing impact",
  ERROR_GETTING_STATUS: "Error getting Docuvia status",
  ERROR_DETECTING_CHANGES: "Error detecting changes",

  /** Issue #190 -- behavioral tool descriptions. Each description answers three questions for
   *  the calling agent: when to pick this tool over raw Grep/Glob, what it returns, and how to
   *  read the result's confidence signals. Agent invocation rate is driven almost entirely by
   *  these strings, so they are worded as usage instructions, not feature blurbs. */
  QUERY_TOOL_DESCRIPTION:
    "Search the codebase knowledge graph (symbols, modules, architectural decisions, caller/callee context) BEFORE reaching for Grep/Glob/Read — it returns precomputed structural awareness those tools lack. Use it to locate where a concept lives, understand a module's role, or surface recorded 'why' decisions. Read match_type in the response: exact = confirmed symbol/file; keyword/neighbor = lower confidence, cross-check before relying on it. An empty result means unknown (not zero) — run docuvia_status; if Tier B coverage is incomplete, results may be partial.",
  IMPACT_TOOL_DESCRIPTION:
    "Compute the blast radius of a file or symbol: every module that depends on it upstream/downstream, with a risk level (low/medium/high/critical) and any recorded rationale ('why') per dependent. Call this BEFORE editing or deleting a symbol/file so you know who breaks. Returns null when the target isn't in the graph (unknown target, not confirmed-isolated); a non-null but empty blast radius with an incomplete-coverage note may also be incomplete rather than truly dependency-free.",
  STATUS_TOOL_DESCRIPTION:
    "Report knowledge-graph health: project/module/decision counts and Tier B (LSP cross-file) processing coverage. Call this when graph results look empty, stale, or suspiciously low-confidence — if Tier B coverage is below 100%, structural answers may be incomplete until 'docuvia analyze --escalate-to-lsp --full' runs.",
  DETECT_CHANGES_TOOL_DESCRIPTION:
    "Compare the current workspace against a git ref and report which tracked files changed, which graph nodes those changes touch, an overall risk level, and a natural-language analysis of what the diff puts at risk. Use it after finishing edits (or with baseRef set to your merge base) as a pre-commit safety check, instead of manually reading diffs.",

  /** Next-step guidance appended as a second content block — agents choose their next action from
   *  tool output content, so each read-path result steers toward the next Docuvia call
   *  (issue #190's invocation-rate lever). */
  QUERY_NEXT_STEP_HINT:
    "Next steps: before editing any file or symbol above, call docuvia_impact on it to see who depends on it.",
  IMPACT_NOT_FOUND_HINT:
    "The target was not found in the knowledge graph — this means unknown, not isolated. Verify the exact name with docuvia_query first; if it exists there but not here, the graph is likely stale or Tier B coverage is incomplete (see docuvia_status).",
  IMPACT_EMPTY_HINT:
    "No dependents found. If Tier B coverage below 100% is reported above, treat this as possibly incomplete — runtime/computed imports are invisible to static analysis — and cross-check with Grep before deleting.",
  REVIEW_NEXT_STEP_HINT:
    "Next steps: inspect the affected nodes above before committing; call docuvia_impact on any node you're about to change further.",
} as const;
