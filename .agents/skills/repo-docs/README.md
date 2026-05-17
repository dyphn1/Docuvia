---
description: A GitHub Copilot Chat Skill that automatically generates or updates README.md and AGENT.md based on a repository's current file structure and configuration files.
---

# repo-docs

A GitHub Copilot Chat Skill that automatically generates or updates `README.md` and `AGENT.md` by inspecting the repository's actual file structure and configuration files. This ensures project documentation accurately reflects the codebase without inventing facts or hallucinating details.

---

## Features

- **Accurate Documentation:** Extracts commands, version numbers, and paths directly from readable files.
- **Preserves Human-Written Content:** Keeps existing prose, screenshots, badges, and custom sections intact when updating.
- **Traceable Sources:** Documents the source files for generated sections to ensure verifiability.
- **Safe Overwrites:** Shows a summary of changes or a diff before making significant modifications.

---

## Usage

Invoke the skill when you need to update or create documentation for the current repository. Typical prompts include:

- "generate docs"
- "create a README"
- "write an AGENT.md"
- "update project docs"
- "document my repo"

---

## Workflow

1. **Gather Context:** Runs a reconnaissance script to collect the directory tree, detected project types, build commands, and existing documentation.
2. **Determine Actions:** Checks existing `README.md` and `AGENT.md` to decide whether to generate from scratch or update existing content.
3. **Generate/Update:** Safely merges new auto-detectable information (install steps, commands, structure) with existing human-written sections.
4. **Review & Apply:** Presents changes or a diff for review before finalizing and writing the documentation files.

---

## File Structure

```
.
├── LICENSE          # License file
├── README.md        # This file
├── SKILL.md         # Copilot Skill definition
├── references/      # Reference templates and manual recon guides
└── scripts/         # Scripts for repository reconnaissance
```