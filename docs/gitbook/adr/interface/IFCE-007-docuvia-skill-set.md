---
id: IFCE-007
title: "docuvia-* Skill Set — Task-Routed Agent Guidance Files"
status: accepted
date: 2026-08-21
domains: [interface, platform]
supersedes: []
superseded_by: []
---

# docuvia-* Skill Set — Task-Routed Agent Guidance Files

## Context

Agents driving Docuvia rely on prose mandates in `AGENTS.md`/`CLAUDE.md` to know which command
or format fits a given task. In long conversations, these mandates can get dropped from live
context after context compaction, leaving the agent without guidance on when to use `query` vs
`impact` vs `analyze --stage`. The existing `.claude/skills/no-magic-strings/` precedent in this
repo demonstrates that task-routed skill files survive context compaction better than prose
mandates because they persist as file-system artifacts that the agent re-reads on demand.

GitNexus (the predecessor project) already ships a `gitnexus-exploring`/`gitnexus-impact-analysis`
skill set. Docuvia needs an equivalent, but with its own command vocabulary and without depending
on GitNexus's tool surface.

## Decision

Ship a `docuvia-*` skill set — four task-routed `SKILL.md` files with YAML frontmatter that
Claude Code (and other MCP-compatible agents) pick up automatically from `.claude/skills/`:

| Skill                     | Fires when                       | Guides to                                    |
| ------------------------- | -------------------------------- | -------------------------------------------- |
| `docuvia-exploring`       | Codebase exploration             | `query`, `impact`, fallback rules            |
| `docuvia-impact-analysis` | Pre-change blast-radius analysis | `impact`, `query` cross-reference            |
| `docuvia-knowledge-graph` | Graph querying                   | `query`, result interpretation, trust levels |
| `docuvia-agent-authored`  | Post-change L3 staging           | MCP `applyDecision` / CLI `--stage`          |

### Installation mechanism

- **Opt-in**: `docuvia init --skills` installs all four skills into `.claude/skills/docuvia-*/SKILL.md`.
  Not baked into every `init` run — per the self-installable/uninstallable requirement from the
  Phase 4 design session (roadmap item 34).
- **Symmetric removal**: `docuvia uninstall --skills` removes all `docuvia-*` directories, leaving
  other skills (e.g. `no-magic-strings`) intact.
- **Idempotent**: Re-running `init --skills` skips already-installed skills.

### Why not `docuvia hooks`?

Skills are static file drops, not runtime hook registrations. They don't share a management
surface with the hook lifecycle commands (`docuvia hooks enable/disable`). This was the
originally-intended separation, confirmed by implementation: the "deliberately deferred" note
in roadmap item 34 was waiting for IFCE-006's `init` → `install` rename, but the implementation
confirmed the separation is correct as-is.

### File locations

- Templates: `artifacts/cli/src/constants/skill-templates.ts`
- Installer/uninstaller: `artifacts/cli/src/skills/install-skills.ts`
- CLI integration: `--skills` flag on `init` and `uninstall` commands

## Consequences

**Easier:**

- Agents get structured, task-specific guidance that survives context compaction
- Skills are self-contained (YAML frontmatter + markdown body) — no runtime dependencies
- Opt-in installation avoids bloating every workspace with files the user may not want

**More difficult:**

- Skill content must be kept in sync with command evolution (new flags, renamed commands)
- The `--skills` flag adds a new CLI surface to `init`/`uninstall` (complexity budget managed
  by extracting `handleSkillInstallation`/`handleSkillRemoval`/`runCleanupSteps` functions)

**Alternatives rejected:**

- _Bundling into every `init` run_: Rejected per the roadmap's self-installable requirement —
  skills are opt-in, not default
- _Managing via `docuvia hooks`_: Rejected because skills are file drops, not runtime hooks —
  different lifecycle, different management surface
- _Global installation_: Rejected per IFCE-002's strict repo-scoped boundaries — skills are
  project-local under `.claude/skills/`
