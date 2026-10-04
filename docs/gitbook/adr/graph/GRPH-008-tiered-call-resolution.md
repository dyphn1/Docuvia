---
id: GRPH-008
title: Tiered Call Resolution — Proven, Likely and Ambiguous Edges
status: accepted
date: 2026-10-02
domains: [graph, impact]
supersedes: []
superseded_by: []
---

# Tiered Call Resolution — Proven, Likely and Ambiguous Edges

## Context

Tier A uses tree-sitter and ScopeResolver to propose call targets. tree-sitter has no symbol binding or type checker, so receiver calls that need type information can remain unresolved until Tier B's language server (LSP) responds. Running LSP for every call is costly; waiting for it also delays answers to agents.

The earlier System-1 measurements in #553 are exploratory, not certification. Their call-site denominator excluded 2,598 pool and 1,390 held-out rows because a source position could not be mapped to one unique call node. The earlier comparison that described roughly 5–10% of product Tier A edges as wrong used file-level evidence, not call-site evidence: 51 apparent member-call errors were file-level attribution artifacts, while 68 bare-call target misroutes were real and are tracked in #561. Those figures do not establish a product-level error rate.

Resolution is per call site, while node_links with calls type collapse multiple sites from the same source node to the same target. Attaching certainty only to that aggregate edge cannot say which site supplied the evidence, and adding an LSP edge cannot remove a Tier A target that LSP disproves. A portable per-site contract must come before proof labels and Tier B replacement.

## Decision

The call-site resolution is the source of truth. node_links with calls type is only a materialized active projection. A higher-authority result may replace the selected resolution without mutating or erasing the underlying observation history.

This ADR accepts the architecture and engineering defaults below. It does not certify any rule. No signature may skip Tier B until it passes the one-shot unseen certification gate in the [implementation plan](../../analysis/tiered-call-resolution-implementation-plan.md).

### Resolution record

1. Raw AST call-site evidence remains separate from derived resolution.
2. Every call site has a portable, content-scoped identity: versioned SHA-256 over the workspace-relative POSIX path, file-content SHA-256, zero-based callee start row and UTF-16 code-unit column, callee kind and callee name, separated by NUL bytes. The column follows the AstWorker/corpus and TypeScript offset convention, including astral Unicode before the callee. SQLite row IDs and project IDs are not identity.
3. The per-site current resolution stores caller source node key, resolution class, selected target, resolver and rule signature, dependency fingerprint, and verification state. Proven has no confidence value. Confidence is present only for likely.
4. Ordered candidate alternatives live in a normalized per-site candidate table, not solely in an aggregate edge or an opaque JSON field. Resolution observations are append-only so later LSP evidence cannot erase earlier ScopeResolver, proof or ranking evidence.
5. Keep resolution class separate from verification status:
   - Class: proven, likely, ambiguous, unresolved, external or unsupported.
   - Verification: unverified, verified or contradicted.
   - A verified result records its unique local target separately. It does not rename the original class to verified.
6. A dependency fingerprint covers the caller and every consulted config, import/re-export, declaration and index input. Any change invalidates dependent sites before stale proven output can be served.

### Resolution policy

ScopeResolver is unchanged. Its current behavior remains available for recall; it supplies a proposal to the new stages and is never retroactively treated as proof. The ordered stages are:

1. Preserve raw call-site evidence and the ScopeResolver proposal.
2. Apply strict Q1 import, Q2 re-export, Q3 explicit receiver-type, or complete single-candidate proof.
3. If strict proof abstains, apply the calibrated multi-hypothesis filter.
4. Store a selected resolution for the call site and transactionally rebuild the affected caller-file calls projection.
5. Schedule Tier B by class and signature. A unique LSP result may replace the selected target without deleting earlier observations.
6. Serve class, confidence where applicable and bounded alternatives through query, impact and MCP.

A single-candidate result is proven only when its generator is complete for the call shape, the set is not truncated, no import/receiver/alias branch remains unresolved, no same-name collision exists, and exactly one target node remains.

Q1 accepts a unique in-repository source reached through supported relative imports, resolvable baseUrl/paths, explicit named/default aliases or a workspace package binding. Dynamic imports, unresolved conditional exports, ambiguous namespace/wildcard paths, workspace escapes and multiple valid alias expansions abstain.

Q2 tracks visited file-and-symbol pairs, preserves renamed exports, and abstains on cycles, depth limit 16, dead ends or multiple export-star sources.

Q3 uses explicit syntax facts only: a unique this/super/base declaration, typed parameter or field, constructor parameter property, new C() receiver, or unique extends chain. It abstains on unresolved or inferred receiver types, ambiguous union/intersection targets, generic parameters, factory-return inference, multiple interface implementations, abstract members, structural-only types, conditional/mapped types and unresolved aliases. Plain JS support is limited to explicit class/new/extends syntax; JSDoc is a separate slice.

