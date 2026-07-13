# Interface (IFCE) — CLI / Client / Templates / Logs

**Current Model**:
The Docuvia2 CLI (Command Line Interface) is built as a wizard-style interactive shell (`docuvia-cli`), designed for transactional execution (`init`, `sync`, `status`). It avoids silent side-effects by prompting for global mutations and maintains a structured JSONL log of every execution for post-hoc auditability. The CLI acts as a thin presentation layer over the shared `@workspace/core` logic.

## Decisions

| ID                                                       | Decision                         | Status   | Notes                                                          |
| -------------------------------------------------------- | -------------------------------- | -------- | -------------------------------------------------------------- |
| [IFCE-001](IFCE-001-wizard-style-interactive-cli.md)     | Wizard-Style Interactive CLI     | accepted | Carries forward legacy ADR-034                                 |
| [IFCE-002](IFCE-002-strict-repo-scoped-boundaries.md)    | Strict Repo-Scoped Boundaries    | accepted | Cancels global writes, strictly confining state to the project |
| [IFCE-003](IFCE-003-persisted-structured-command-log.md) | Persisted Structured Command Log | accepted | Carries forward legacy ADR-036                                 |
