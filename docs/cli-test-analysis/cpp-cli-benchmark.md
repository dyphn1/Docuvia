# C++ CLI Benchmark & AST Analysis Report

> **Purpose:** This document defines the evaluation matrix, execution results, and metrics for C++ target repositories.

---

## 🔍 Target Projects

- **Project 1**: `llvm/llvm-project`
- **Project 2**: `tensorflow/tensorflow`

---

## 1. Project 1: `llvm/llvm-project` Benchmark

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

## 2. Project 2: `tensorflow/tensorflow` Benchmark

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
  Tier A (`ast-worker.ts`) now resolves BOTH inline methods (already worked once `cpp.ts`'s
  functions query was fixed to actually extract them — that query previously matched free
  functions only, silently returning zero class methods) AND out-of-line `Ret Class::method(){}`
  definitions (read from the qualified declarator's own `scope` field — see
  [GRPH-006](../gitbook/adr/graph/GRPH-006-qualified-symbol-table-node-key.md)). `CppLspEdgeProvider`
  deliberately still sets `supportsQualifiedContainment: false` — the original caution here was
  specifically that clangd's `documentSymbol` tree may nest an out-of-line method under its class
  _semantically_ even though it isn't textually nested; now that Tier A also covers that case, the
  open question shifts from "Tier A can't do this" to "does clangd's real nesting agree with Tier
  A's rule for every case (multi-level qualifiers, templates, etc.)" — not verifiable from source
  reading alone. `CppLspConfig` is also shared across `.c`/`.h` files, which have no containment
  concept at all (permanently N/A, not part of this question).
  **Needs an actual test**: spawn a real `clangd` against a small fixture with both an inline
  method and an out-of-line qualified definition on the same class, call `documentSymbol`, and
  confirm whether/how the out-of-line method's parent symbol carries the class's identity before
  flipping the flag. Until then, C++'s Tier B path stays on the pre-GRPH-006 flat/collision-
  disambiguated key scheme even though Tier A itself is now qualified for both cases.
