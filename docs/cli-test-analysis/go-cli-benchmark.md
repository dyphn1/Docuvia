# Go (Golang) CLI Benchmark & AST Analysis Report

> **Purpose:** This document defines the evaluation matrix, execution results, and metrics for Go (Golang) target repositories.

---

## 🔍 Target Projects

- **Project 1**: `moby/moby`
- **Project 2**: `gin-gonic/gin`

---

## 1. Project 1: `moby/moby` Benchmark

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

## 2. Project 2: `gin-gonic/gin` Benchmark

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
  Tier A (`ast-worker.ts`) now resolves Go containment for both value- and pointer-receiver methods
  (read directly from the `method_declaration`'s own `receiver` field — see
  [GRPH-006](../gitbook/adr/graph/GRPH-006-qualified-symbol-table-node-key.md)). `GoLspEdgeProvider`
  deliberately still sets `supportsQualifiedContainment: false`, because flipping it needs to know
  gopls's real `textDocument/documentSymbol` nesting shape for a receiver method (does the parent
  symbol's kind/name actually match the receiver type?) against a _live_ gopls — not something that
  can be confirmed from source reading alone.
  **Needs an actual test**: spawn a real `gopls` against a small fixture module with two
  same-named methods on different receiver types, call `documentSymbol`, and confirm whether/how
  each method's parent symbol carries the receiver type's identity before flipping the flag. Until
  then, Go's Tier B path stays on the pre-GRPH-006 flat/collision-disambiguated key scheme even
  though Tier A itself is now qualified.
