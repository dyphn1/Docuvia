---
description: A GitHub Copilot Chat Skill that sets up a full agentic workflow scaffold for a project, including core sub-agents, orchestrator instructions, and the agent-launcher skill.
---

# create-agent-launcher

A GitHub Copilot Chat Skill that sets up a complete agentic workflow scaffold tailored to the current project. It creates the core sub-agents (Requirement Analyzer, Backend Developer, Task Verifier), the orchestrator instructions, and the agent-launcher skill.

---

## Features

- **Project-Specific Scaffold:** Reads existing project documentation (`README.md`, `AGENT.md`, `CLAUDE.md`, etc.) to generate agents tailored to the project's tech stack and constraints.
- **Smart Discovery:** Automatically detects project structure, build tools, and languages (e.g., C#, TypeScript, Python) from configuration files.
- **Extensible Agents:** Proposes additional specialist agents based on project signals (e.g., Shell Script Expert, Frontend Developer, Architecture Reviewer).
- **Non-Destructive:** Reuses existing agents when present and avoids overwriting existing files without user confirmation.

---

## Usage

Invoke the skill when you need to initialize or update the agentic workflow for your project. Typical prompts include setting up or updating the scaffold. The skill will interactively guide you through the setup process, confirming target directories and required agents.

---

## Workflow

1. **Discover Existing Scaffold:** Checks the target directory (default: `.github/`) for any existing agents, instructions, or skills to prevent unwanted overwrites.
2. **Confirm Location:** Asks the user to confirm the target directory for the agent scaffold.
3. **Read Documentation:** Extracts project name, tech stack, build commands, and architectural rules from existing documentation files.
4. **Analyze Project Structure:** Inspects configuration files (like `package.json`, `*.csproj`) to determine the exact agent variants needed.
5. **Determine Additional Agents:** Suggests extra agents (like Frontend Developer or Architecture Reviewer) if the project structure warrants them.
6. **Generate Files:** Creates the Orchestrator instructions and the necessary sub-agents, injecting project-specific context via templates.

---

## File Structure

```
.
├── LICENSE          # License file
├── README.md        # This file
├── SKILL.md         # Copilot Skill definition
├── reference.md     # Domain knowledge and discovery patterns
├── template.md      # Output format templates
└── examples/        # Example inputs and outputs for various project types
```
