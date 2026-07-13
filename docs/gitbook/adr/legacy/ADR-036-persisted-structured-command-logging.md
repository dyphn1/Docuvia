---
---

Date: 2026-07-11
Status: Superseded
Supersedes: None
---

# ADR-036: Persisted Structured Command Logging for Post-Hoc Auditability

## Context

`docuvia init` originally had no way for a human or an AI agent to verify what a run actually did after the terminal output scrolled away or was lost (e.g. in a background/headless agent invocation). This was root-caused and fixed as part of `docs/ai_plans/fix_init_honest_reporting.md`: a persisted, append-only JSONL log at `.docuvia/logs/init.log` (`init.start` / `init.parse_failure` / `init.summary` events) was added so `init`'s outcome is always inspectable after the fact, independent of whatever the terminal happened to show.

Every other one-shot CLI command (`analyze`, `status`, `clean`, `review`, `sync`, `snapshot`, `query`, `export --topology`) had no equivalent — a run's outcome existed only as transient stdout, which is a real gap for a tool whose primary consumers are frequently AI coding agents running commands non-interactively and headlessly, where terminal output may not be captured or may be truncated by the calling agent's own context limits.

## Decision

Every one-shot Docuvia CLI command (i.e., every command except the long-running `docuvia mcp` server, which has a different lifecycle) must persist a JSONL run log to `.docuvia/logs/<command>.log`:

1. **One JSON object per line**, each with a `ts` ISO-8601 timestamp field plus an `event` field.
2. **At minimum**, a `<command>.start` event at the beginning (with the invocation's meaningful parameters) and either a `<command>.summary` event on success (mirroring whatever result shape the command already computes/prints — no new data invented) or a `<command>.error` event on failure (with the error message).
3. **Logging must never cause a command to fail that would otherwise succeed** — every log-write call site wraps its own failure (e.g. `.catch(() => {})`) rather than propagating.
4. **Logging lives at the service layer** (`@workspace/core`), not the CLI presentation layer, consistent with [ADR-021](ADR-021-shared-core-api-and-presentation-layers.md)'s existing thin-CLI-wrapper pattern — the same service backs `docuvia mcp`'s tool calls and (where applicable) the VS Code extension, so logging at that layer captures all callers, not just the CLI's.

Implemented via a shared `appendCommandLogLine(workspaceRoot, logFileName, event)` helper (`lib/core/src/services/command-log-writer.ts`), which `init`'s original logger was refactored into a thin wrapper over, and which the other 8 commands were wired into directly (see `docs/ai_plans/implement_init_gating_snapshot_perf_and_command_logging.md`, Part 3).

## Consequences

- **Positive**: Any command's actual behavior is now inspectable after the fact — critical for headless/background AI-agent invocations where stdout is not reliably captured, and for debugging "it said success but X didn't happen" reports.
- **Negative**: A small, ever-growing set of log files under `.docuvia/logs/` with no rotation/retention policy defined yet — acceptable for now since `.docuvia/` is already gitignored, ephemeral, local state, but worth revisiting if log volume becomes a real disk-usage concern.
- **Non-goals**: This does not cover `docuvia mcp`'s individual tool-call-level logging (a different, higher-frequency, long-running-process concern), nor does it replace `logger` (pino)'s existing in-process debug logging — the two are complementary (pino for real-time/verbose debugging, this JSONL log for durable, minimal, post-hoc auditability).
  superseded_by: []
