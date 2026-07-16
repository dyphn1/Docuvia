# Docuvia2 `init` Command Automation & Headless Mode In-Depth Analysis

> **Context**: In-depth technical analysis for "Priority 2: Fix `init` Automation" in the Phase 1 execution strategy.
> **Date**: 2026-07-16
> **Status**: Independent Analysis Report

---

## 1. Core Bottleneck (The TTY Blocker)

The current `init` command has a blocking design in `artifacts/cli/src/commands/init.ts`:

```typescript
if (process.stdin.isTTY) {
  const proceed = await ui.askConfirm(UI_MESSAGES.INIT_CONFIRM, true);
  // ...
}
```

Simultaneously, when configuring Agent Integrations (`configureAgentIntegrations`), if the `--platform` parameter is not provided, it pops up an interactive multiselect list (`ui.askMultiselect`).
This causes the process to hang endlessly until a timeout occurs when executed automatically in CI/CD environments (e.g., GitHub Actions) or via scripts by other Agents (e.g., benchmarking). This violates the highest design principles for background automation tools.

## 2. Flag Design & Schema Adjustment (Zod Schema)

To fully support headless mode, control switches must be introduced at the CLI parameter interface:

- **`--yes` or `--non-interactive`**:
  Add `nonInteractive: z.boolean().default(false)` in `InitInputSchema`.
  - If set to `true`, automatically skip `askConfirm` and assume user consent.
- **Handling Default Behavior of `--platform`**:
  How should the system react if `--yes` is enabled but `--platform` is not provided?
  - Option A (Conservative): Throw an error, prompting "In non-interactive mode, --platform must be explicitly specified or pass 'none'".
  - Option B (Aggressive): Automatically skip hook installation and only complete database initialization.
  - **Recommended Architecture**: Adopt Option B. Background automation tasks typically only care about starting the core engine; global editor hooks (like Cursor, Claude Desktop) shouldn't be silently installed without authorization.

## 3. Behavioral Decision Tree

When the command is executed: `docuvia init`

1. **Input Parsing**: Zod schema check.
2. **TTY Detection & `--yes` Override**:
   - `if (!process.stdin.isTTY || input.nonInteractive) { skipConfirm() }`
3. **AST Initialization Lock (PLAT-006)**: Acquire `INIT_COMMAND_LOCK` as usual.
4. **Agent Integration**:
   - If in non-interactive mode and `platformFilter` is empty: bypass directly, print `Skipped agent hook installation in non-interactive mode.`
   - If in non-interactive mode and `platformFilter` is provided: silently install according to the given conditions.

## 4. Impact on CI/CD & E2E Testing

- **Liberating Test Coverage**:
  Once this modification is complete, we can genuinely add `npx tsx artifacts/cli/src/cli.ts init --yes` to the CI Pipeline as the first step of End-to-end testing, thoroughly verifying the health of the integration between the AST Worker and Database Schema.
- **Security Defense**:
  In non-interactive mode, strictly forbid any actions requiring manipulation of global settings like `~/.claude/` (unless there is explicit authorization via flags like `--global`), avoiding polluting the environment state of test machines or remote runners.