Hypothesis filtering starts from every type that declares the called member. It filters by caller visibility, explicit declared/flowed facts, other receiver members in the same scope, then argument count/shape. Naming, package and DI conventions are weak ranking signals. Candidate recall and end-to-end top-1 are both measured. Calibration thresholds use only the calibration split. Confidence is the one-sided 95% group Clopper–Pearson lower bound. The provisional configurable minimum is 100 independent calibration groups; Phase 2 validates and records the chosen threshold. A signature below that threshold, without valid calibration, or with calibrated family-macro top-1 below the 90% target abstains to ambiguous.

### Tier B and canary

Until a signature passes unseen certification, every call site continues to Tier B even when the strict rule labels it proven. After certification, a certified signature may skip LSP except for a deterministic canary selected by a versioned hash of call-site key and rule signature. The provisional configurable sampling rate is 10%; Phase 4 validates and records the chosen rate. Sampling is stratified by signature.

For likely, Tier B runs in the background at low priority; ambiguous, unresolved and unsupported sites go first. A normal LSP response with one unique in-repository target is verification evidence and may replace the selected target. A timeout, no result, external result or multi-location ambiguity is not a contradiction.

The first valid LSP contradiction of a proven result quarantines the signature locally, disables its Tier B skip, and exposes its affected results as ambiguous until recertification. It does not become likely. Canary health is local runtime state, not portable knowledge truth.

### Materialized graph and compatibility

Per-call-site selected resolutions are authoritative. node_links with calls type is rebuilt from all current site selections for each affected caller file inside one transaction. A collapsed source-to-target link remains active while at least one current call site selects it; an LSP replacement removes the old target only when no remaining site selects it.

Snapshots keep call-sites.jsonl as raw AST evidence and add a versioned call-resolutions.jsonl capability for class, selected target, confidence, resolver/signature, verification state and target, dependency fingerprint and ordered alternatives. Hydration without that capability reports certainty as unavailable or recomputes it from source. It never fabricates proven from a legacy aggregate edge.

query, impact and MCP label each returned resolution. likely returns its top target, confidence and up to two alternatives; ambiguous returns at most three ordered candidates. An explicit explain-resolution option exposes full evidence. Impact marks heuristic/provisional contributions separately from verified blast-radius counts.

## Certification gate

Certification is required per rule signature before it may skip LSP:

- Use both a wholly unseen repository family and a newer, unseen temporal commit from an existing family. Keep these evidence tracks separate.
- Freeze the resolver/rule/configuration hash, oracle identity/configuration and corpus manifest/split hashes before exposing certification outcomes.
- Require zero valid contradictions and a one-sided 95% group Clopper–Pearson lower bound of at least .990 for each signature on both tracks. With the current exact-bound definition, 299/299 independent successful groups is the first all-success sample size reaching .990.
- If support is insufficient, a signature stays Tier B verified. Do not let another signature's volume raise its bound.
- Once certification outcomes are inspected, the data is regression-only. A changed rule requires a fresh unseen slice.

The currently available System-1 v2 temporal and test sets have already informed #553 and this design. They are regression data, not unseen certification evidence. Certification captures only the frozen signatures and declared slices; it does not prove every language or syntax shape.

## Consequences

- Call-site identity, evidence, verification and active graph projection have clear separate roles; LSP can correct a selected target without losing why it was selected.
- Agents can receive immediate likely or ambiguous answers with explicit certainty and bounded candidates.
- Proven rules can reduce LSP work only after signature-level evidence supports that behavior.
- The graph schema, contracts and versioned snapshot capability change; implementation must preserve honest behavior for legacy snapshots.
- Every unsupported or under-supported shape remains on Tier B.

## Rejected alternatives

- **Learned direct-target scorers in the critical path:** #553 did not certify cross-family transfer. Learned scorers may be reconsidered for routing only.
- **Changing ScopeResolver directly:** it risks reducing recall for impact and query; the new proof and ranking stages remain separate.
- **Storing certainty only on node_links:** aggregate links cannot preserve different evidence or verification for multiple call sites.
- **Calling LSP's result a new resolution class:** verification status must not erase whether the original rule was proven or likely.
- **Full type inference in Tier A:** this duplicates the language server and violates the syntax-only cost boundary.

## Delivery

Implement phases and exit gates in the [Tiered Call Resolution Implementation Plan](../../analysis/tiered-call-resolution-implementation-plan.md). Begin with #561, then complete Phase 0 before Phase 1. Keep the capability on the Tier B path until its per-signature certification gate passes.

References: [#468](https://github.com/dyphn1/Docuvia/issues/468), [#553](https://github.com/dyphn1/Docuvia/issues/553), [#559](https://github.com/dyphn1/Docuvia/issues/559), [#561](https://github.com/dyphn1/Docuvia/issues/561), [IMPT-002](../impact/IMPT-002-lsp-for-absolute-quality.md), [PLAT-007](../platform/PLAT-007-tiered-background-knowledge-evolution.md), [System-1 analysis](../../analysis/semantic-decision-phase2-system1-query-routing.md).
