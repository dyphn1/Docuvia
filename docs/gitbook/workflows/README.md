# Workflows

This section traces the actual execution flow of every `docuvia` CLI/MCP command — as implemented
in code today — and cross-references each step against the ADR(s) in [`docs/gitbook/adr/`](../adr/README.md)
that are supposed to govern it. Where the code and an ADR disagree, the conflict is called out
explicitly rather than smoothed over.

Each doc follows the same shape: a phase-split Mermaid sequence diagram (split into multiple small
diagrams instead of one large one, so each stays legible), a Step → ADR mapping table, and a
"Conflicts Found" section (left empty, and said so, when none were found).

## Commands

| Command                                              | What it does                                                                | Conflicts found                                                                               |
| ---------------------------------------------------- | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| [init](init-execution-flow.md)                       | Workspace bootstrap: DB, knowledge branch, AST indexing, agent integrations | 2 — live `--global` flag despite IFCE-002, MCP entry point bypasses the PLAT-006 command lock |
| [clean](clean-execution-flow.md)                     | Wholesale-deletes `local.db`                                                | None                                                                                          |
| [status](status-execution-flow.md)                   | Row-count health check                                                      | None                                                                                          |
| [sync](sync-execution-flow.md)                       | Pushes local L3 decisions to the remote backend                             | None                                                                                          |
| [analyze](analyze-execution-flow.md)                 | Project-wide config scan, or focused LLM decision extraction                | None (LLM-002 fully integrated & verified)                                                    |
| [review](review-execution-flow.md)                   | Change-detection + blast-radius risk aggregation since a base ref           | 1 — no LSP-escalation path, despite IMPT-003                                                  |
| [impact](impact-execution-flow.md)                   | 1-hop blast-radius lookup by target name                                    | 1 — `escalateToLsp` is a documented no-op                                                     |
| [query](query-execution-flow.md)                     | Local-first keyword + structural lookup                                     | None                                                                                          |
| [export-topology](export-topology-execution-flow.md) | Projects the graph into `topology.json`/`.html`                             | None (one already-accepted ADR risk applies directly)                                         |
| [snapshot](snapshot-execution-flow.md)               | Re-renders SQLite into the `docuvia-knowledge` git branch                   | None                                                                                          |
| [hydrate](hydrate-execution-flow.md)                 | Manual, unconditional git → SQLite rebuild                                  | None                                                                                          |
| [sync-knowledge](sync-knowledge-execution-flow.md)   | Cross-clone reconciliation of the knowledge branch                          | None                                                                                          |
| [doctor](doctor-execution-flow.md)                   | DB/git/logs/hooks diagnostics                                               | None (one layering asymmetry noted)                                                           |
| [uninstall](uninstall-execution-flow.md)             | Reverses `init`'s platform hooks + optionally the DB                        | 1 — same live `--global` flag vs. IFCE-002 as `init`                                          |
| [mcp](mcp-execution-flow.md)                         | Stdio JSON-RPC server exposing `docuviaApi` to AI agents                    | 1 — the exposed `docuvia_init` tool skips `init`'s command lock entirely                      |

## Cross-cutting findings

A few issues showed up in more than one command's trace, so they're recorded once here rather than
duplicated verbatim in every doc that touches them:

- **`--global` is still live even though [IFCE-002](../adr/interface/IFCE-002-strict-repo-scoped-boundaries.md)
  says it was removed.** Affects `init` and `uninstall` (both call into `claude.platform.ts`'s
  global-MCP-config methods).
- **The `docuvia hydrate` subsystem exists in full**, contradicting [STOR-002](../adr/storage/STOR-002-sqlite-ephemeral-query-engine.md)'s
  own "no hydration code exists" note. Confirmed independently from `init` (which calls
  `markSynced()`) and from `hydrate` itself.
- **PLAT-006's coarse `init` lock only covers the CLI entry point**, not the MCP one — see
  [init's Conflict #3](init-execution-flow.md#conflicts-found) and the [mcp doc](mcp-execution-flow.md#conflicts-found)
  for the full trace.
