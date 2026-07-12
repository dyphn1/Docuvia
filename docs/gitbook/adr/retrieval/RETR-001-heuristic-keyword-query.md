---
id: RETR-001
title: Heuristic Keyword Query Only
status: accepted
date: 2026-07-12
domains: [retrieval]
supersedes: []
superseded_by: []
---

# Heuristic Keyword Query Only

## Context
Advanced RAG implementations (like the previously planned 4-way routing in ADR-007) require LLM invocations and complex orchestration. For Docuvia2's initial migration, executing expensive LLM calls for every query command was deemed out of scope.

## Decision
The `query` command is strictly restricted to **Heuristic Keyword Search**. It relies entirely on local SQLite FTS5 (Full-Text Search) and 1-hop SQL JOINs to extract relevant node metadata. It does **not** invoke any LLM for intent routing or response synthesis.

## Consequences
- **Positive**: Extremely fast, local-only, offline-capable query responses with zero API costs.
- **Negative**: The results are purely deterministic and lack the semantic understanding or summarization that an LLM would provide. Users must manually parse the returned JSON/Markdown nodes.
