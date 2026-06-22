# ADR 013: Adversarial Implementation Protocol (Team Falsification)

## Status

Accepted

## Context

Standard AI-assisted or single-developer workflows often suffer from "happy-path" bias (or LLM sycophancy), leading to implementations that pass unit tests but fail under production constraints (e.g., OOM on large repos, split-brain race conditions, N+1 query performance degradation). We need a structured workflow that guarantees rigorous defense-in-depth _before_ code is written, without derailing the overarching product vision.

## Decision

We adopt the **Adversarial Implementation Protocol** for all future feature development, roadmap execution, and bug fixes. The protocol enforces a 3-role simulated debate (PM, QA, Developer) augmented by a strict **SRE/Security Challenger (Max)** persona.

### The Protocol Lifecycle

1. **Role Invocation & Falsification (The Debate)**
   Before any code is written, a simulated debate must occur involving:
   - **Product Manager (PM)**: Defends the **Product Positioning** (Local-First UX, Git-Isomorphic, Agentic RAG, High Token Efficiency). _Crucial constraint: All architectural changes must first align with the product's core identity. We do not accept robust solutions if they violate Local-First or introduce heavy external dependencies like Redis._
   - **Lead Developer (Leo)**: Proposes the initial implementation strategy and target files.
   - **QA**: Identifies edge cases, non-deterministic behaviors, and testing gaps.
   - **Challenger (Max - SRE/Security)**: Aggressively attacks the Developer's proposal, looking for OOM vectors, ReDoS, split-brain data corruption, security injections, and horizontal scaling bottlenecks.

2. **Multi-Round Refinement (Minimum 3 Rounds)**
   The team must debate for at least 3 rounds until the Developer's proposal is hardened against the Challenger's edge cases while satisfying the PM's product constraints.

3. **Implementation & Commit**
   Only after the resolution is finalized does the Developer implement the code. The implementation must strictly follow the agreed-upon hardened architecture. Each feature is committed sequentially.

4. **Documentation Synchronization**
   Immediately after the code is committed, the developer MUST:
   - Update `docs/roadmap/roadmap_checklist.md` to mark the feature as `✅ PASS`.
   - Generate or update the specific `docs/roadmap/reports/` verification markdown file, embedding the team's debate conclusion.
   - Retroactively update the core `docs/design/` Arc42 and ADR documents so the architectural Source of Truth always perfectly mirrors the codebase.

## Consequences

- **Pros**: Drastically reduces technical debt, prevents catastrophic production failures (OOMs, data loss), eliminates LLM sycophancy, and keeps documentation 100% isomorphic with the codebase.
- **Cons**: Increases the upfront token cost and planning time before the first line of code is written.

## Product Positioning Guardrail

The ultimate veto power rests with the Product Positioning. If the Challenger proposes a highly secure, distributed locking mechanism that requires Kubernetes and Zookeeper, the PM will veto it because Docuvia must remain a lightweight, self-hosted, Local-First engine backed by SQLite/PostgreSQL.
