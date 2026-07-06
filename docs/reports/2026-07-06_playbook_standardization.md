# Playbook Standardization Report

**Date**: 2026-07-06
**Status**: Completed

## 🎯 Objective

To resolve the issue of **Agent Inconsistency** (where AI agents implement features inconsistently due to scattered architectural context), we standardized the Engineering Patterns (Playbooks) into a strict, machine-readable format.

This ensures that all future AI agents and human developers follow a Single Source of Truth (SSOT) when modifying core mechanisms.

## 🛠️ Actions Taken

### 1. Established Playbook Standard Structure

Updated `docs/gitbook/development/patterns/README.md` to mandate a strict 7-part structure for all playbooks:

1. **Objective / Goal**: What this mechanism specifically tries to achieve.
2. **Context & Architecture Links**: "Why we do this" (Links to ADRs).
3. **File Locations & Boundary**: "Where the code lives and what NOT to touch".
4. **Agent Guardrails & Invariants**: Explicit rules for Agents (e.g., "NEVER write types manually").
5. **Step-by-Step Implementation**: The "How-to" execution sequence.
6. **Testing & Verification**: How to locally test and verify that the mechanism works.
7. **Extensibility & Scaling**: How to expand or extend this mechanism in the future.

### 2. Retrofitted Existing Playbooks

Injected the `Agent Guardrails & Invariants` section into all existing mechanism playbooks to provide hard constraints for AI agents:

- **`api-codegen-pipeline.md`**: Enforced the strict API-First approach. Banned manual editing of TypeScript interfaces in `generated/` folders; mandated running `pnpm codegen` after `openapi.yaml` changes.
- **`wasm-ast-blast-radius.md`**: Enforced smart pruning logic. Prohibited assuming file changes invalidate all dependents; mandated checking if changes are confined to the `statement_block` before traversing `CALLS`/`IMPORTS`.
- **`progressive-enrichment.md`**: Enforced OOM prevention. Banned initializing LSP servers (like `tsserver`) inside the fast-path graph ingestion loop; mandated falling back to Tree-sitter (AST) for initial parsing.

### 3. Enforced Global Agent Compliance

Updated the root `AGENTS.md` to explicitly enforce this new standard in the **🧠 Law of State Handoff Awakening (CRITICAL)** section.

All agents are now required to check `docs/gitbook/development/patterns/README.md` before modifying any core mechanism, ensuring they absorb and obey the playbook's guardrails before writing code.

## 📈 Impact

By codifying these guardrails and linking them directly from the primary `AGENTS.md` prompt, we eliminate context scattering. AI agents will no longer hallucinate architectures or implement divergent patterns for core systems like Codegen, AST extraction, and RAG routing.
