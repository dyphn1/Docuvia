# Rust CLI Benchmark & AST Analysis Report

> **Purpose:** This document defines the evaluation matrix, execution results, and metrics for Rust target repositories.

---

## 🔍 Target Projects

- **Project 1**: `BurntSushi/ripgrep`
- **Project 2**: `tauri-apps/tauri`

---

## 1. Project 1: `BurntSushi/ripgrep` Benchmark

### Category: Indexing & Analysis (Graph Building)

| Feature / Metric           | Docuvia2  | GitNexus    | Graphify         | Code-Review-Graph (CRG) |
| :------------------------- | :-------- | :---------- | :--------------- | :---------------------- |
| **Full Graph Build**       | `analyze` | `analyze .` | `extract <path>` | `build --repo .`        |
| **Verified Build Result**  |           |             |                  |                         |
| **Verified Build Latency** |           |             |                  |                         |
| **Incremental Update**     |           |             |                  |                         |
| **Clear Local Index**      |           |             |                  |                         |

### Category: Query, Visualization & Impact

| Feature / Metric          | Docuvia2 | GitNexus | Graphify | Code-Review-Graph (CRG) |
| :------------------------ | :------- | :------- | :------- | :---------------------- |
| **Query Engine**          |          |          |          |                         |
| **Impact / Blast Radius** |          |          |          |                         |
| **Explain / Context**     |          |          |          |                         |
| **Visual Export**         |          |          |          |                         |
| **Docs / Wiki Gen**       |          |          |          |                         |

### Category: Remote Sync & Git Integration

| Feature / Metric         | Docuvia2 | GitNexus | Graphify | Code-Review-Graph (CRG) |
| :----------------------- | :------- | :------- | :------- | :---------------------- |
| **Push Analysis to API** |          |          |          |                         |
| **Commit Graph to Git**  |          |          |          |                         |
| **Hydrate from Git**     |          |          |          |                         |
| **Cross-Clone Sync**     |          |          |          |                         |

---

## 2. Project 2: `tauri-apps/tauri` Benchmark

### Category: Indexing & Analysis (Graph Building)

| Feature / Metric           | Docuvia2  | GitNexus    | Graphify         | Code-Review-Graph (CRG) |
| :------------------------- | :-------- | :---------- | :--------------- | :---------------------- |
| **Full Graph Build**       | `analyze` | `analyze .` | `extract <path>` | `build --repo .`        |
| **Verified Build Result**  |           |             |                  |                         |
| **Verified Build Latency** |           |             |                  |                         |
| **Incremental Update**     |           |             |                  |                         |
| **Clear Local Index**      |           |             |                  |                         |

### Category: Query, Visualization & Impact

| Feature / Metric          | Docuvia2 | GitNexus | Graphify | Code-Review-Graph (CRG) |
| :------------------------ | :------- | :------- | :------- | :---------------------- |
| **Query Engine**          |          |          |          |                         |
| **Impact / Blast Radius** |          |          |          |                         |
| **Explain / Context**     |          |          |          |                         |
| **Visual Export**         |          |          |          |                         |
| **Docs / Wiki Gen**       |          |          |          |                         |

### Category: Remote Sync & Git Integration

| Feature / Metric         | Docuvia2 | GitNexus | Graphify | Code-Review-Graph (CRG) |
| :----------------------- | :------- | :------- | :------- | :---------------------- |
| **Push Analysis to API** |          |          |          |                         |
| **Commit Graph to Git**  |          |          |          |                         |
| **Hydrate from Git**     |          |          |          |                         |
| **Cross-Clone Sync**     |          |          |          |                         |

---

## 3. Observations & Findings

- **Docuvia2 Performance**:
- **Comparison & Regressions**:
- **Pending Verification — GRPH-006 Tier B `supportsQualifiedContainment` (flagged 2026-07-30, not yet a benchmark run)**:
  Tier A (`ast-worker.ts`) now resolves Rust containment (`impl Struct { fn method() {} }` →
  `containerName` = `"Struct"`, read from the impl block's own `type` field — see
  [GRPH-006](../gitbook/adr/graph/GRPH-006-qualified-symbol-table-node-key.md)). `RustLspEdgeProvider`
  deliberately still sets `supportsQualifiedContainment: false`, because flipping it needs to know
  rust-analyzer's real `textDocument/documentSymbol` nesting shape for an impl-block method (does
  the parent symbol's kind/name actually match the impl's target struct?) against a _live_
  rust-analyzer — not something that can be confirmed from source reading alone.
  **Needs an actual test**: spawn a real `rust-analyzer` against a small fixture crate with two
  same-named methods on different structs (mirroring `rust-lsp-edge-provider.unit.test.ts`'s
  existing fake-client test), call `documentSymbol`, and confirm whether/how each method's parent
  symbol carries the struct's identity before flipping the flag. Until then, Rust's Tier B path
  stays on the pre-GRPH-006 flat/collision-disambiguated key scheme even though Tier A itself is
  now qualified.
