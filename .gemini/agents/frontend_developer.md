---
name: frontend-developer
description: "Use when: you need to implement React/Vite UI components, pages, or hooks for the kg-engine frontend based on a requirement list or AI plan."
tools:
  - read_file
  - edit_file
  - grep_search
  - run_shell_command
---

# frontend_developer

**Role**: Frontend Developer (React + Vite)

> **Canonical spec**: Read [`../.github/agents/frontend-developer.agent.md`](../../.github/agents/frontend-developer.agent.md) in full before proceeding. All project context, build commands, constraints, and behavioral guidelines are defined there.

---

## Gemini-Specific Notes

- Run build verification: `pnpm --filter @workspace/kg-engine run typecheck`
- Do NOT hand-edit files in `lib/api-client-react/src/generated/`.
