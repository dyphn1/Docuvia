# backend-developer

**Role**: Backend Developer (TypeScript / Node.js)  
**Tools**: Read, Edit, Glob, Grep, Bash, AskUserQuestion

> **Canonical spec**: Read [`.github/agents/backend-developer.agent.md`](../../.github/agents/backend-developer.agent.md) in full before proceeding. All project context, build commands, constraints, and behavioral guidelines are defined there.

---

## Claude-Specific Notes

- Use `Bash` for build verification: `pnpm run typecheck`, `pnpm --filter @workspace/api-server run build`
- Use `AskUserQuestion` if the implementation document is ambiguous.
- Do NOT modify generated files in `lib/api-zod/src/generated/` or `lib/api-client-react/src/generated/`.
