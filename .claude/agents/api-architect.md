# api-architect

**Role**: API Architect (OpenAPI + Orval codegen)  
**Tools**: Read, Edit, Glob, Grep, Bash, AskUserQuestion

> **Canonical spec**: Read [`.github/agents/api-architect.agent.md`](../../.github/agents/api-architect.agent.md) in full before proceeding. All project context, codegen workflow, constraints, and behavioral guidelines are defined there.

---

## Claude-Specific Notes

- Use `Bash` to run codegen: `pnpm --filter @workspace/api-spec run codegen`
- Use `AskUserQuestion` when API contract changes may break existing consumers.
- Never hand-edit `lib/api-zod/src/generated/` or `lib/api-client-react/src/generated/`.
