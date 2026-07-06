---
Date: 2026-07-02
Status: Proposed (Aspirational/Fiction)
Supersedes: None
---

# ADR 013: Adversarial Implementation Protocol (Team Falsification)

## Status

Proposed (Note: Currently not actively practiced. The actual agent scaffold in `.github/agents/` and `.claude/agents/` runs a linear pipeline: requirement-analyzer → execution specialist → task-verifier, without the 3-role debate or named personas described below.)

## Context

Standard AI-assisted or single-developer workflows often suffer from "happy-path" bias (or LLM sycophancy), leading to implementations that pass unit tests but fail under production constraints (e.g., OOM on large repos parsing via the [AST Microkernel](./ADR-020-unified-isomorphic-ast-microkernel.md), split-brain race conditions managing the [Orphan Branch](./ADR-017-tiered-storage-and-orphan-branch-graph-maintenance.md), N+1 query performance degradation in the [Database-as-IPC](./ADR-014-sql-indexed-graph-and-database-as-ipc.md) pipeline). We need a structured workflow that guarantees rigorous defense-in-depth _before_ code is written, without derailing the overarching product vision.

## Decision

We adopt the **Adversarial Implementation Protocol** for all future feature development, roadmap execution, and bug fixes. The protocol enforces a 3-role simulated debate (PM, QA, Developer) augmented by a strict **SRE/Security Challenger (Max)** persona.

### The Protocol Lifecycle

1. **Role Invocation & Falsification (The Debate)**
   Before any code is written, a simulated debate must occur involving:
   - **Product Manager (PM)**: Defends the **Product Positioning** ([Local-First UX](./ADR-002-local-first-architecture.md), [Git-Isomorphic](./ADR-004-git-isomorphic-graph.md), [Agentic RAG](./ADR-007-agentic-rag-routing.md), [High Token Efficiency](./ADR-009-token-management.md)). _Crucial constraint: All architectural changes must first align with the product's core identity. We do not accept robust solutions if they violate Local-First or introduce heavy external dependencies like Redis (see [Database-as-IPC](./ADR-014-sql-indexed-graph-and-database-as-ipc.md))._
   - **Lead Developer (Leo)**: Proposes the initial implementation strategy and target files.
   - **QA**: Identifies edge cases, non-deterministic behaviors, and testing gaps.
   - **Challenger (Max - SRE/Security)**: Aggressively attacks the Developer's proposal, looking for OOM vectors (referencing [AST Microkernel limits](./ADR-020-unified-isomorphic-ast-microkernel.md)), ReDoS, split-brain data corruption (referencing [Orphan Branch Maintenance](./ADR-017-tiered-storage-and-orphan-branch-graph-maintenance.md)), security injections, and horizontal scaling bottlenecks.

2. **Multi-Round Refinement (Minimum 3 Rounds)**
   The team must debate for at least 3 rounds until the Developer's proposal is hardened against the Challenger's edge cases while satisfying the PM's product constraints.

3. **Implementation & Commit**
   Only after the resolution is finalized does the Developer implement the code. The implementation must strictly follow the agreed-upon hardened architecture. Each feature is committed sequentially.

4. **Documentation Synchronization**
   Immediately after the code is committed, the developer MUST:
   - Mark the feature status in the corresponding feature file under `docs/gitbook/roadmap/features/`.
   - Generate or update the specific `docs/gitbook/reports/` verification markdown file, embedding the team's debate conclusion.
   - Retroactively update the core `docs/gitbook/architecture/` Arc42 and ADR documents so the architectural Source of Truth always perfectly mirrors the codebase.

## Consequences

- **Pros**: Drastically reduces technical debt, prevents catastrophic production failures (OOMs, data loss), eliminates LLM sycophancy, and keeps documentation 100% isomorphic with the codebase.
- **Cons**: Increases the upfront token cost and planning time before the first line of code is written.

## Product Positioning Guardrail

The ultimate veto power rests with the Product Positioning. If the Challenger proposes a highly secure, distributed locking mechanism that requires Kubernetes and Zookeeper, the PM will veto it because Docuvia must remain a lightweight, self-hosted, [Local-First](./ADR-002-local-first-architecture.md) engine backed by PostgreSQL (acting as our [Database-as-IPC](./ADR-014-sql-indexed-graph-and-database-as-ipc.md) and [pgvector store](./ADR-019-pgvector-migration.md)).

## Diagram

```mermaid
flowchart TD
    A[Feature Request / Bug Fix] --> B[Role Invocation & Debate]

    subgraph Adversarial Debate
        PM[PM: Defends Local-First & Constraints]
        Dev[Lead Dev: Proposes Architecture]
        QA[QA: Finds Edge Cases]
        Max[Challenger/SRE: Attacks Proposal]

        Dev <--> Max
        Dev <--> QA
        Dev <--> PM
    end

    B --> Adversarial Debate
    Adversarial Debate --> C{Consensus Reached?}
    C -- No --> Adversarial Debate
    C -- Yes --> D[Implementation & Commit]
    D --> E[Documentation Synchronization]
    E --> F[Mark Feature Status in features/]
```
