# Phase 8: Wizard-Style Interactive CLI

**Objective:** Overhaul the Docuvia CLI (`@workspace/cli`) from a raw textual script into a polished, interactive, wizard-style developer tool.

## Context

As identified in the capabilities matrix and formalized in [ADR-034](../../adr/ADR-034-wizard-style-interactive-cli.md), Docuvia's CLI currently provides zero interactivity or visual feedback. This phase focuses on integrating modern CLI UX libraries to guide users through transactional commands (`init`, `analyze`, `sync`) seamlessly.

## Key Deliverables

### 1. Interactive Prompts & Missing Argument Handling

- [ ] Add `@inquirer/prompts` (or similar) to the CLI dependencies.
- [ ] Refactor the `sync` command: If `<project_id>` is missing, fetch available projects from the DB and prompt the user to select one via an interactive list.
- [ ] Refactor the `extract` command: If `<path>` is missing, prompt the user with a file-picker or text input.
- [ ] Refactor the `query` command: Prompt for a search target if not provided via args.

### 2. Loading States & Progress Indicators

- [ ] Add `ora` (or `@clack/prompts`) to handle terminal spinners.
- [ ] Implement spinners for the `analyze` command (e.g., "Starting AST scan...", "Parsing 42 files...").
- [ ] Implement spinners for the `init` command (e.g., "Creating hidden git branch...", "Initializing SQLite...").
- [ ] Implement spinners for the `sync` command (e.g., "Packing local knowledge to orphan branch...").

### 3. Structured Output & Formatting

- [ ] Add a color library (`picocolors` or `chalk`) for semantic logging (Red for errors, Green for success, Cyan for info).
- [ ] Format the output of `docuvia status` and `docuvia query` using structured tables (e.g., `cli-table3`) rather than flat text logs.
- [ ] Ensure all AI-generated outputs (like `detect-changes` risk scores) are clearly delineated with visual borders or panels.

### 4. Testing & CI Adjustments

- [ ] Update `cli.args.test.ts` to accommodate the new interactive flows (e.g., bypassing prompts in CI environments using a `--non-interactive` flag or mocking TTY).
- [ ] Ensure the CLI fails gracefully with standard exit codes when run in a non-TTY environment without required arguments.
