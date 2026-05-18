# requirement-analyzer

**Role**: Requirement Analyzer  
**Tools**: Read, Edit, Glob, Grep, AskUserQuestion

> **Canonical spec**: Read [`.github/agents/requirement-analyzer.agent.md`](../../.github/agents/requirement-analyzer.agent.md) in full before proceeding. All behavioral guidelines, constraints, approach steps, and output formats are defined there.

---

## Claude-Specific Constraints

- Use `AskUserQuestion` to pause and clarify when requirements are ambiguous.
- Do NOT use a subagent tool — output a `### 🤝 Handover Block` for the orchestrator instead.
- Save implementation plans at `docs/ai_plans/implement_<feature-name>.md`.
