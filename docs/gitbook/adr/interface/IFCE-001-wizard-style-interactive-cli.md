---
id: IFCE-001
title: Wizard-Style Interactive CLI
status: accepted
date: 2026-07-07
domains: [interface]
supersedes: [legacy/ADR-034]
superseded_by: []
---

# Wizard-Style Interactive CLI (Opt-In)

## Context
A horizontal analysis against workspace sibling projects highlighted a UX gap in the Docuvia CLI. Previously, the CLI relied on raw `console.log` output and strict, unforgiving positional arguments. However, forcing an interactive TUI (Terminal User Interface) or wizard by default violates the fundamental UNIX philosophy of a CLI, where commands should be composable, headless-friendly, and safe for AI agents or CI/CD pipelines to run without hanging on a prompt.

## Decision
We refactored the Docuvia CLI to support a Wizard-style UX architecture, but **strictly as an opt-in behavior**.
1. **Default Non-Interactive**: By default, commands like `docuvia init` execute in a standard, headless CLI mode. If required arguments are missing, the command fails fast with a clear error message.
2. **Opt-In Interactivity**: The interactive wizard must be explicitly triggered via an `--interactive` (or `-i`) flag. When this flag is provided, the CLI gracefully prompts the user for missing arguments.
3. **Dynamic Loading States**: Modern spinners/progress indicators are used for visual feedback during long-running tasks, but must gracefully degrade in non-TTY environments.
4. **Structured Output**: Replace unstructured `console.log` dumps with formatted, color-coded blocks for humans, while preserving raw JSON/text output for piped commands.

### Execution Flow

```mermaid
flowchart TD
    Start([User runs docuvia command]) --> CheckFlag{Has --interactive flag?}
    
    CheckFlag -- Yes --> Wizard[Launch Wizard UX / Prompts]
    Wizard --> Collect[Collect Missing Args via UI]
    Collect --> Exec[Execute Command Core]
    
    CheckFlag -- No --> CheckArgs{Missing Required Args?}
    CheckArgs -- Yes --> Fail[Fail Fast with Error & Usage Help]
    CheckArgs -- No --> Exec
    
    Exec --> Output{Is TTY?}
    Output -- Yes --> Pretty[Format Color/Table Output]
    Output -- No --> Raw[Raw Text/JSON Output]
```

## Consequences
- **Positive**: Preserves the strict, scriptable nature of the CLI. Prevents CI pipelines and AI agents from hanging indefinitely on hidden prompts. Still allows human developers to opt into a guided, polished experience via `--interactive`.
- **Negative**: Humans who forget the `--interactive` flag will face strict validation errors, representing a slightly steeper learning curve than a default-interactive tool.
