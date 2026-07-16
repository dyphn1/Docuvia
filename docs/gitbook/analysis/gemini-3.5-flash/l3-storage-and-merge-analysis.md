# Docuvia2 L3 Decision Storage & Git Knowledge Branch Merge Strategy Report

> **Context**: This report provides an in-depth analysis and proposed design for how L3 nodes (AI decisions, Rules, architectural context) in Docuvia2 are stored on the Git knowledge branch, and how lossless merging is handled in Multi-Clone scenarios.
> **Date**: 2026-07-16
> **Status**: Independent Analysis Report

---

## 1. Core Contradiction: Deterministic L2 vs. Accumulative L3

In the three-tiered background evolution design of `PLAT-007`, **L2 nodes (AST syntax trees)** and **L3 nodes (AI-generated architectural decisions & Rules)** have fundamentally different data attributes:

1. **L2 is Deterministic and strongly bound to the source code**:
   - When code reverts to an old Commit, the L2 graph should revert to that old state.
   - If code at point A is newer than B, A's L2 graph can directly overwrite B (this is the basis of the **Tree-Adoption** strategy currently used by `KnowledgeGitService`).
2. **L3 is Accumulative and non-deterministic**:
   - Generated via incremental LLM extraction triggered by different developers at different times on different snippets of source code.
   - If L3 adopts the same "Topological newest takes all" merge strategy as L2, it will result in: **The L3 decisions painstakingly accumulated by developer B being completely wiped out during Git Merge simply because developer A submitted more recent code.**

Therefore, we must design a **"Decentralized, Collision-proof, Losslessly Accumulative"** L3 storage and merge solution.

---

## 2. Limitations & Solutions for Physical Identification

In the SQLite database, the `l3_nodes` table uses an **auto-incrementing integer `id`** and foreign key **`l2_node_id`**:

```sql
CREATE TABLE IF NOT EXISTS l3_nodes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  l2_node_id INTEGER NOT NULL, -- Relates to L2
  title TEXT NOT NULL,
  content TEXT,
  content_hash TEXT, -- SHA-256 hash of L3 content
  ...
);
```

### 🚨 The Fatal Flaw of Physical Identification

In SQLite, `l2_node_id` is an unstable auto-incrementing integer.

- In Developer A's `local.db`, `FileX`'s id might be `42`.
- In Developer B's `local.db`, `FileX`'s id might be `99`.
- **Absolute Taboo**: We **absolutely cannot** directly serialize rows with `l2_node_id` to the Git knowledge branch.

### 💡 Solution: Logical Key Mapping

When writing L3 to the Git knowledge branch, the **`node_key` of L2** (e.g., the logical identifier defined in `lib/contracts`, like `l2:lib-core-src-git-hydration`) must be used as the unique bridge for cross-machine alignment.

- **When writing to Git**: Convert the foreign key `l2_node_id` to its corresponding L2 node's `node_key` and write it into the Frontmatter.
- **During Git Hydration**: First, look up the auto-incrementing `l2_node_id` allocated in the current database based on `node_key` in local SQLite, and then write the `l3_nodes` row.

---

## 3. Three Feasible Solutions for L3 Storage on the Git Knowledge Branch

We need to write `l3_nodes` from SQLite to the Git branch. The following three solutions are viable:

```mermaid
graph TD
    A[L3 Storage Solution Evaluation] --> B[Solution A: JSONL Centralized Append]
    A --> C[Solution B: Markdown Collaborative Decentralization]
    A --> D[Solution C: Independent L3 Decision Cards]

    B --> B1[Append to graph/l3_nodes.jsonl]
    C --> C1[Merge into Frontmatter of knowledge/path/file.md]
    D --> D1[Write to knowledge/_l3/{content_hash}.md]
```

### Solution A: Centralized `graph/l3_nodes.jsonl` Append

Similar to `nodes.jsonl` and `edges.jsonl`, create a `graph/l3_nodes.jsonl`, saving one L3 JSON per line.

- **Pros**: Extremely fast parsing; hydration only requires simple `JSON.parse` for batch writing.
- **Cons**:
  - **Git Conflict Hell**: JSONL is order-sensitive. If two developers concurrently generate L3 and append to EOF, Git will encounter conflicts due to "simultaneous modification of the last line" and fail to merge automatically.
  - **No Human Readability**: Loses the original intention of Git Isomorphic allowing humans to read knowledge in GitBook/Git interfaces.

### Solution B: Decentralized Markdown Integration (Co-location in Frontmatter)

Merge L3 decisions directly into the associated L2 node's (file or symbol) corresponding `.md` file under `knowledge/`. For instance, in the Frontmatter of `knowledge/lib/core/src/git/hydration.service.md`:

```yaml
---
id: "l2:hydration-service-node-key"
kind: "symbol"
name: "HydrationService"
filePath: "lib/core/src/git/hydration.service.ts"
l3_decisions:
  - title: "STOR-002: hydration must use bulk transaction"
    content_hash: "a1b2c3d4..."
    node_type: "decision"
    content: "We use write locks and raw transactions to repair..."
---
```

- **Pros**:
  - **Natural Git 3-Way Merge**: If A modifies `file1.ts` L3, and B modifies `file2.ts` L3, since they are in different `.md` files, Git will **automatically merge without conflicts** when merging the knowledge branch!
  - **Excellent Context**: Human developers reading L2 Markdown can see all AI decisions bound to this Symbol at a glance.
- **Cons**:
  - During hydration, it requires parsing the Frontmatter of every Markdown file, presenting a higher I/O and parsing performance overhead compared to JSONL (can be optimized via caching and read-only diffs).

### Solution C: Independent L3 Decision Cards (Standalone L3 Markdown File)

