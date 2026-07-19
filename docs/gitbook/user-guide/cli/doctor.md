# docuvia doctor

Diagnoses Git sync issues, remote reachability, and SQLite health to provide a transparent system status.

## Usage

```bash
docuvia doctor
```

### Flags

All checks run by default. Skip the ones you don't need — useful when offline or when a check is known-flaky in your environment:

- `--skip-db`: Skip the SQLite integrity check.
- `--skip-git`: Skip the Git remote reachability check and the git-hook health check (both need `IGitProvider`). The Tier B commit-cap check is gated by `--skip-db` instead — it reads a store-persisted counter, not git.
- `--skip-hooks`: Skip the Claude/Cursor integration hook presence check.
- `--skip-logs`: Skip the `.docuvia/logs/*.log` analysis.
- `--fix`: Opt-in repair of the legacy-hook duplicate-block condition (see health check 6 below). This is the **only** `doctor` flag that mutates workspace files, and only for that one specific condition — it is not a general "fix everything" flag, and it never runs unless explicitly passed.

## Description

Provides an isolated, fast health check for the environment to determine why network or storage operations might be failing.

### Health Checks

1. **SQLite Integrity (Storage)**: Runs `PRAGMA integrity_check` against `.docuvia/local.db`.
2. **Git Network Status (Network)**: Performs a remote reachability test with a strict **5000ms timeout** to prevent `libgit2` from hanging indefinitely on bad connections or SSH prompts.
3. **Integration Hooks (`agent_hooks_claude`/`agent_hooks_cursor`)**: Verifies that the Claude/Cursor hook files installed by `docuvia init` are present, one diagnostic per platform. Always `PASS` either way — not selecting a platform at `init` is a legitimate state, not a defect.
4. **Log Analysis (Logs)**: Parses `.docuvia/logs/*.log` files to surface any critical errors directly.
5. **Tier B Commit-Cap (`tier_b_commit_cap`)**: Passively reports whether the Tier B commit-cap has been exceeded since the last LSP-escalation batch — always reports `PASS` (a normal, expected state either way; not itself a defect) with an informative message, backing up the same nudge `analyze` prints at commit time. Silently skipped if no local database exists yet (already covered by the SQLite Integrity check's own failure).
6. **Post-Commit Hook Health (`git_hook`)**: Detects a hook file that carries both the legacy `docuvia snapshot` block and the current `docuvia analyze` block (both would fire on every commit — `FAIL`, fix with `--fix`), a hook that's still only the legacy block (`FAIL`, fix by re-running `docuvia init`), or a healthy-shaped hook where `docuvia` itself is not actually resolvable from this workspace (`FAIL` — the hook would silently no-op on every commit). No hook installed at all is `PASS` (absence isn't the defect this check targets).
7. **Tier C LLM Reachability (`llm_reachability`)**: A lightweight reachability probe against the CLIProxyAPI bridge configured via `AI_DOCUVIA_INTEGRATIONS_OPENAI_BASE_URL`. Not configured at all is `PASS` (Tier C is inactive by choice); configured but unreachable is `FAIL`, bounded by a short (~4s) timeout, not the 30s chat-completion timeout.
8. **LSP Binary Presence (`lsp_binary`)**: Reports whether `typescript-language-server` resolves, independent of whether a Tier B batch has ever run — reuses the exact same pre-flight gate `analyze --escalate-to-lsp` itself uses. Always `PASS` (Tier B degrades to AST-level edges by design when unavailable — not itself a defect). **TS/JS-scoped only**, matching Tier B's documented language boundary.

## Examples

Run every check:

```bash
docuvia doctor
```

Skip the network check when working offline:

```bash
docuvia doctor --skip-git
```

Repair a duplicate-block post-commit hook (only mutates the hook file, and only for that condition):

```bash
docuvia doctor --fix
```
