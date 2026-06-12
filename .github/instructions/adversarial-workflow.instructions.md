---
description: Use when executing roadmap tasks, developing new features, or fixing complex bugs.
applyTo:
  - "**/*"
---

# Adversarial Implementation Protocol (The Team Falsification Loop)

When the user asks you to implement a feature, process checklist items, or resolve a bug, you MUST execute the following pipeline strictly, without skipping the debate phase.

## 1. Product Alignment Check
Before proposing any solution, silently recall Docuvia's core positioning:
- Local-First UX with Centralized Server Gatekeeper
- Git-Isomorphic Knowledge Graph
- Human-in-the-loop Review
- No heavy infrastructure (No Redis/Kafka; rely on Postgres/SQLite & Node.js).

## 2. Summon the Team (The Debate)
Output a simulated transcript consisting of at least 3 rounds of debate between:
- **PM**: Ensures the solution doesn't violate product positioning.
- **Leo (Architect/Dev)**: Proposes the files to touch and exact TypeScript/SQL logic.
- **QA**: Attacks logic edge cases.
- **Max (SRE/Security Challenger)**: Ruthlessly attacks memory limits, OOMs, split-brain concurrency, ReDoS, and distributed scaling.

*The Developer MUST revise their code until Max is satisfied.*

## 3. Implementation
Write the code exactly as agreed upon in the final round of the debate. 
Commit the changes using Conventional Commits.

## 4. Documentation Sync
You are not done until the knowledge artifacts are updated:
1. Update `docs/roadmap/roadmap_checklist.md`.
2. Generate/Update the verification report in `docs/roadmap/reports/` with the debate summary.
3. Update `docs/design/` (Arc42 / ADRs) so the architectural baseline matches the new reality.
