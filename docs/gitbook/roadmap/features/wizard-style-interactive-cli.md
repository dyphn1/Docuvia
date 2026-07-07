# Wizard-Style Interactive CLI

- **Status**: ⏳ Todo
- **Phase**: Phase 8: Wizard-Style Interactive CLI
- **Evidence / Verification Target**: `artifacts/cli/src/`, `docs/gitbook/roadmap/phase-8-wizard-style-interactive-cli.md`
- **ADR**: [ADR-034](../../adr/ADR-034-wizard-style-interactive-cli.md)

## Implementation Details

This feature implements a wizard-style developer CLI for Docuvia's main command surface. The goal is to replace raw text arguments with guided prompts, rich feedback, and structured output while preserving CI-friendly non-interactive behavior.

### Key Tasks

#### 1. Interactive prompts and missing-argument handling

- [ ] Add an interactive prompt library such as `@inquirer/prompts` or `@clack/prompts`.
- [ ] Refactor the `sync` command to prompt for `<project_id>` when missing.
- [ ] Refactor the `extract` command to prompt for `<path>` when missing.
- [ ] Refactor the `query` command to prompt for a search target when missing.

#### 2. Loading states and progress indicators

- [ ] Add a spinner library such as `ora` or `@clack/prompts`.
- [ ] Show progress states for `analyze` (e.g. "Starting AST scan...", "Parsing 42 files...").
- [ ] Show progress states for `init` (e.g. "Creating hidden git branch...", "Initializing SQLite...").
- [ ] Show progress states for `sync` (e.g. "Packing local knowledge to orphan branch...").

#### 3. Structured output and formatting

- [ ] Add a color library such as `picocolors` or `chalk`.
- [ ] Format `docuvia status` and `docuvia query` output as tables rather than plain logs.
- [ ] Ensure AI-generated outputs are visually separated with borders, panels, or clear labels.

#### 4. Testing and CI adjustments

- [ ] Update CLI tests (`cli.args.test.ts`) for interactive flows.
- [ ] Support a `--non-interactive` or equivalent mode for CI and scripts.
- [ ] Ensure the CLI exits cleanly with standard exit codes in non-TTY environments.

## Verification

- [ ] Interactive flows work in a TTY environment.
- [ ] Non-interactive CI mode works without hanging or prompting.
- [ ] CLI tests cover both prompt and non-prompt paths.
- [ ] Output is readable and consistent in both terminal and log captures.
