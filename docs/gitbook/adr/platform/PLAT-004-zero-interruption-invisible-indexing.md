---
id: PLAT-004
title: Zero-Interruption Invisible Indexing (Hook-Driven)
status: accepted
date: 2026-07-12
domains: [platform]
supersedes: [legacy/ADR-027]
superseded_by: []
---

# Zero-Interruption Invisible Indexing (Hook-Driven)

## Context
In the era of modern AI-assisted coding, development velocity has exploded. A developer working alongside AI agents (like Claude Code, Cursor, or Hermes) might generate dozens or hundreds of commits and modify thousands of lines of code in a single day. 

Traditional indexing tools (like GitNexus) require explicit, manual trigger commands or heavy background daemons that block the workspace, consume massive resources, and interrupt the developer's flow. For both human developers and AI agents, constantly waiting for an index to update before proceeding is a terrible user experience.

The core value of Docuvia is to **preserve and share knowledge without interrupting the work**. The indexing process must feel like "nothing happened." The tool must adapt to the developer, not force the developer to adapt to the tool.

## Decision
We enforce a **Zero-Interruption Invisible Indexing** architecture, strictly bound to Git's native lifecycle.

1. **Mandatory Git Requirement**: Docuvia requires the project to be a Git repository. We reject standalone folder support and deprecate all other VCS integrations (PLAT-008).
2. **Hook-Driven Automation**: During `docuvia init`, a lightweight Git hook (`post-commit`) is automatically installed.
3. **Background Delta Processing**: When a commit is made, the hook triggers a background process that performs a **delta update** (only analyzing the changed files) and flushes the result to the knowledge branch via `snapshot`.
4. **Zero-Friction Workflow**: Developers and AI Agents never need to manually run `docuvia analyze`. They simply write code and `git commit` as usual. The knowledge graph is kept perfectly in sync invisibly.

## Consequences
- **Positive**: Achieves the ultimate "invisible tool" experience. Completely eliminates the cognitive load of "remembering to update the index." Allows AI agents to work at maximum velocity without being blocked by indexers.
- **Negative**: Tightly couples the entire architecture to Git. Users who do not use Git cannot use Docuvia, but this is an acceptable tradeoff since Git is the undisputed industry standard. Requires highly optimized differential analysis to ensure the `post-commit` hook doesn't slow down the `git commit` command itself.
