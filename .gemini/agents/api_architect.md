# api_architect

**Role**: API Architect (OpenAPI + Orval codegen)

> **Canonical spec**: Read [`../.github/agents/api-architect.agent.md`](../../.github/agents/api-architect.agent.md) in full before proceeding. All project context, codegen workflow, constraints, and behavioral guidelines are defined there.

---

## Gemini-Specific Notes

- Run codegen: `pnpm --filter @workspace/api-spec run codegen`
- Use the confirmation mechanism when API contract changes may break existing consumers.
- Never hand-edit `lib/api-zod/src/generated/` or `lib/api-client-react/src/generated/`.