Create a dedicated L3 directory under `knowledge/` (e.g., `knowledge/_l3/`), saving each L3 node as an independent Markdown file named by its `content_hash` or `title_slug`:

```markdown
---
id: "l3:a1b2c3d4..."
title: "STOR-002: hydration must use bulk transaction"
node_type: "decision"
confidence: 0.95
associated_l2_nodes:
  - "l2:hydration-service-node-key"
---

# STOR-002: hydration must use bulk transaction

We use write locks and raw transactions to repair...
```

- **Pros**:
  - **Absolute Zero Conflicts**: Because the filename is generated based on `content_hash`, different decisions produced by different developers will definitely have different filenames. When Git merges branches, it simply "adds" the files from both sides together, **resulting in absolutely zero Git conflicts**.
  - Perfectly fits the decentralized design of Architecture Decision Records (ADR) or "Decision Logs".
- **Cons**: Relationships are slightly scattered, requiring bidirectional parsing of `associated_l2_nodes` during hydration.

---

## 4. Comprehensive Evaluation of the Three Storage Solutions

| Dimension             | Sol A (JSONL Central Append) | Sol B (L2 MD Frontmatter Integ)     | Sol C (Independent L3 Cards)             |
| :-------------------- | :--------------------------- | :---------------------------------- | :--------------------------------------- |
| **Read/Write Perf**   | 🚀 Extremely Fast            | 🐢 Slow (Needs multiple MD parsing) | 🟡 Medium (New files)                    |
| **Human Readability** | ❌ Very Poor                 | 🟢 Excellent (Complete context)     | 🚀 Superb (ADR Cards)                    |
| **Git Merge Flow**    | ❌ Poor (EOF conflicts)      | 🟡 Medium (Same file mod conflicts) | 🚀 Perfect (Hash filenames, 0 conflicts) |
| **System Coupling**   | 🟡 Tightly coupled to L2     | 🔴 Highly dependent on L2 structure | 🚀 Completely Decoupled                  |

> **🌟 Final Feasible Recommendation: A hybrid model of Solution C (Independent L3 Decision Cards) + Solution B (Linked association in L2 Markdown).**
> This ensures that when L3 is written to Git, knowledge automatically analyzed by different developers in the background can be merged in a "zero-conflict, fully accumulative" format during Git Push/Pull.

---

## 5. How Git Knowledge Branch Commits Merge L3 (Resolving Tree-Adoption Overwrites)

Currently, `KnowledgeGitService.mergeDivergedBranches` uses **Tree-Adoption**. Its logic is:

1. Compare `Docuvia-Source` of A and B.
2. Find whose code Commit SHA is newer (Descendant).
3. **Winner-Take-All**: Directly overwrite the loser with the winner's entire Git Tree (including `graph/` and `knowledge/`).

This causes L3 knowledge generated by the non-winner branch to be ruthlessly wiped out when Divergence occurs. We propose the following two solutions:

### 💡 Solution A: Directory-Level Split Merge

We shouldn't treat the entire knowledge branch as an indivisible Tree for full overwriting. Instead, we should **treat it per directory (Scope)**:

```text
  Knowledge Branch Split Merge
         ├── [graph/] & [knowledge/src/] (L2 AST Structure)
         │     └── Use ➜ Winner-Take-All (Tree-Adoption) ✅ Maintains code isomorphism
         │
         └── [knowledge/_l3/] (L3 AI Decisions)
               └── Use ➜ Git 3-Way Merge 🚀 Achieves lossless accumulation of knowledge
```

#### Implementation Steps

When `mergeDivergedBranches` executes the merge:

1. Find the Common Ancestor commit of A and B (`git merge-base`).
2. For `graph/` and L2 Markdown, continue using **Tree-Adoption**: directly apply the topological winner's directories.
3. For `knowledge/_l3/` (L3 decision directory):
   - Call `git read-tree` or utilize the staging area (Index) to perform a **3-Way Merge** of both sides' `_l3/` directories.
   - Since L3 files are named `content_hash.md`, the 3-Way Merge will automatically preserve all non-duplicate L3 decisions added independently by A and B, and deduplicate identical files (same `content_hash`).
4. Combine the merged results of these two parts in memory to establish a new **2-Parent Merge Commit**.

---

### 💡 Solution B: SQLite Bidirectional Hydration Recovery (Post-Merge SQLite Hydration Recovery)

This is an elegant solution that doesn't require modifying complex Git Merge internals, instead utilizing **local local.db as a cache buffer**.

```text
Step 1: Local Analysis ➜ L3 written to local.db (with content_hash and node_key)
Step 2: Git Sync ➜ Knowledge branch Tree-Adoption merge occurs (even if A overwrites B, B temporarily vanishes on Git)
Step 3: Local Hydration Check ➜ local.db notices some L3 content_hashes present locally have "vanished" from the Git tree
Step 4: Auto-Repair ➜ Local hydration engine rewrites the vanished L3 into snapshots, and initiates a new small Commit to append them back to the Git branch
```

#### Implementation Steps

1. When a developer runs `snapshot` or background analysis, the system doesn't just treat SQLite as read-only, but **Unions "L3 in SQLite" with "L3 restored from Git knowledge branch"**.
2. If it discovers certain L3 nodes with `validity_status = 'active'` in SQLite do not exist in current Git Branch files (perhaps overwritten by someone else's Tree-Adoption):
   - `SnapshotRendererService` automatically outputs these lost L3s again as `_l3/{hash}.md`.
   - Re-packs and Commits, "rescuing" this knowledge and pushing it.
3. **Advantage**: This ensures **"As long as any developer's local `local.db` still contains this L3 knowledge, it will never completely vanish from the Git branch"**, achieving incredibly robust decentralized fault tolerance, without touching complex `libgit2` or tree-merge internals at all.
