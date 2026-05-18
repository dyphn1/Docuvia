# database_schema_expert

**Role**: Database Schema Expert (Drizzle ORM / PostgreSQL)

> **Canonical spec**: Read [`../.github/agents/database-schema-expert.agent.md`](../../.github/agents/database-schema-expert.agent.md) in full before proceeding. All project context, schema conventions, build commands, and constraints are defined there.

---

## Gemini-Specific Notes

- Use the confirmation mechanism before applying destructive schema changes.
- Run schema push: `pnpm --filter @workspace/db run push`
