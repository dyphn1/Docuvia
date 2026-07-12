---
---
Date: 2026-07-07
Status: Superseded
Supersedes: None
---

# ADR-034: Wizard-Style Interactive CLI

## Context

A horizontal analysis against workspace sibling projects (specifically `hermes-agent` and `GitNexus`) highlighted a severe User Experience (UX) gap in the Docuvia CLI. Currently, the `@workspace/cli` relies on raw `console.log` output and strict, unforgiving positional arguments without any form of interactivity, status indication, or guided onboarding.

While `hermes-agent` utilizes a persistent TUI (Ink) designed for long-lived chat sessions, Docuvia's primary CLI interactions (`init`, `analyze`, `sync`, `detect-changes`) are fundamentally **transactional and terminal**. They are discrete operations that should execute clearly and return control to the user.

Therefore, building a full, persistent TUI (Option B) misaligns with Docuvia's role as a rapid developer tool. Instead, the CLI requires a polished **Wizard-Style Interactive Experience** (Option A).

## Decision

We will refactor the Docuvia `@workspace/cli` to use a Wizard-style UX architecture.

1. **Interactive Prompts**: Replace unforgiving argument parsing with interactive prompts using a library like `inquirer` or `@inquirer/prompts`. If a user runs `docuvia sync` without arguments, the CLI must gracefully prompt them for the target project and commit hash rather than failing with an error.
2. **Dynamic Loading States**: Integrate a modern spinner/progress indicator (e.g., `ora` or `clack`) to provide visual feedback during long-running tasks like AST parsing (`analyze`), database initialization (`init`), and LLM extraction (`extract`).
3. **Structured Output**: Replace unstructured `console.log` dumps with formatted tables and color-coded blocks (using libraries like `chalk` or `picocolors` and `cli-table3`) for commands like `status`, `query`, and `detect-changes`.
4. **Command Architecture Preservation**: The underlying execution logic within `@workspace/core` will remain untouched. The UX layer will be strictly confined to the `@workspace/cli` package as a presentation shell.

## Consequences

- **Positive**: Drastically lowers the barrier to entry for new developers. Prevents frustrating syntax errors by guiding users through complex commands. Brings Docuvia's CLI polish up to the enterprise standards of its workspace peers.
- **Negative**: Adds UI dependencies (`inquirer`, `ora`, `chalk`) to the CLI package, slightly increasing bundle size and execution overhead. Tests evaluating CLI `stdout` may need to be updated to strip ANSI color codes or handle interactive TTY contexts.
superseded_by: []
