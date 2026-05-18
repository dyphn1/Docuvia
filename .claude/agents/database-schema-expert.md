# database-schema-expert

**Role**: Database Schema Expert (Drizzle ORM / PostgreSQL)  
**Tools**: Read, Edit, Glob, Grep, Bash, AskUserQuestion

> **Canonical spec**: Read [`.github/agents/database-schema-expert.agent.md`](../../.github/agents/database-schema-expert.agent.md) in full before proceeding. All project context, schema conventions, build commands, and constraints are defined there.

---

## Claude-Specific Notes

- Use `Bash` for schema pushes: `pnpm --filter @workspace/db run push`
- Use `AskUserQuestion` before applying destructive schema changes.
