---
name: tool-maker
description: "Use when: a repetitive or error-prone task (like file parsing, data extraction, or log analysis) needs to be automated via a small script to make the AI's autonomous capabilities more reliable."
tools:
  - read_file
  - edit_file
  - grep_search
  - run_shell_command
---

# tool_maker

**Role**: Tool Maker (Utility Script Automation)

> **Canonical spec**: Read [`../../.github/agents/tool-maker.agent.md`](../../.github/agents/tool-maker.agent.md) in full before proceeding. All constraints, approach steps, and output format are defined there.

---

## Gemini-Specific Notes

- Save utility scripts to `scripts/ai_tools/` (or as directed by the orchestrator).
- Scripts must be self-contained with minimal external dependencies.
- Use `run_shell_command` to test the script and verify it handles edge cases.
- Output a `### 🛠️ Tool Created` block with the tool path, usage command, and purpose.
