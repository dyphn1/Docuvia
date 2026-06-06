# Docuvia Current-State Review Report

> Generated: 2026-06-06  
> Scope: `docs/design/`, `docs/roadmap/master-roadmap.md`, `docs/roadmap/roadmap_checklist.md`, `docs/archive_v1_design/`  
> Purpose: Evaluate feature coverage, internal consistency, and delivery readiness against the roadmap checklist

---

## 1. Executive Assessment

Docuvia is not in a delivery-ready state. It is in an advanced prototyping and validation phase, with strong architectural intent but incomplete operational closure.

The main issue is not the absence of ideas. The issue is that **design completeness, implementation completeness, and verification evidence do not line up**. The documentation is rich, the domain model is ambitious, and several subsystems are clearly scaffolded, but the roadmap checklist shows that a large share of the system still lacks proof of correctness, proof of stability, or proof of end-to-end closure.

If I were reviewing this as a gate for release readiness, the current answer would be: **architecturally impressive, operationally incomplete, and too uneven to trust uniformly**.

---

## 2. Coverage Review by Roadmap Area

### 2.1 Milestone 1 — Knowledge Graph Foundation & API Server

This is the strongest part of the system. It has the clearest technical shape and the highest apparent implementation density.

- The database model, ORM strategy, ingestion foundation, API-first contract strategy, and RAG router all form a coherent backbone.
- However, the checklist reveals a significant mismatch between “documented as done” and “actually verified as done.” Many core ingestion and query items remain pending in the verification tracking table.
- That matters because this layer is not a feature; it is the substrate. If the substrate is only partially verified, every higher-level promise inherits uncertainty.

**Review verdict:** structurally strong, but not yet evidence-complete.

### 2.2 Milestone 2 — VS Code Client (Local-First Architecture)

This is one of the most product-defining areas, and also one of the most fragile.

- The local-first story is compelling and very coherent on paper.
- The extension surface is broad: TreeView, Chat participant, CodeLens, Hover, TaskRunner, and fallback behavior all suggest a mature editor-native product.
- But the archive roadmap exposes a pattern of critical edge cases that are not “nice to fix later” issues. They directly affect workspace targeting, initialization correctness, and local knowledge consistency.

The problem here is not that the extension is weak. The problem is that **its success depends on a long tail of correctness details**, and those details are exactly where the roadmap still shows gaps.

**Review verdict:** high-value UX, but brittle in real-world edge cases.

### 2.3 Milestone 3 — Swarm Intelligence & Git-Isomorphic Sync

This is the most ambitious part of the architecture and also the least operationally closed.

- The conceptual model is strong: orphan branches, temporal deltas, ancestor anchoring, decay-based relevance, and fast-path routing all fit together intellectually.
- But the checklist shows the central promise is still incomplete: orphan-branch writer, bidirectional sync, `docuvia sync`, KnowledgeStore rewrite, and merge-base projection are still not done.
- In practical terms, the system’s most differentiated idea is still mostly a design narrative rather than a dependable runtime capability.

This is a serious issue. When the core identity of the product is also one of the least finished areas, the architecture becomes vulnerable to “beautiful but unfinished” syndrome.

**Review verdict:** the most original subsystem, but also the least production-credible.

### 2.4 Milestone 4 — Knowledge Graph Features (ADRs 009–012)

This layer deals with the long-term quality of the knowledge model itself.

- The ideas are strong: deduplication, bootstrap-to-path-rules, two-phase validity, and misc pool handling all address real knowledge-graph failure modes.
- But the checklist makes it obvious that these are not yet normalized system behaviors. They are still being absorbed into the product model.
- This matters because these features are not decorative. They define whether knowledge remains trustworthy over time or becomes progressively noisy, stale, or orphaned.

**Review verdict:** strategically important, but still too soft around the edges.

### 2.5 Milestone 5 — Human-in-the-Loop & Review System

This is one of the better-formed parts of the system.

- The review queue, resolution flow, correction examples, and feedback loop are all aligned.
- The design maps cleanly to concrete tables, routes, and product screens.
- The human-in-the-loop loop is understandable enough that it could plausibly survive real usage.

That said, the review system is only as useful as the consistency of the inputs and the rigor of the downstream gates. If the surrounding model is unstable, this layer becomes a correction buffer rather than a real quality-control mechanism.

**Review verdict:** one of the strongest closed loops in the product, but dependent on upstream discipline.

### 2.6 Milestone 6 — API & Protocol Layer

This is the most engineered and internally disciplined layer.

- The OpenAPI single-source-of-truth approach is clean and defensible.
- The route structure, generated clients, validation strategy, and MCP surface are logically separated.
- This layer reads like a team that knows where contract drift comes from and is trying to eliminate it systematically.

