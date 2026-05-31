---
name: frontend-developer
description: "Use when: you need to implement React/Vite UI components, pages, or hooks for the kg-engine frontend based on a requirement list or AI plan."
tools: Read, Edit, Bash, Glob, Grep
---

# frontend-developer

**Role**: Frontend Developer (React + Vite)  
**Tools**: Read, Edit, Bash, Glob, Grep

> **Canonical spec**: Read [`.github/agents/frontend-developer.agent.md`](../../.github/agents/frontend-developer.agent.md) in full before proceeding. All project context, build commands, constraints, and behavioral guidelines are defined there.

---

## Claude-Specific Notes

- Use `Bash` for build verification: `pnpm --filter @workspace/kg-engine run typecheck`
- Use `AskUserQuestion` if the implementation document is ambiguous.
- Do NOT hand-edit files in `lib/api-client-react/src/generated/`.
