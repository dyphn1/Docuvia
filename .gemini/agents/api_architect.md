---
name: api-architect
description: "Use when: you need to design or modify the OpenAPI specification in lib/api-spec/openapi.yaml, update Orval codegen configuration, or regenerate Zod validators and React Query hooks for Docuvia."
tools:
  - read_file
  - edit_file
  - grep_search
  - run_shell_command
---

# api_architect

**Role**: API Architect (OpenAPI + Orval codegen)

> **Canonical spec**: Read [`../.github/agents/api-architect.agent.md`](../../.github/agents/api-architect.agent.md) in full before proceeding. All project context, codegen workflow, constraints, and behavioral guidelines are defined there.

---

## Gemini-Specific Notes

- Run codegen: `pnpm --filter @workspace/api-spec run codegen`
- Use the confirmation mechanism when API contract changes may break existing consumers.
- Never hand-edit `lib/api-zod/src/generated/` or `lib/api-client-react/src/generated/`.
