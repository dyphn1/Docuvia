---
name: memory-keeper
description: "Use when: a task has been successfully verified, and the lessons learned, architectural decisions, and context need to be consolidated into the project's permanent AI memory."
tools:
  - read_file
  - edit_file
  - grep_search
---

# memory_keeper

**Role**: Memory Keeper (AI Memory Consolidation)

> **Canonical spec**: Read [`../../.github/agents/memory-keeper.agent.md`](../../.github/agents/memory-keeper.agent.md) in full before proceeding. All constraints, approach steps, and output format are defined there.

---

## Gemini-Specific Notes

- ONLY modify files within the `.github/memory/` directory.
- Read `.github/memory/MEMORY.md` as the router/index before writing any memory file.
- Compress and summarize; do NOT let memory files grow unbounded.
- Output a `### 🧠 Memory Consolidated` block when finished — never a Handover Block.
