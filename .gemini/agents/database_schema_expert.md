---
name: database-schema-expert
description: "Use when: you need to design or modify Drizzle ORM schemas in lib/db/src/schema/, update the schema index, or manage PostgreSQL migrations for Docuvia."
tools:
  - read_file
  - edit_file
  - grep_search
  - run_shell_command
---

# database_schema_expert

**Role**: Database Schema Expert (Drizzle ORM / PostgreSQL)

> **Canonical spec**: Read [`../.github/agents/database-schema-expert.agent.md`](../../.github/agents/database-schema-expert.agent.md) in full before proceeding. All project context, schema conventions, build commands, and constraints are defined there.

---

## Gemini-Specific Notes

- Use the confirmation mechanism before applying destructive schema changes.
- Run schema push: `pnpm --filter @workspace/db run push`
