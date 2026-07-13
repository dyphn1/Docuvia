---
id: GRPH-001
title: L3 to L2 Knowledge Abstraction Strategy
status: proposed
date: 2026-07-03
domains: [graph]
supersedes: [legacy/ADR-005]
superseded_by: []
---

# L3 to L2 Knowledge Abstraction Strategy

## Context

When extracting L3 (Domain Knowledge / Conceptual nodes) from raw source code and system documentation, there is a risk of tight coupling between business concepts and specific L2 (Implementation) nodes, leading to brittle links when the codebase is refactored.

## Decision

We enforce a strict separation between L3 and L2 layers using dynamic soft linking based on "Verification Queries" or "Structural Signatures" rather than hard-coded line numbers or direct foreign keys. L3 nodes will contain "Pointers" (AST paths, Regex patterns, or symbol names) that resolve to L2 nodes dynamically during the Context Aggregation phase.

## Consequences

- Prevents structural decay: Refactoring L2 code doesn't immediately orphan L3 knowledge.
- Increases computational cost during RAG Retrieval due to dynamic resolution.
- Requires robust parsing capable of reliably matching "Verification Queries" against the AST.
