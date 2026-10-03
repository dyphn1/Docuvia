# Tiered Call Resolution Implementation Plan

This plan executes [GRPH-008](../adr/graph/GRPH-008-tiered-call-resolution.md) in ordered, reviewable phases. The ADR accepts the architecture and engineering defaults; it does not certify any rule or authorize skipping Tier B. Each phase has an exit gate. Start the next phase only after its predecessor's code, evidence and review are complete.

## Product priority clarified by #559

The latest direction in [#559 comment 5969397300](https://github.com/dyphn1/Docuvia/issues/559#issuecomment-5969397300) sets the implementation priority: **P1 cheap semantic facts → P2-A candidate recall/set quality → P2-B System One ranking and abstention → P3 strict proof/completeness → P4 Tier B skip/canary → P5 unseen certification.** The snapshot/output capability below remains required product work before certification, but it does not gate P2-A or P2-B.

The cheap first stage should return useful `likely` results for common cases and leave hard or uncertain cases to LSP. The practical target is useful quality around 90% for ordinary cases; this is not a certification threshold. Candidate recall and candidate-set quality come before ranking. `candidateSetComplete` limits `proven` claims and any later Tier B skip authority; it is not a prerequisite for a calibrated `likely` result. Do not grow Tier A into a second TypeScript checker. Keep LSP as fallback and preserve every eligible site in coverage and abstention denominators.

## Delivery rules

- Fix #561 first. It can proceed independently, but Phase 3 proof work and any certification depend on its verified fix being present on the implementation branch with regression coverage; it does not need to merge.
- Preserve ScopeResolver behavior and recall. New logic consumes its proposal and adds stricter evidence after it.
- Keep raw call-site evidence, per-site resolution, verification observations and the active graph projection separate.
- Never promote a rule based on an aggregate score that hides an under-supported signature or repository family.
- Keep certification data sealed until the resolver, rule/configuration hash and corpus manifest are frozen.
- Commit a phase only when its exit gate passes. If a gate fails, report the failed evidence and keep the feature on the safe Tier B path.

## Phase 0 — Measurement and baseline

**Purpose:** Establish a trustworthy call-site-level baseline before introducing type facts or changing resolution.

**Prerequisite:** A verified #561 commit is present on the implementation branch with a regression fixture proving that a returned anonymous arrow does not become a same-name declaration node. Preserve the existing inline-callback behavior.

**Work:**

1. Define and round-trip a portable call-site key. Use a versioned SHA-256 over workspace-relative POSIX file path, exact file content hash, zero-based callee start row and UTF-16 code-unit column, callee kind, and callee name, separated by NUL bytes. A SQLite row ID or project ID is never part of the identity. Reuse the AstWorker/corpus position convention and TypeScript offsets; UTF-8 byte length must not alter identity when astral Unicode precedes the callee.
2. For every eligible call-site row, resolve its position to exactly one AST call node. Record explicit exclusion reasons for zero or multiple matches. Include receiver calls such as this.m() in the audit.
3. Recompute ScopeResolver's baseline at call-site level. Do not use file-level call-target evidence to claim call-site precision. Separate true bare-call target misroutes from same-file member calls whose file-level evidence only appeared to match.
4. Finish a receiver-binding-not-found taxonomy and a per-shape table.
5. Report candidate recall, end-to-end top-1, coverage, abstention, duplicate-group and family macro metrics, worst-family results, temporal results, ECE, Brier score, LSP request/readiness cost, latency and peak RSS.
6. Measure TypeScript PartialSemantic only as a separate Tier B0 candidate. Report accuracy, coverage, latency and memory by call-site shape. Do not put it in Tier A or combine its evidence with Q1/Q2/Q3 signatures.
7. Lock performance baselines on a fixed corpus: resolver-only p95 no more than 2× the measured baseline; fixed-corpus post-commit Tier A wall time regression below 10%; no TypeScript server/LSP process started on the post-commit Tier A path. Record peak RSS.

**Exit gate:** The position audit accounts for 100% of call-site rows as uniquely mapped or explicitly excluded. The baseline and all exclusions are reproducible from pinned revisions and hashes. PartialSemantic remains measurement-only.

**Status: Complete.** The fixed-source run accounts for all 31,578 rows, verifies all ten pinned snapshot hashes, and leaves PartialSemantic measurement-only. See the [Phase 0 measurement gate report](./tiered-call-resolution-phase0-results.md) for metrics, exclusions, costs, and artifact checksums. This closes measurement only; it does not certify signatures or permit Tier B skips.

## Phase 1 — Declared type facts

**Purpose:** Build a syntax-only index that later proof and hypothesis rules can consume.

**Work:**

- Implement TS/JS first with a table-driven extractor grounded in the checked-in tree-sitter grammar node types.
- Capture explicit field and parameter annotations, constructor parameter properties, direct new C() initializers, return-type annotations, and implements/extends relationships.
- Keep extraction additive: it must not change existing ScopeResolver edges or materialized calls links.
- Emit enough source and dependency information to identify the declaration that supplied each fact.
- Add positive and negative grammar fixtures for every supported shape. Unsupported, malformed, generic, union, mapped, conditional or otherwise unresolved type syntax must abstain instead of manufacturing a fact.

**Exit gate:** Every supported shape has a fixture. The new index is deterministic on the fixed corpus, records its inputs, and leaves existing graph edges byte-for-byte equivalent.

**Status: Complete.** The fixed corpus emitted versioned facts with per-file content hashes, two corrected full-corpus extractions were byte-identical, and the pre-facts HEAD worker, current parser, and persisted graph matched all 58,338 call edges. See the [Phase 1 results](./tiered-call-resolution-phase1-results.md). No signatures were certified or promoted.

## Phase 2 — Candidate recall, then multi-hypothesis ranking

**Purpose:** First measure and improve candidate recall/set quality from cheap source facts. Then let System One rank within the available candidate set and emit a calibrated `likely` result or abstain. Incomplete candidate inventory does not by itself prevent a `likely` result; it still prevents strict `proven` status and does not authorize skipping Tier B.

**Work:**

- **P2-A:** Generate candidates only from pinned source/facts/shape evidence. Report candidate recall over uniquely mapped positive targets, while separately reporting all eligible sites, ambiguous/unmapped positives, zero-candidate rate and candidate-set size. Keep unsupported shapes and missing evidence visible as abstentions; do not require globally complete candidate sets to study recall.
- **P2-B:** Rank only within the existing candidate set. Apply filters in order: visibility from the caller, explicit declaration or flow facts, other receiver members used in the same scope, parameter count/shape, then weak naming/package/DI signals. Use calibration labels only to choose the `likely`/abstention threshold; report accepted precision separately from raw top-1, end-to-end accuracy, coverage and abstention.
- Preserve every eligible site in site-level coverage and end-to-end denominators. Report duplicate-group and family/call-shape metrics so a narrow high-precision subset cannot stand in for ordinary-case usefulness.
- Version each rule signature and its feature/calibration inputs. Confidence is the one-sided 95% Clopper–Pearson lower bound on duplicate-group precision, not a raw hit rate.
- Choose `likely`/abstention thresholds only on the calibration split and bind them to the ranking rule, candidate-generator version, source facts/configuration and split hashes. Strict proof support and unseen-certification requirements remain later gates; they do not block useful `likely` output. A new or changed signature has no inherited calibration.
- Report coverage, abstention, ECE, Brier score, family macro, worst-family and temporal results with every threshold.

**Exit gate:** Candidate-generation and ranking artifacts are reproducible and source-only. Calibration is isolated from train/test/temporal labels; every eligible site remains in reported denominators; unsupported, tied or under-supported cases abstain and continue to Tier B. No Phase 2 result enables a Tier B skip.

## Phase 3 — Strict proof and per-call-site source of truth

**Purpose:** Add proven rules and persist selected resolution per call site without changing ScopeResolver.

**Portable identity:** The call-site key is versioned and file-version scoped:

- Hash workspace-relative POSIX path, exact file content SHA-256, zero-based callee start row and UTF-16 code-unit column, callee kind, and callee name with NUL separators.
- Do not use SQLite IDs, project IDs, or an identity that claims to survive edits.
- Store the exact source node key for the enclosing caller function, falling back to the file node only when the AST has no function container.

**Resolution records:** Keep normalized, queryable records rather than putting certainty on aggregate node_links or hiding all candidates in JSON.

- call_site_resolutions holds current per-site class, selected target, confidence when applicable, resolver/signature, verification status and dependency fingerprint.
- call_site_resolution_candidates holds ordered target candidates and their evidence for that call site.
- call_site_resolution_observations is append-only. It records ScopeResolver proposals, strict proofs, hypothesis rankings and LSP results so a higher-authority selection does not erase earlier evidence.
- Use resolution classes proven, likely, ambiguous, unresolved, external and unsupported. Keep verification status separate: unverified, verified or contradicted. Proven has no fabricated confidence value.
- The selected target may advance when LSP returns a unique repository-local result; retain the original class and rule evidence, and record the verified target/status independently.

**Proof boundary:**

- A single candidate is proven only when candidate generation is complete for the call shape, the set is not truncated, there is no unresolved import/receiver/alias branch or same-name collision, and exactly one target node remains.
- Q1 accepts only an explicitly named import whose relative, supported baseUrl/paths, or workspace-package source resolves to one in-repository file. Dynamic imports, unresolved conditional exports, multi-source namespace/wildcard paths, multiple aliases, and workspace escapes abstain.
- Q2 traces re-exports by file-and-symbol pair, preserving renamed symbols. A cycle, depth limit of 16, dead end, or multiple export-star sources abstains.
- Q3 accepts explicit facts only: unique this/super/base declaration, typed parameter/field/constructor parameter property, new C() receiver, or a unique extends chain. Ambiguous unions/intersections, generic parameters, inferred/factory returns, interfaces with multiple implementations, abstract members, structural-only types and unresolved aliases abstain. Plain JS support is limited to explicit class/new/extends syntax; JSDoc is a separate slice.

**Materialization and invalidation:**

- Treat call-site resolution as the source of truth. Treat node_links with calls type only as the materialized active projection.
- Rebuild the affected caller-file projection in one transaction after Tier A selection or a Tier B replacement. A collapsed caller-to-target edge remains active while any current call site still selects that target.
- Fingerprint every consulted dependency, including config/path mappings, re-export files, type declarations and shared indexes. On any change, invalidate dependent sites before serving the old selection; while recomputation is pending, stale proven status is unavailable.
- Preserve ScopeResolver's original proposal as an observation, not as a strict proof.

**Exit gate:** Single-candidate and each Q rule have positive, negative, collision, truncation, cycle and abstention tests. Call-site state survives delete/reparse without SQLite identity, and a projection rebuild correctly removes an LSP-disproved target only when no other site selects it.

## Phase 4 — Tier B scheduling, verification and canary

**Purpose:** Apply resolution authority safely and make valid contradictions visible.

**Work:**

- Until a rule signature passes one-shot certification, every call site still goes to Tier B. Proven is a rule result, not permission to skip LSP by itself.
- After certification, skip LSP only for that certified signature, except its deterministic canary. Start with a configurable 10% sample rate as a provisional default, selected by a versioned SHA-256 policy over call-site key and rule signature; validate and record the rate in this phase. Stratify by signature so a high-volume rule cannot hide another rule's failure.
- An ordinary LSP result is a separate verification fact. A unique in-repository target becomes the selected target and updates the caller-file projection transactionally; retain the original resolution class and all observations.
- Timeouts, no result, external results or multi-location ambiguity are not contradictions.
- The first valid contradiction — a normal LSP response with one repository-local target different from a proven target — quarantines that signature locally, removes its permission to skip Tier B, and exposes affected sites as ambiguous until recertified. Do not demote it to likely.
- Keep canary health/quarantine local runtime metadata. Do not serialize it as shared knowledge truth.

**Exit gate:** Tests prove scheduling by class, valid/invalid contradiction classification, first-mismatch quarantine, deterministic sampling, and transactional replacement in the collapsed graph projection.

## Phase 5 — Snapshot and user-facing outputs

**Purpose:** Preserve certainty across clones and make each answer's authority understandable.

**Work:**

- Add a versioned call-resolutions snapshot capability. Keep call-sites.jsonl as raw AST evidence.
- Round-trip class, selected target, confidence, resolver/signature, verification state and target, dependency fingerprint, and ordered alternatives. Keep local canary quarantine out of portable knowledge truth.
- Hydration from an older snapshot without the capability must report resolution certainty as unavailable/unknown or recompute from available source. Never infer proven from an old aggregate calls edge.
- query, impact and MCP identify each returned edge's class. likely shows its top target, confidence and at most two alternatives; ambiguous shows at most three ordered candidates. Full evidence is available through an explicit explain-resolution option.
- Impact must label heuristic/provisional contributions so they are not silently combined with verified blast-radius counts.

**Exit gate:** Export → hydrate → query/impact/MCP retains the same certainty data. Legacy snapshots degrade honestly, and all output limits are enforced.

## Final certification gate

The current local System-1 v2 files, including their temporal and test outputs, have already informed #553 and this design. They are regression data, not unseen certification evidence.

Before opening certification labels:

1. Pin a wholly new repository family and a newer commit from an existing family that was not used in previous analysis. The local VS Code checkout is a candidate family only; verify license, source provenance, TypeScript server readiness and sample sufficiency before accepting it. The current local Nest checkout is at the already-used corpus revision, so obtain and pin a later revision for the temporal slice.
2. Freeze the implementation commit, rule/signature/configuration hash, oracle version/config hash, and corpus manifest/split hashes. Save those hashes and the timestamp before running certification.
3. Keep the new-family and temporal tracks separate, and report each rule signature separately. Use duplicate groups as independent trials; do not pool a weak signature into a large aggregate.
4. Require zero valid contradictions and a one-sided 95% group Clopper–Pearson lower bound of at least .990 for each proven signature in both tracks. Under the current exact-bound implementation, 299/299 independent successful groups is the first all-success sample size that reaches .990. Fewer observations leave that signature unpromoted.
5. Once certification outcomes are inspected, that data is regression-only. Any resolver/signature change requires fresh unseen certification data; do not tune and rerun on the same held-out set.

A failed or underpowered signature remains Tier B verified in production. Certification is evidence for one frozen signature on the declared slices; it does not establish correctness for every repository, language or syntax shape.
