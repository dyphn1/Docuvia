# Table of contents

- [Prologue: Vision & Goal](README.md)

## 📐 System Architecture

- [Overview](architecture/README.md)
- [The Two-Layer Virtual Contracts Architecture](architecture/virtual-contracts-architecture.md)
- [Unified Error Handling Strategy](architecture/error-handling-architecture.md)
- [Application Lifecycle & State Management](architecture/application-lifecycle-and-state.md)
- [Event-Driven Logging Architecture](architecture/logging-architecture.md)
  - [IPC Logging Architecture](architecture/ipc-logging-architecture.md)
- [Strict Testing & Quality Gates Architecture](architecture/testing-and-quality-architecture.md)

## 🛠️ Coding Guidelines

- [Overview](guidelines/README.md)
- [Design Spirit & Core Principles](guidelines/design-spirit.md)
- [File Placement & Folder Rules](guidelines/file-placement-rules.md)
- [Phase-Based Test Quality Hardening](guidelines/phase-based-test-quality-hardening.md)

## 📖 User Guide

- [Overview](user-guide/README.md)
- [CLI Commands](user-guide/cli.md)
  - [init](user-guide/cli/init.md)
  - [clean](user-guide/cli/clean.md)
  - [analyze](user-guide/cli/analyze.md)
  - [snapshot](user-guide/cli/snapshot.md)
  - [hydrate](user-guide/cli/hydrate.md)
  - [sync-knowledge](user-guide/cli/sync-knowledge.md)
  - [query](user-guide/cli/query.md)
  - [impact](user-guide/cli/impact.md)
  - [review](user-guide/cli/review.md)
  - [status](user-guide/cli/status.md)
  - [export-topology](user-guide/cli/export-topology.md)
  - [publish](user-guide/cli/publish.md)
  - [mcp](user-guide/cli/mcp.md)
  - [uninstall](user-guide/cli/uninstall.md)
  - [doctor](user-guide/cli/doctor.md)
  - [hooks](user-guide/cli/hooks.md)
- [Comment-Triggered Analysis](user-guide/comment-trigger.md)

## 📋 Architecture Decision Records

- [ADR Index](adr/README.md)
  - [PLAT-010 — Phase-Based Test Quality Governance](adr/platform/PLAT-010-phase-based-test-quality-governance.md)
  - [PLAT-011 — Semantic Decision Feature Provider Boundary](adr/platform/PLAT-011-semantic-decision-feature-provider-boundary.md)
  - [GRPH-008 — Tiered Call Resolution](adr/graph/GRPH-008-tiered-call-resolution.md)
  - [Semantic Decision Phase 0 Contract](analysis/semantic-decision-phase0-contract.md)
  - [Semantic decision Phase 1 corpus](analysis/semantic-decision-phase1-corpus.md)
  - [Semantic decision Phase 1 collection](analysis/semantic-decision-phase1-collection.md)
  - [Semantic decision Phase 2 System-1 encoding](analysis/semantic-decision-phase2-system1-encoding.md)
  - [Semantic decision Phase 2 System-1 offline evaluation](analysis/semantic-decision-phase2-system1-eval.md)
  - [Semantic decision Phase 3 CUA-S1 option scoring](analysis/semantic-decision-phase2-system1-cua-s1.md)
  - [Semantic decision Phase 4 Laya capability baseline and resource envelope](analysis/semantic-decision-phase2-system1-laya.md)
  - [Semantic decision System-1 deterministic query routing](analysis/semantic-decision-phase2-system1-query-routing.md)

## 🔄 Workflows

- [Overview](workflows/README.md)
- [init — Execution Flow vs. Architecture Decisions](workflows/init-execution-flow.md)
- [clean — Execution Flow vs. Architecture Decisions](workflows/clean-execution-flow.md)
- [status — Execution Flow vs. Architecture Decisions](workflows/status-execution-flow.md)
- [publish — Execution Flow vs. Architecture Decisions](workflows/publish-execution-flow.md)
- [analyze — Execution Flow vs. Architecture Decisions](workflows/analyze-execution-flow.md)
- [review — Execution Flow vs. Architecture Decisions](workflows/review-execution-flow.md)
- [impact — Execution Flow vs. Architecture Decisions](workflows/impact-execution-flow.md)
- [query — Execution Flow vs. Architecture Decisions](workflows/query-execution-flow.md)
- [export-topology — Execution Flow vs. Architecture Decisions](workflows/export-topology-execution-flow.md)
- [snapshot — Execution Flow vs. Architecture Decisions](workflows/snapshot-execution-flow.md)
- [hydrate — Execution Flow vs. Architecture Decisions](workflows/hydrate-execution-flow.md)
- [sync-knowledge — Execution Flow vs. Architecture Decisions](workflows/sync-knowledge-execution-flow.md)
- [doctor — Execution Flow vs. Architecture Decisions](workflows/doctor-execution-flow.md)
- [uninstall — Execution Flow vs. Architecture Decisions](workflows/uninstall-execution-flow.md)
- [mcp — Execution Flow vs. Architecture Decisions](workflows/mcp-execution-flow.md)

## 📊 Analysis

- [Tiered Call Resolution Implementation Plan](analysis/tiered-call-resolution-implementation-plan.md)
- [GRPH-008 Phase 3 — Q1 named-import proof audit](analysis/tiered-call-resolution-phase3-q1-named-import-proof.md)
- [GRPH-008 Phase 3 — Dependency invalidation](analysis/tiered-call-resolution-phase3-invalidation.md)
- [GRPH-008 Phase 0 — Measurement Gate](analysis/tiered-call-resolution-phase0-results.md)
- [GRPH-008 Phase 1 — Declared Type Facts](analysis/tiered-call-resolution-phase1-results.md)
- [GRPH-008 P2-A/P2-B — Snapshot-Scoped Evaluation Correction](analysis/tiered-call-resolution-phase2-snapshot-scope-correction.md)
- [GRPH-008 P2-A — Direct Import Alias Candidates](analysis/tiered-call-resolution-phase2-p2a-direct-import-alias.md)
- [GRPH-008 P2-A — TRAIN Candidate and Proposal-Filter Stage Audit](analysis/tiered-call-resolution-phase2-p2a-candidate-stage-train-audit.md)
- [GRPH-008 P2-B v4 — System One Train/Calibration Evidence](analysis/tiered-call-resolution-phase2-p2b-v4.md)
- [Cross-Product CLI Benchmark (2026-07-13)](analysis/cross-product-cli-benchmark.md)
- [Roadmap & Open Items](analysis/roadmap-and-open-items.md)
- [Impact benchmark honesty — Phase 0 metric contract](analysis/impact-benchmark-honesty-phase0.md)
- [Impact benchmark honesty — Phase 1 adversarial corpus](analysis/impact-benchmark-honesty-phase1.md)
- [Impact benchmark honesty — Phase 2 epistemic and dynamic-boundary corpus](analysis/impact-benchmark-honesty-phase2.md)
- [Impact benchmark honesty — Phase 3 staleness and state-transition robustness](analysis/impact-benchmark-honesty-phase3.md)
- [Impact benchmark honesty — Phase 4 CI report and hard regression gates](analysis/impact-benchmark-honesty-phase4.md)
