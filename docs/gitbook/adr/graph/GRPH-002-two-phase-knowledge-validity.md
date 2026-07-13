---
id: GRPH-002
title: Two-Phase Knowledge Validity
status: proposed
date: 2026-07-03
domains: [graph]
supersedes: [legacy/ADR-011]
superseded_by: []
---

# Two-Phase Knowledge Validity

## Context

Extracted or generated L3 knowledge nodes are not immediately trustworthy. The LLM might hallucinate relationships or extract irrelevant information. Integrating unverified nodes directly into the active RAG pool degrades response quality and confidence.

## Decision

Implement a Two-Phase Validity lifecycle (`l3_nodes.validity_status`). All new L3 nodes start as `Draft` or `Pending`. They only become `Active` after a defined quality gate (e.g., Human-in-the-Loop approval via the VS Code extension, or a secondary LLM verification pass). `Garbage` nodes are excluded from export and retrieval.

## Consequences

- Protects the knowledge graph from pollution.
- Forces a deliberate approval workflow.
- Requires UI/CLI mechanisms to surface `Pending` nodes for review.
