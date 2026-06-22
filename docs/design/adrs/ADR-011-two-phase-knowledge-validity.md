# ADR-011: Two-Phase Knowledge Validity

**Status:** Accepted

**Context:**  
AI-generated knowledge nodes can originate from commits on any branch — including feature branches that are later abandoned. Treating all generated knowledge as equally valid regardless of its source branch’s fate would pollute the knowledge graph with decisions from discarded design attempts.

**Decision:**  
L3 knowledge validity is determined by two independent gates:

**Phase 1 — Local Review (Quality Gate):**  
The developer or reviewer inspects the AI-generated content in VS Code or the Web UI. They confirm whether the AI's interpretation is accurate. This gate ensures content quality and is the current `review_tasks` mechanism. Passing Phase 1 sets status to `pending`.

**Phase 2 — Merge Gate (Validity Gate):**  
When the `docuvia sync` hook fires on `git push`, the server checks whether the source commits have been merged into the main/default branch. Commits confirmed merged set their associated L3 nodes to `valid`. Commits on branches that are later deleted without merging cause their L3 nodes to be set to `orphaned` (archived by default, not shown in standard queries).

Both phases are required for `valid` status. A human-reviewed L3 node from an abandoned branch remains `pending` until/unless the branch is merged, then transitions to `valid`.

**Validity status enum:** `pending | valid | orphaned`

**MCP query behavior:** Default filter is `status = valid` only. Query parameter `include_pending=true` enables pending knowledge (e.g., for querying a specific feature branch's design decisions).

**Consequences:**

- ✅ Abandoned design attempts do not contaminate the canonical knowledge graph
- ✅ In-progress work is visible to collaborators (with clear status labels)
- ✅ The review queue (Phase 1) retains its existing role; Phase 2 is additive
- ⚠️ Server must track branch merge status — requires either GitHub webhook integration or periodic polling
- ⚠️ `l3_nodes` and `commits` tables require `validityStatus` column
- ⚠️ `commits` table requires `branchName text` column
