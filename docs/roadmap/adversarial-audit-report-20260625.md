# Adversarial Documentation Audit & Remediation Plan (2026-06-25)

**Status:** CRITICAL FAILURE (Documentation vs. Implementation State)
**Auditors:** Sub-agents (PM, System Architect, Implementer, QA, SRE Challenger)

## 🚨 Executive Summary
The project's documentation and actual codebase have severely diverged, leading to an "operational hazard." The system suffers from a "Compliance Theater" where QA reports are generated but never acted upon, roadmaps contain "hallucinated" progress, and architectural decisions (ADRs) are either redundant, missing, or untracked.

## 💥 Core Vulnerabilities Discovered

### 1. Broken Feedback Loop (The QA Swamp)
- Over 80 QA reports exist in `docs/roadmap/reports/` containing critical vulnerabilities (e.g., IDOR in exports `0205_6.5.2`, bypassed commit scores `0214_1.2.5`, broken uploads, SVN architecture drift).
- **Issue:** These reports are "write-only." Known bugs and WARN states are **never** bubbled up to `action_plan_roadmap.md` or `master-roadmap.md`. 

### 2. Hallucinated Progress (Checklist Gaslighting)
- Items marked as `✅ Done` in `roadmap_checklist.md` are not actually completed.
- Examples: 
  - `3.4.3 docuvia sync CLI` (Missing client-side logic).
  - `1.4.2 Mutex` & `1.3.2 Vector Search` (Using temporary in-memory fallbacks, not `pgvector` or DB-level row locks).

### 3. Untracked Architectural Reality (The Milestone Cliff)
- `master-roadmap.md` arbitrarily truncates at **Milestone 4**.
- Codebase reality: Milestones 5, 6, and 7 (GitHub Webhooks, Slack/Teams bots, Markdown/JSON export, Review UI, VS Code Extension routes) are heavily implemented in the code but completely missing from the Master Roadmap.

### 4. ADR Chaos (Redundancy & Omissions)
- **Missing ADR Links in Roadmap:** ADR-011, 012, 016, 017, and 019 have no corresponding implementation tasks tracked in the roadmap.
- **Redundant AST ADRs:** ADRs `014`, `020`, `021`, and `022` all describe the AST architecture. `022` is the only one tracked, leaving massive ambiguity about the status of the others.
- **Missing Major ADRs:** Action plan mentions transitioning to `pgvector`, but no ADR governs this fundamental data-layer change.

---

## 🛠️ Remediation Action Plan (To Execute Sequentially)

### Phase 1: Drain the QA Swamp (✅ COMPLETED)
- **Action Taken:** Parsed all 80+ reports in `docs/roadmap/reports/`. Extracted 29 reports containing `WARN`, `ERROR`, or `MEDIUM/HIGH` severity bugs. These have been forcefully appended to the **Appendix** of this document to prevent them from rotting in isolation. They must be tracked and resolved.

### Phase 2: Purge ADR Chaos & Sync Master Roadmap
- **Goal:** 
  1. Consolidate AST ADRs (014, 020, 021, 022) into a single SSOT. Write the missing `pgvector` ADR.
  2. Extend `master-roadmap.md` to cover Milestones 5-7 based on the existing `artifacts/api-server` routing reality.

### Phase 3: Correct Checklist Integrity
- **Goal:** Revert false `✅ Done` items in `roadmap_checklist.md` back to `WIP` or `TODO` (e.g., Sync CLI, true DB Mutex, true Vector DB). Link orphaned items to their corresponding ADRs.

---
*Note: Do not proceed with new feature development until Phase 1-3 are completed. Documentation bankruptcy must be resolved to prevent AI hallucination loops.*
## 🗃️ Appendix: Exhaustive QA Swamp Extraction

*(Note: The exhaustive extraction of 29 faulty reports has been successfully migrated to individual tracking files in the `docs/reports/` directory, following the strict Verification Reporting Protocol.)*