The weakness here is not the contract model. The weakness is that parts of the surrounding platform are still only partially consistent with the contract-first ideal.

**Review verdict:** the most polished engineering layer in the stack.

### 2.7 Milestone 7 — Frontend (kg-engine)

The frontend has a clear page-level decomposition, but its maturity is uneven.

- Dashboard, Pipeline, Query, Review, and Settings are all sensible surfaces.
- The concern is not missing pages. The concern is whether the interactions underneath them are equally mature.
- From the roadmap perspective, the frontend appears broader than deep: a usable shell with less evidence of complete behavioral hardening.

**Review verdict:** adequate breadth, weaker proof of deep reliability.

### 2.8 Milestone 8 — VS Code Extension UI

This is the highest-visibility part of the product, which makes its correctness requirements unforgiving.

- TreeView, CodeLens, Hover, Chat participant, Command Palette, and webviews create a strong editor-native experience.
- But the roadmap also admits several high-impact failure modes: line anchoring drift, multi-root targeting, local fallback inconsistency, security concerns, and context attribution ambiguity.
- Those are not cosmetic concerns. They are the kind of defects that make users stop trusting the tool.

The extension may feel feature-rich, but richness is not the same as reliability. Here, the margin for error is small.

**Review verdict:** impressive surface area, but correctness debt is still visible.

### 2.9 Milestone 9 — Cross-Cutting Concerns

This is where the unevenness of the whole project becomes easiest to see.

- Security is present, but not yet uniformly hardened.
- Observability exists in principle, but alerting and actionable diagnosis are not fully closed.
- Testing is meaningful in some core areas, but high-value E2E coverage is still missing where it matters most.
- Coding standards are strong; that part is comparatively disciplined.

In short: the project has standards, but not yet a uniformly enforced operational regime.

**Review verdict:** decent baseline, insufficiently hardened for a system of this ambition.

### 2.10 Milestone 10 — Deployment & Operations

This is the clearest gap between “designed” and “deliverable.”

- Single-host deployment exists as a documented topology, but production packaging is still incomplete.
- Static frontend serving is not wired for production.
- `.vsix` packaging is missing.
- Migration strategy is still not fully settled.
- CI and runtime versioning differences remain visible.

This area is not glamorous, but it is the difference between a strong internal build and an actually distributable product. Right now, Docuvia looks stronger in the lab than in the field.

**Review verdict:** the weakest part of the overall delivery story.

---

## 3. Three-Pass Critique

### Pass 1 — Design Coherence

At the design level, Docuvia is unusually coherent. The terminology is consistent, the layers connect logically, and the architecture tells a unified story.

But that coherence comes with a trap: a polished narrative can hide an incomplete system. The documentation is far ahead of the verification evidence.

### Pass 2 — Roadmap Reality

The roadmap checklist is the more honest source of truth.

- Many items are marked complete at the feature level.
- Yet the verification table shows a large amount of pending work.
- The archive roadmap preserves numerous critical gaps, which means the system still carries a significant live backlog of correctness issues.

That combination is important: the project is not missing ambition, it is missing closure. It reads like a system that has been built forward faster than it has been stabilized.

### Pass 3 — Trustworthiness as a Product

The deepest issue is trust.

- If deployment is incomplete, trust fails at release time.
- If extension edge cases are unresolved, trust fails in daily usage.
- If sync and validity rules remain partial, trust fails at the knowledge-model level.

So the real problem is not whether Docuvia is clever. It is clever. The problem is whether it is consistently dependable enough for users to rely on it without second-guessing the result.

Right now, the answer is: **not yet**.

---

## 4. Stronger Functional Diagnosis

### Relatively mature

- API contract and generated client strategy
- Review queue and correction-feedback loop
- Core database and ingestion foundation
- High-level VS Code extension shell
- Coding standards and vocabulary discipline

### Partially mature

- Frontend interaction depth
- MCP / Agentic RAG routing details
- Ingestion and generation pipeline edge behavior
- Security, observability, and testing coverage

### Most fragile

- Git-isomorphic sync and orphan-branch workflow
- Two-phase validity model
- Deployment and packaging
- Multi-root extension correctness
- Local-first fallback behavior under failure

---

## 5. Final Verdict

Docuvia is a strong architecture under construction, not a finished platform.

It has real substance:

- a coherent domain model,
- a differentiated product story,
- a serious API-first discipline,
- and a clear intent to make knowledge durable over time.

But it also has a visible maturity gap:

- the most ambitious ideas are not yet the most stable ones,
- the delivery path is weaker than the design path,
- and the verification story is not yet strong enough to support full confidence.

If this were being reviewed for release, the honest verdict would be:

**excellent ambition, strong architecture, incomplete operational readiness, and too much unresolved edge-case risk to call it stable.**
