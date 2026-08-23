# Changelog

All notable changes to `docuvia` are documented in this file. Versions before 0.1.0 were backfilled from the roadmap's shipped items (see docs/gitbook/analysis/roadmap-and-open-items.md).

## [0.0.x] — initial public baseline (backfilled)

Backfilled from the roadmap and ADR record (2026-07 → 2026-08); the project shipped continuously
during this window without tags or a changelog. New entries above are generated automatically by
semantic-release from conventional commits.

### Added

- **Knowledge graph core** — tree-sitter AST ingestion, FTS5 query, SQLite storage, git-history-driven change detection (`lib/core`, `lib/ast-core`, `lib/plugins-ast`).
- **Tiered background knowledge evolution** (PLAT-007) — Tier A snapshot, Tier B LSP cross-file edge escalation, Tier C queued decisions.
- **CLI commands** — `init`, `analyze`, `query`, `impact`, `review`, `status`, `doctor`, `hooks`, `snapshot`, `hydrate`, `export-topology`, `publish`, `sync-knowledge`, `uninstall`.
- **MCP server** — `docuvia_query` / `docuvia_impact` / `docuvia_status` / `docuvia_detect_changes` read-path tools plus `docuvia_applyDecision` staging (#49, #47, #190), with behavioral descriptions that steer agent invocation.
- **Agent-authored L3 write path** — `analyze <file> --agent-authored --stage` persists agent-supplied architectural decisions into the graph (2026-08-15).
- **Per-behavior hook lifecycle** — `docuvia hooks list/enable/disable/check` (2026-08-15).
- **Shared `--format` flag with `json` output** across `query`/`impact`/`review`/`detect-changes` (#52, 2026-08-18).
- **`docuvia-*` skill set** — four task-routed skill files installed via `docuvia init --skills` / removed via `uninstall --skills` (PR #176, IFCE-007).
- **L3 distribution strategy & sync-knowledge scheduling** (2026-07-21) — see `phase2-l3-distribution.md`, `phase2-sync-knowledge-scheduling.md`.
- **Multi-platform agent integration installers** — Claude Code, Cursor, GitHub Copilot, Codex, Continue, Hermes.

### Changed

- `sync` renamed to `publish`; `sync-knowledge` unchanged (IFCE-005, 2026-07-28).
- L3 "why" rationale now surfaced in `review`/`impact` output (2026-07-28).
- Richer `export-topology` output (2026-07-28).
- `query`/`impact` results carry `matchType: "exact" | "keyword" | "neighbor"` confidence signals; empty results mean unknown, not zero (#22, 2026-08-05).

### Fixed

- Race between foreground `query` reads and background `analyze` writes (Race C, 2026-07-28).
- Hydrate-then-delta optimization avoids full rehydration when possible (2026-07-28).
- Test resilience: poll rust-analyzer `documentSymbol` instead of fixed sleeps; centralized git-local fixtures + fs-race retries (#187, #188).

### Infrastructure

- CI runs the platform-sensitive test gate on both ubuntu and windows runners.
- Knowledge-graph PR comment rendering targeted at humans, not agents (#200).
