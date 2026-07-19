# Workflows

This section traces the actual execution flow of every `docuvia` CLI/MCP command — as implemented
in code today — and cross-references each step against the ADR(s) in [`docs/gitbook/adr/`](../adr/README.md)
that are supposed to govern it. Where the code and an ADR disagree, the conflict is called out
explicitly rather than smoothed over.

Each doc follows the same shape: a phase-split Mermaid sequence diagram (split into multiple small
diagrams instead of one large one, so each stays legible), a Step → ADR mapping table, and a
"Conflicts Found" section (left empty, and said so, when none were found).

## Commands

| Command                                              | What it does                                                                            | Conflicts found                                    |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------- | -------------------------------------------------- |
| [init](init-execution-flow.md)                       | Workspace bootstrap: DB, knowledge branch, AST indexing, agent integrations             | None (2 historical conflicts resolved — see below) |
| [clean](clean-execution-flow.md)                     | Wholesale-deletes `local.db`                                                            | None                                               |
| [status](status-execution-flow.md)                   | Row-count health check                                                                  | None                                               |
| [sync](sync-execution-flow.md)                       | Pushes local L3 decisions to the remote backend                                         | None                                               |
| [analyze](analyze-execution-flow.md)                 | Auto-mode ingestion (Tier A), focused LLM decision extraction, or Tier B LSP escalation | None                                               |
| [review](review-execution-flow.md)                   | Change-detection + blast-radius risk aggregation since a base ref                       | None (resolved — see below)                        |
| [impact](impact-execution-flow.md)                   | 1-hop blast-radius lookup by target name                                                | None (resolved — see below)                        |
| [query](query-execution-flow.md)                     | Local-first keyword + structural lookup                                                 | None                                               |
| [export-topology](export-topology-execution-flow.md) | Projects the graph into `topology.json`/`.html`                                         | None                                               |
| [snapshot](snapshot-execution-flow.md)               | Re-renders SQLite into the `docuvia-knowledge` git branch                               | None                                               |
| [hydrate](hydrate-execution-flow.md)                 | Manual, unconditional git → SQLite rebuild                                              | None                                               |
| [sync-knowledge](sync-knowledge-execution-flow.md)   | Cross-clone reconciliation of the knowledge branch                                      | None                                               |
| [doctor](doctor-execution-flow.md)                   | DB/git/hooks/commit-cap/LLM/LSP diagnostics                                             | None                                               |
| [uninstall](uninstall-execution-flow.md)             | Reverses `init`'s platform hooks + optionally the DB                                    | None (resolved — see below)                        |
| [mcp](mcp-execution-flow.md)                         | Stdio JSON-RPC server exposing `docuviaApi` to AI agents                                | None (resolved — see below)                        |

## Cross-cutting findings (all resolved)

Three issues showed up in more than one command's trace when this section was first written. All
three are now closed; kept here (rather than deleted outright) so the resolution is visible in one
place instead of requiring a diff across every command doc that originally flagged them.

- **`--global` was live despite [IFCE-002](../adr/interface/IFCE-002-strict-repo-scoped-boundaries.md)
  saying it was removed.** Affected `init` and `uninstall` (both called into `claude.platform.ts`'s
  global-MCP-config methods). **Resolved**: the flag was removed entirely; `claude.platform.ts` now
  prints the MCP config snippet for the user to copy-paste instead of writing
  `claude_desktop_config.json` — see [init's Conflict #0](init-execution-flow.md#conflicts-found)
  and [uninstall's matching entry](uninstall-execution-flow.md#conflicts-found).
- **The `docuvia hydrate` subsystem was believed unimplemented**, based on a stale note that no
  longer exists in the current [STOR-002](../adr/storage/STOR-002-sqlite-ephemeral-query-engine.md)
  (which now carries its own "Implementation Status (Fully Resolved)" note). **Resolved**: confirmed
  the hydration pipeline (`hydration.service.ts`, nearest-ancestor resolution) exists in full and is
  exercised by both `init` (`markSynced()`) and `hydrate` itself.
- **PLAT-006's coarse `init` lock only covered the CLI entry point**, not the MCP one. **Resolved**:
  extracted into a shared `withInitCommandLock` helper used by both — see
  [mcp's Conflict entry](mcp-execution-flow.md#conflicts-found) for the fix and its regression test.

Two more conflicts were found and resolved after this section was first written:

- **`impact --escalate-to-lsp` was a documented no-op** against
  [IMPT-002](../adr/impact/IMPT-002-lsp-for-absolute-quality.md). **Resolved**: the flag was removed
  entirely rather than implemented — `impact`'s blast radius already reads whatever edges
  [PLAT-007](../adr/platform/PLAT-007-tiered-background-knowledge-evolution.md)'s Tier B has
  resolved into the graph, with no flag needed. See
  [impact's Conflict entry](impact-execution-flow.md#conflicts-found).
- **`review` was believed to have no LSP-escalation path**, on the assumption it would need its own
  `escalateToLsp`-style flag. **Resolved on inspection**: `review`'s blast radius calls the exact
  same `ImpactService` method `impact` does, so it benefits from Tier B's LSP-corrected edges
  transparently, the same way `impact` does. See
  [review's Conflict entry](review-execution-flow.md#conflicts-found).
