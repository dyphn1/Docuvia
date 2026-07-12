---
id: STOR-003
title: JSONL + Granular Markdown On-Disk Format
status: accepted
date: 2026-07-06
domains: [storage]
supersedes: [legacy/ADR-023]
superseded_by: []
---

# JSONL + Granular Markdown On-Disk Format

## Context
Since the Git branch is our sole source of truth (STOR-001) and we rely on a Continuous Merge strategy to synchronize knowledge across the team, the serialization format is critical. 

If we export the entire knowledge graph as a single monolithic `data.json` file, two developers extracting knowledge simultaneously will inevitably trigger massive, unresolvable Git merge conflicts. A single comma change in a 100MB JSON file breaks the entire array structure during a git merge.

### The Conflict Scenario (Why Monolithic JSON fails)
Imagine Developer A adds a node at the beginning of a JSON array, and Developer B adds a node at the end. Because they both modified the outer `[ ... ]` array structure (e.g., altering trailing commas), Git sees structural conflict across the entire file.

```mermaid
gitGraph
    commit id: "Initial Graph"
    branch devA
    checkout devA
    commit id: "Dev A analyzes Auth"
    checkout main
    branch devB
    checkout devB
    commit id: "Dev B analyzes DB"
    checkout main
    merge devA
    merge devB type: REVERSE highlight: true
    %% In a monolithic JSON, the second merge results in a catastrophic structural conflict requiring manual parsing.
```

## Decision
We utilize a hybrid `JSONL + Granular Markdown` format for the Git export.

1. **`nodes.jsonl` and `edges.jsonl`**: Store structural metadata efficiently. JSONL (JSON Lines) ensures that every node or edge is an independent, newline-terminated JSON object.
   - **Git Merge Compatibility**: Adding, removing, or updating a single node results in a clean 1-line git diff. Git can easily auto-merge these line-by-line changes from multiple developers without breaking the overall file structure.
   
   **Example JSONL Diff (Mergeable):**
   ```diff
   {"id": "auth.ts", "type": "module"}
   + {"id": "jwt.ts", "type": "function"}
   {"id": "db.ts", "type": "module"}
   ```

2. **Granular Markdown**: The content of L3 nodes (Domain Knowledge) is stored as individual `.md` files in a structured folder hierarchy (e.g., `knowledge/domains/auth.md`). This isolates semantic conflicts and makes the knowledge highly readable for humans browsing the repository without executing queries.

## Consequences
- **Positive**: Git diffs are highly readable. Developers can review knowledge changes in standard Pull Requests. Line-by-line JSONL prevents catastrophic merge conflicts and perfectly supports the "Latest Wins" continuous merge strategy.
- **Negative**: Adds serialization/deserialization overhead during the `snapshot` and hydration processes compared to dumping raw SQLite binaries.
