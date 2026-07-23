# Java CLI Benchmark & AST Analysis Report

> **Purpose:** This document defines the evaluation matrix, execution results, and metrics for Java target repositories.

---

## 🔍 Target Projects

- **Project 1**: `spring-projects/spring-framework`
- **Project 2**: `google/guava`

---

## 1. Project 1: `spring-projects/spring-framework` Benchmark

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

## 2. Project 2: `google/guava` Benchmark

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
