---
id: GRPH-007
title: Git-Blame-Based L3 Validity and Provenance
status: accepted
date: 2026-08-24
domains: [graph]
supersedes: [GRPH-002]
superseded_by: []
---

# Git-Blame-Based L3 Validity and Provenance

## Context

The L3 ("why") layer records how a feature came to be. Two failure modes let it silently serve dead or contradictory rationales with equal authority to live ones:

1. **The write path is a forced merge.** `upsertDecision` dedups only on identical content hash — divergent content always lands as a new row, so conflicts are invisible by construction.
2. **Provenance is stripped at the consumer.** The query read path carried only `{title, content}`, so an agent could not distinguish an agent-authored self-report from a git-imported fact, nor a stale decision from a live one.
3. **Timing gap**: a rationale accurate when written can be false after its code is merged or later rewritten ("merged ≠ survived").

L3 has no ground truth by construction (agent-authored, verbatim, no LLM call), so validity must come from an external trustworthy signal. **Git is the only such signal available.**

[GRPH-002](GRPH-002-two-phase-knowledge-validity.md) proposed gating `pending → active` behind a human approval workflow or a secondary LLM pass. Both gates are infeasible at agent generation speed (v1's `review_tasks` died for exactly this reason) and neither addresses supersession: a human approves a rationale that a later rewrite silently kills.

## Decision

Derive L3 validity from git truth — a deterministic `git blame` judgment run against the current HEAD tree at merge-on-origin observation — plus a cheap writer-side contradiction check, and surface provenance end-to-end. Implemented in PR #204 (issue #68).

**Authority rule (single signal unifying all cases):** _does the decision's source commit still own the lines it describes?_

- Three states re-keyed on the merge result rather than GRPH-002's approval flow: `pending` (not yet observed merged), `active` (blame still attributes the lines), `garbage` (dead/superseded — demoted, excluded from export, but kept queryable with an explicit `validity` attribute so regressions remain auditable).
- Judgment runs against the current HEAD tree, which **is** the merge result by the time any local run observes it — satisfying "judge against the merge result" without origin-merge detection. A `lastValidityJudgedSha` cursor in `docuvia_meta` bounds each pass to files changed since the last judgment; the first-ever run stamps the baseline and judges nothing.
- Per range: alive if any line still blames to one of the row's own commits (`source_commits` ∪ `initial_source_commits` ∪ `commit_hash`). A partial edit keeps the rationale; a full rewrite of the region kills it. Empty blame output means _unknown_ — it survives, never fabricated into evidence of death.

**Region anchors are the prerequisite and are derived, not authored:** `git blame` is line-level while decisions anchor to file-level L2 nodes, which would degenerate to "any surviving line keeps the rationale alive". At write time, `l3_nodes.anchor_ranges` captures the writing commit's `--unified=0` diff hunks (`{path,startRow,endRow}` JSON) deterministically — no agent cooperation, no AST alignment. NULL means unknown region; such rows are skipped by the pass (file-level fallback deferred, not faked).

**Two checks, two moments:**

| Axis                                                 | Mechanism                                                                                              | Moment                                                     |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------- |
| Authority (alive/dead)                               | blame ownership over region anchors                                                                    | merge observation (`sync-knowledge`, best-effort)          |
| Contradiction (same titled claim, divergent content) | deterministic title-match/content-divergence warning against live same-anchor rows                     | write flush (`--flush-staged-l3`, warn-only, never blocks) |
| Provenance                                           | `source/confidence/commitHash/validityStatus` through the read contract and `<l3_decision>` attributes | every render (CLI + MCP via the shared formatter)          |

**Rejected alternatives:**

- _Human/LLM approval gates (GRPH-002)_ — infeasible at generation speed; blind to later supersession. Superseded by this ADR; GRPH-002's status vocabulary (`validity_status` column) is retained unchanged.
- _Agent-merge L3-vs-L3 comparison as the authority mechanism_ — both sides' L3 may simply not be present (knowledge-branch lag reproduces the exact silent-desync failure mode); it cannot say whose code survived; it keys on who executed the merge (humans/CI squash merges bypass it). Adopted conceptually instead as a future _contradiction-detector_ trigger (decide when to escalate), never as the authority (decide what is dead).
- _Query-time blame derivation_ — too slow per query; validity is stored in the existing `validity_status` column.

## Consequences

- A wrong/stale "why" loses its authority automatically, deterministically, zero LLM, bounded cost — it propagates to no future agent by default.
- Provenance reaches every consumer, letting agents weigh agent-authored self-reports differently from git-imported facts.
- Known limitations, documented rather than hidden: v1 blame does not track renames (a moved file can mis-judge); NULL-anchor rows fall back to being skipped; boundary commits report real shas; `--flush-staged-l3` warnings land in the post-commit log because the flush runs backgrounded.
- Future work: rename-aware blame; a file-level fallback policy for unanchored legacy rows; ramp measurement of how fast L3 density becomes useful on an existing codebase now that provenance flows end-to-end.
