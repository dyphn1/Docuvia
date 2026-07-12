---
id: GRPH-005
title: Read-side Query Layer
status: accepted
date: 2026-07-12
domains: [graph]
supersedes: []
superseded_by: []
---

# Read-side Query Layer

## Context
During the migration of the `query`, `review`, `impact`, and `export-topology` commands, we needed a robust way to read from the unified SQLite storage. Previously, graph reads were scattered or heavily tied to specific implementations.

## Decision
We implemented a comprehensive Read-side Query Layer on `IGraphNodesRepo` and `IL3NodesRepo`, incorporating methods like `findNodeByName`, `getIncomingEdges`, `getOutgoingEdges`, `getAllNodes`, and `getAllLinks`, as well as a full FTS5 search interface. 

## Consequences
- **Positive**: Unlocks multiple read-heavy CLI commands natively over SQLite with consistent typing and centralized logic.
- **Negative**: Methods like `getAllNodes` and `getAllLinks` currently load the entire dataset into memory without pagination. For very large codebases, this introduces an Out-Of-Memory (OOM) risk during operations like topology export or mass pruning.
