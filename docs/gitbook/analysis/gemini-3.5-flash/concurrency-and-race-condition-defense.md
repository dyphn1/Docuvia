# Docuvia2 Concurrency Conflict Defense & Physical Lock Mechanism Report (PLAT-006)

> **Context**: Based on the design principles of `PLAT-006`, this report provides an in-depth analysis of race conditions resulting from high-frequency CLI concurrency, collisions between background analysis and foreground read commands (e.g., `analyze` + `snapshot` / `doctor` + `hydrate`), and designs corresponding physical defense locks.
> **Date**: 2026-07-16
> **Status**: Independent Analysis Report

---

## 1. Concurrency Race Conditions Analysis

In Docuvia2, foreground reading, background automated analysis, snapshot packing, and remote synchronization are all executed concurrently by multiple processes. Without a central Daemon, the following three concurrency pairs will result in severe Race Conditions:

```text
[Foreground UI / Read Commands]      [Background Automated Analysis / Write Commands]
  - query                              - analyze (Auto Mode)
  - doctor                             - hydrate
  - export-topology                    - snapshot
```

### 🚨 Race A: `analyze` (Incremental Write) + `snapshot` (Pack Snapshot)

- **Conflict**: `analyze` is incrementally modifying L2 nodes and writing new SQLite Rows. Meanwhile, `snapshot` is triggered and calls `store.graph.getAllNodes()`.
- **Physical Consequences**:
  - **Dirty Read**: `snapshot` might pack a partial, intermediate state graph with incomplete relationships.
  - **SQLite Locking**: If `analyze` opens a write transaction and `snapshot` attempts to open a read-only transaction, an `SQLITE_BUSY` exception could be triggered.

### 🚨 Race B: `doctor` (System Diagnostics) + `hydrate` (Restore)

- **Conflict**: `hydrate` is executing `bulkLoadGraph` (which completely clears `l2_nodes`, `node_links`, and rebuilds). Meanwhile, the developer runs `doctor`, and `doctor` attempts to call the database to check integrity.
- **Physical Consequences**:
  - `doctor` might mistakenly think the entire project is "uninitialized or completely corrupted" during the brief window of clearing and rebuilding, reporting an erroneous diagnostic report to the developer.

### 🚨 Race C: `query` (Foreground Read) + `analyze` (Background Write)

- **Conflict**: The developer executes `docuvia query` in the terminal to query the blast radius, while the background Post-Commit Hook silently executes `docuvia analyze` modifying the L2 topology.
- **Physical Consequences**: Foreground reads outdated or inconsistent L2 data, resulting in an inaccurate impact radius.

---

## 2. Physical Defense Mechanism: SQLite WAL Mode + Granular Locking

To resolve these race conditions, Docuvia2 establishes a dual physical defense line:

### 2.1 First Defense Line: Enable SQLite WAL (Write-Ahead Logging) Mode

When opening a SQLite connection, we must explicitly specify WAL mode and configure `busy_timeout`:

```typescript
db.pragma("journal_mode = WAL");
db.pragma("synchronous = NORMAL");
db.configure("busyTimeout", 10000); // 10 seconds busy timeout
```

- **The Salvation of WAL**: **"Reads and writes do not block each other"**. In WAL mode, a writer (like `analyze`) writes changes to the WAL file, which does not block a reader (like `query` or `snapshot`). The reader will see a consistent snapshot from before the changes, completely resolving read-write conflicts.

---

### 2.2 Second Defense Line: Single-Flight Locks & Knowledge Branch Lock

Even if WAL resolves read-write mutual exclusion, **concurrency conflicts between multiple writers (e.g., two `analyze` concurrently, or `analyze` concurrent with `hydrate`)** will still result in SQLite `SQLITE_BUSY`.

We must implement two physical locks in `lib/contracts`:

#### 🔒 Lock A: Database Write Lock (Exclusive)

Implemented by `IGraphStore.withWriteLock`. It must be enforced in database-writing Workflows (like `init`, `analyze`, `hydrate`):

```typescript
export interface IGraphStore {
  // Cooperates with SQLite exclusive locks (IMMEDIATE transactions) or local Lock files
  withWriteLock<T>(fn: () => Promise<T> | T): Promise<T>;
  withReadLock<T>(fn: () => Promise<T> | T): Promise<T>;
}
```

#### 🔒 Lock B: Knowledge Branch Lock

Implemented by `withKnowledgeBranchLock` (`lib/core/src/git/knowledge-branch-lock.ts`). This lock specifically prevents conflicts between **background Snapshot packing (`packSnapshot`)** and **remote knowledge synchronization (`syncKnowledgeBranch`)**.

- **Implementation Principle**: Uses the local `.docuvia/locks/knowledge-branch.lock` file.
- **Lock Protected Area**:
  ```typescript
  export async function withKnowledgeBranchLock<T>(
    git: IGitProvider,
    cwd: string,
    fn: () => Promise<T> | T,
  ): Promise<T> {
    // Acquire file exclusive lock, wait if already occupied
    // Execute fn()
    // Release lock
  }
  ```

---

## 3. Core Workflow Safety Matrix

To ensure 100% system stability, all Workflows must strictly adhere to the following physical locking rules during execution:

| Workflow               | Required DB Lock           | Required Git Knowledge Branch Lock | Notes                                                       |
| :--------------------- | :------------------------- | :--------------------------------- | :---------------------------------------------------------- |
| **`init`**             | 🔴 `WriteLock` (IMMEDIATE) | ❌ None                            | Ensures initialization & migrations are uninterrupted       |
| **`analyze` (Tier A)** | 🔴 `WriteLock` (IMMEDIATE) | ❌ None                            | Incremental modification of L2/L3 data, does not touch Git  |
| **`snapshot`**         | 🟢 `ReadLock` (Shared)     | 🔴 `KnowledgeBranchLock`           | Protects temp dir & branch writes during packing            |
| **`sync-knowledge`**   | ❌ None (No DB read)       | 🔴 `KnowledgeBranchLock`           | Must be protected when pushing/pulling Git knowledge branch |
| **`hydrate`**          | 🔴 `WriteLock` (IMMEDIATE) | ❌ None                            | Batch write to rebuild L2                                   |
| **`doctor`**           | 🟢 `ReadLock` (Shared)     | ❌ None                            | Read-only analysis, no exclusivity needed                   |

---

## 4. Concrete Defense Implementation Recommendations

To make the concurrency defenses bulletproof, the following tests and designs should be added in Phase 1:

1. **Concurrency Stress Tests**:
   - In the test suite, launch 10 concurrent Promises invoking `docuvia analyze` (incrementally parsing the same repository) simultaneously to verify if `withWriteLock` can perfectly serialize them without throwing any `SQLITE_BUSY`.
   - Simultaneously launch `doctor` and `hydrate` to verify if `doctor` can read consistent legacy data under WAL snapshot isolation, instead of a half-empty state during rebuilding.
2. **Unattended Deadlock Avoidance**:
   - All locking mechanisms must have **"Timeout automatic release"** and **`process.on('exit')` cleanup** features.
   - Avoid background Sleeper processes leaving eternal Stale Locks due to abnormal crashes, which would cause foreground commands to hang indefinitely.
