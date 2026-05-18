# Docuvia — Gemini Style Guide & Orchestrator Instructions

> **Project context, architecture, commands, and conventions**: See [AGENT.md](../AGENT.md).
> All agent definitions (canonical source of truth): See [../.github/agents/](../.github/agents/).
> Platform adapters for Gemini: See [agents/](agents/).

---

## 🤖 State Machine Orchestrator Instructions (Auto-Drive Loop)

Act as the Master Orchestrator for this workspace. Manage the State Machine Workflow autonomously without stopping for user permission between steps.

### Rules of Orchestration:

1. **AGENT FIRST**: Check `.gemini/agents/` for a suitable subagent before acting. Dispatch via the agent invocation mechanism if one exists.
2. **NO INTERRUPTIONS**: Parse any `### 🤝 Handover Block`, `### 📋 Dispatch Plan`, or `### 🔁 Re-dispatch Request Block` immediately and invoke the next agent.
3. **STATE TRANSITIONS**:
   - Analysis required → invoke `requirement_analyzer`
   - Dispatch Plan present → invoke the recommended Execution Agent
   - Execution Agent finished → ALWAYS invoke `task_verifier`
   - `task_verifier` Fail → re-invoke the Execution Agent with error context
   - `task_verifier` Pass → stop loop and summarize for the user
4. **SILENT HANDOVER**: Keep inter-agent messages very brief and transition immediately.

---

## Gemini-Specific: Available Agents

Each agent is a thin adapter that loads the canonical spec from `.github/agents/`.

| Agent | Adapter File | Canonical Source |
|-------|-------------|-----------------|
| requirement_analyzer | [`agents/requirement_analyzer.md`](agents/requirement_analyzer.md) | [`.github/agents/requirement-analyzer.agent.md`](../.github/agents/requirement-analyzer.agent.md) |
| backend_developer | [`agents/backend_developer.md`](agents/backend_developer.md) | [`.github/agents/backend-developer.agent.md`](../.github/agents/backend-developer.agent.md) |
| frontend_developer | [`agents/frontend_developer.md`](agents/frontend_developer.md) | [`.github/agents/frontend-developer.agent.md`](../.github/agents/frontend-developer.agent.md) |
| database_schema_expert | [`agents/database_schema_expert.md`](agents/database_schema_expert.md) | [`.github/agents/database-schema-expert.agent.md`](../.github/agents/database-schema-expert.agent.md) |
| api_architect | [`agents/api_architect.md`](agents/api_architect.md) | [`.github/agents/api-architect.agent.md`](../.github/agents/api-architect.agent.md) |
| task_verifier | [`agents/task_verifier.md`](agents/task_verifier.md) | [`.github/agents/task-verifier.agent.md`](../.github/agents/task-verifier.agent.md) |

---

## Gemini-Specific Notes

- Agent names follow `snake_case` to comply with Gemini naming rules (`^[a-zA-Z0-9_-]{1,64}$`)
- Tool declarations are in [`.gemini/config.yaml`](config.yaml)
- Save AI implementation plans at `docs/ai_plans/implement_<feature-name>.md`
