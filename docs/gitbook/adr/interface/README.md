# Interface (IFCE) — CLI / Client / Templates / Logs

**Current Model**:
The Docuvia2 CLI (Command Line Interface) is a transactional shell (`docuvia-cli`) for commands like `init`, `publish`, `status`. Prompts (the wizard menu, confirmations, missing-argument input) are opt-in via `--interactive`/`-i` — never TTY-guessed — so an agent or script that never passes the flag can't be hung by one. The CLI avoids silent side-effects by prompting for global mutations when interactive, and maintains a structured JSONL log of every execution for post-hoc auditability. It acts as a thin presentation layer over the shared `@workspace/core` logic.

## Decisions

| ID                                                       | Decision                                           | Status                 | Notes                                                                                                    |
| -------------------------------------------------------- | -------------------------------------------------- | ---------------------- | -------------------------------------------------------------------------------------------------------- |
| [IFCE-001](IFCE-001-wizard-style-interactive-cli.md)     | Wizard-Style Interactive CLI                       | superseded             | Carried forward legacy ADR-034; superseded by IFCE-004                                                   |
| [IFCE-002](IFCE-002-strict-repo-scoped-boundaries.md)    | Strict Repo-Scoped Boundaries                      | accepted               | Cancels global writes, strictly confining state to the project                                           |
| [IFCE-003](IFCE-003-persisted-structured-command-log.md) | Persisted Structured Command Log                   | accepted               | Carries forward legacy ADR-036                                                                           |
| [IFCE-004](IFCE-004-explicit-interactive-opt-in.md)      | Explicit Interactive Opt-In (`--interactive`/`-i`) | accepted               | Prompts fire only when explicitly requested — closes the agent/pty hang risk IFCE-001 didn't fully close |
| [IFCE-005](IFCE-005-rename-sync-to-publish.md)           | Rename `sync` to `publish`                         | accepted — implemented | `sync-knowledge` stays as-is; rejected merging both under one flag/subcommand (`git checkout`-style)     |
| [IFCE-006](IFCE-006-rename-init-to-install.md)            | Rename `init` to `install`                         | accepted               | Naming symmetry with `uninstall`; same clean-break, CLI-layer-only scope discipline as IFCE-005          |
