---
Date: 2026-07-11
Status: Accepted
Supersedes: None
---

# ADR-035: Opt-In Gating for Machine-Global Side Effects

## Context

`docuvia init` writes state in two fundamentally different scopes: repo-scoped files (`.docuvia/`, `.cursor/`, `.claude/`, etc. — confined to the target repository, safe to re-run, mechanically reversible) and, previously, an unconditional write to the machine-global Claude Desktop config file (`claude_desktop_config.json` at an OS-specific path outside any repository) to register Docuvia's MCP server for every project on the machine.

An audit comparing Docuvia's CLI against GitNexus (`docs/analysis/docuvia-cli-vs-gitnexus-2026-07-10.md`) flagged this as a 🔴 high-severity issue: a single per-repo `docuvia init` silently mutated shared, cross-project machine state with no flag, no confirmation prompt in non-interactive mode, and no documentation of the side effect. No existing ADR addresses the general question of when Docuvia may write outside the boundary of the current repository — [ADR-002](ADR-002-local-first-architecture.md) (Local-First Architecture) concerns server-vs-standalone operation mode, not machine-global filesystem writes, and [ADR-034](ADR-034-wizard-style-interactive-cli.md) (Wizard-Style Interactive CLI) concerns interactive prompting UX in general, not consent for global state specifically.

## Decision

Any Docuvia CLI command that would write to a path outside the target repository (i.e., not under the workspace root) must:

1. **Never write silently by default.** The write must be gated behind an explicit opt-in — either a CLI flag (e.g. `--global`) or, in an interactive (TTY) session, an explicit confirmation prompt defaulting to **No**.
2. **Skip and inform, not fail, when consent is absent.** In non-interactive mode without the opt-in flag, the command must skip the global write and print a message telling the user how to enable it — it must not silently do the write anyway, and must not treat the absence of consent as an error.
3. **Document the full side-effect surface.** Every path a command can touch — repo-scoped and global — must be enumerated in that command's reference documentation ([`docs/gitbook/packages/cli.md`](../packages/cli.md) and the corresponding [`docs/gitbook/user-guide/cli/*.md`](../user-guide/cli/) page), split explicitly by scope, so a user can audit blast radius before running the command.

This was first implemented for `docuvia init`'s Claude Desktop MCP registration (`artifacts/cli/src/platforms/claude.platform.ts`'s `maybeConfigureMcpServer`, gated behind `--global`) and should be the default posture for any future command that touches machine-global state (e.g. a hypothetical global config/registry, cross-project cache, or shell profile edit).

## Consequences

- **Positive**: A per-repo command can no longer surprise a user by mutating unrelated projects' tooling configuration. Matches the "consent for anything outside the sandbox" expectation any local-first, repo-scoped tool should meet.
- **Negative**: Slightly more friction for the common case (a user who genuinely wants the global registration every time now needs `--global` or to answer a prompt) — judged an acceptable tradeoff given the blast radius of getting it wrong is silent, cross-project state mutation.
- **Scope**: This ADR governs _global_ (outside-repo) writes only. Repo-scoped side effects (like `init`'s `.cursor/`, `.claude/` writes) are unaffected — those remain default-on, since they're confined to, and reversible within, the target repository.
