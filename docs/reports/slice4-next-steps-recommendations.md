# Slice 4 (Tier C) Next Steps & Recommendations

## Overview

Based on the successful implementation of Phase 1 - Slice 3 (Tier B) and the integration contract defined in `phase1-decision-integration.md`, here are the recommended next steps and architectural guidelines for Slice 4 (Tier C: budgeted async LLM queue).

## 1. Core Objectives for Slice 4

- **Commit Semantic Filter:** Implement a filter to drop low-value commit messages (e.g., `wip`, `typo`, `chore`) before they enter the Tier C queue.
- **Request-side Throttling:** Enforce concurrency = 1, daily token/call budgets, and a system-load check before dispatching requests.
- **Endpoint Routing:** All LLM traffic MUST go through the `CLIProxyAPI` bridge (LLM-002). Docuvia must throttle its own requests and never manage the endpoint's process.
- **Embedded In-process Model Decision:** Evaluate and decide on the viability of an embedded in-process model (e.g., ONNX / small SLM) vs. external API. This was explicitly deferred from Slice 3 to Slice 4.
- **Data Persistence:** Ensure the results persist via the existing `upsertDecision` path (with full provenance mapping).

## 2. Architectural Re-use

- **Stage-then-Finalize Pattern:** Reuse the pattern established in Slice 3 (where `analyze` stages `tierBBatchPending` and `SnapshotWorkflow` finalizes it). This ensures that queue consumption only takes effect after a successful persistence/snapshot step.

## 3. Recommended Watchlist Resolutions Before/During Slice 4

- **Semantic Drift / Cache Accuracy Warning (Replaces Commit-Cap):** A raw commit count (e.g., 20 commits) is a flawed trigger because 20 commits of Markdown updates cause zero semantic drift, whereas a single massive refactor commit causes severe drift. **Recommendation:** Shift from a blind commit counter to a multi-condition "Semantic Drift Ratio". The most pragmatic approach combines three signals:
  1.  **Git Blob Inspection:** Measure meaningful code modifications (changed files/lines) while explicitly excluding large binaries and documentation (e.g., `.md`).
  2.  **Blast Radius (Impact Analysis):** Leverage the system's existing impact calculation. A small code change with a massive blast radius (e.g., changing a core interface) degrades cache accuracy much faster than isolated component tweaks.
  3.  **Commit Count:** Used as a baseline multiplier.
      By intersecting these factors, Docuvia can accurately calculate graph decay without unnecessary heavy computation. If the drift exceeds a threshold (e.g., 15%), emit a smart warning: `⚠️ 目前快取正確率已低於 85%，建議透過 docuvia analyze 進行補強`.
- **Queue Staleness & Value-Based Eviction (Replaces Infinite Degraded Queue):** A degraded Tier B batch (LSP absent) currently advances `lastTierBBatchSha` but leaves entries queued indefinitely. Retaining an infinitely growing backlog across multiple machines or long AI agent runs (e.g., 10-30+ commits behind) diminishes the queue's value and creates a processing liability. **Recommendation:** Implement a staleness or drift-based eviction policy for `tierBQueue`. If the queue is too far behind the baseline, it should be discarded rather than hoarded. When the user eventually requires high-precision data, the system can prompt them to perform a fresh on-demand analysis.
- **End-to-End Acceptance (Dogfooding Docuvia2 itself):** We currently need to verify the actual hit-rate of `node_key` edge repairs on a real repo with `typescript-language-server` installed. **Recommendation:** Docuvia2 should be used to analyze its own repository using a historical replay simulation. The most accurate and simplest testing method is:
  1. Checkout an older commit and run a baseline `docuvia init`.
  2. Incrementally `git cherry-pick` recent large commits (especially complex or merge commits) onto a test branch.
  3. Run `docuvia analyze --escalate-to-lsp && docuvia snapshot` as these commits accumulate.
     _Note: To ensure a perfectly clean environment and zero pollution of the local working directory, this entire simulation should be executed inside an ephemeral `docker-compose` environment with a fresh git worktree._
     This "time-travel" method provides a perfect, highly accurate self-comparison to empirically validate the Tier B backstop's effectiveness in repairing cross-file symbol calls and measuring real-world semantic drift.

## 4. Unresolved Architectural Decision (Requires Owner Ruling for Phase 2)

- **L3 Distribution Strategy:** Currently, `docuvia snapshot` packs only L2 nodes and their links onto the knowledge branch. L3 nodes (LLM-generated decisions) reside solely in the local `local.db`. If Tier C begins heavily generating L3 nodes, they will not be distributed across the team upon `sync`. **Decision Required:** Should L3 nodes be packed into the knowledge branch snapshot (making them team-wide knowledge), or should they remain local-only cache? If they are distributed, the `SnapshotWorkflow` and `HydrationService` must be updated to handle L3 persistence and conflict resolution.
