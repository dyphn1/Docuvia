# Engineering Patterns (Playbooks)

This section contains **Mechanism-Centric** playbooks.

In large codebases, knowledge often becomes fragmented—the "why" is in an ADR, the "where" is in the architecture document, and the "how" is scattered across READMEs.

To solve the issue of **Agent Inconsistency** (where AI agents implement features inconsistently due to scattered context), these playbooks serve as the **Single Source of Truth (SSOT) for execution**. A well-written playbook must be universally comprehensible for both Humans and Machines (人機共通).

> **⚠️ AGENT DIRECTIVE**
> If a task touches any of the mechanisms listed below, the agent **MUST** read the respective playbook before planning or executing code changes.

## Playbook Standard Structure

Every playbook in this directory MUST follow this strict 7-part structure to ensure clarity, verifiability, and scalability:

1. **Objective / Goal**: What this mechanism specifically tries to achieve.
2. **Context & Architecture Links**: "Why we do this" (Links to ADRs).
3. **File Locations & Boundary**: "Where the code lives and what NOT to touch".
4. **Agent Guardrails & Invariants**: Explicit rules for Agents (e.g., "NEVER write types manually").
5. **Step-by-Step Implementation**: The "How-to" execution sequence.
6. **Testing & Verification**: How to locally test and verify that the mechanism works.
7. **Extensibility & Scaling**: How to expand or extend this mechanism in the future.

## Current Patterns

- **[API-First & Codegen Pipeline](api-codegen-pipeline.md)** — How we use OpenAPI, Orval, Zod, and React Query to eliminate type drift across our multi-interface system.
- **[AST Semantic Diff & Blast Radius (WASM)](wasm-ast-blast-radius.md)** — How `web-tree-sitter` powers semantic diffing and smart-pruned blast radius without a heavy database.
- **[Progressive Enrichment (Dynamic Degradation Routing)](progressive-enrichment.md)** — How we route between AST-only fast paths and LSP/compiler-backed slow paths without OOM crashes, and persist expensive inferences back into the knowledge graph.
