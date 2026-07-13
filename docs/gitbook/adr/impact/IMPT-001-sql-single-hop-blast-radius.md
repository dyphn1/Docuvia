---
id: IMPT-001
title: SQL Single-Hop Blast Radius (Heuristic Filter)
status: accepted
date: 2026-07-12
domains: [impact]
supersedes: []
superseded_by: []
---

# SQL Single-Hop Blast Radius (Heuristic Filter)

## Context

While the ultimate source of truth for dependencies must be driven by an LSP (see IMPT-003), spinning up an LSP for every minor keystroke or initial filtering step is unnecessarily heavy. We need a rapid "first pass" filter.

## Decision

The `impact` and `review` commands utilize a **single-hop SQL JOIN** query over the `node_links` table in SQLite (`getIncomingEdges` / `getOutgoingEdges`) as a **Fast Heuristic Filter**.

## Consequences

- **Positive**: Provides instantaneous feedback based on the last known Git snapshot. Excellent for immediate UI rendering or preliminary filtering before passing candidates to the LSP.
- **Negative**: It does not capture transitive dependencies (multi-hop) natively and relies on potentially stale AST data if an unsaved buffer exists. Must not be used as the final word for automated refactoring safely limits.
