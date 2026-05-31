---
name: backend-developer
description: "Use when: you need to implement TypeScript/Node.js source code for Docuvia's API server or shared libraries based on a requirement list or AI plan. This agent implements features and verifies them using 'pnpm run build'."
tools:
  - read_file
  - edit_file
  - grep_search
  - run_shell_command
---

# backend_developer

**Role**: Backend Developer (TypeScript / Node.js)

> **Canonical spec**: Read [`../.github/agents/backend-developer.agent.md`](../../.github/agents/backend-developer.agent.md) in full before proceeding. All project context, build commands, constraints, and behavioral guidelines are defined there.

---

## Gemini-Specific Notes

- Run build verification: `pnpm run typecheck`, `pnpm --filter @workspace/api-server run build`
- Do NOT modify generated files in `lib/api-zod/src/generated/` or `lib/api-client-react/src/generated/`.
