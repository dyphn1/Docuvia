# Exact caller policy for calls edges

## Meaning of exact caller

The `exact-enclosing-v2` policy assigns each `calls` edge to the unique innermost function node whose AST line span contains the call. It does not trust `ParsedCall.sourceFunction`, which can describe an outer function or callback parameter instead of the function body that encloses the call.

- **Callbacks and arrow functions:** calls in a parsed callback or arrow body use that function's node when its span is uniquely innermost.
- **Nested functions:** the smallest enclosing function span wins, including when the parser's legacy caller hint names an outer function.
- **Class field initializers:** a call evaluated by the initializer itself uses the file node. A call inside a parsed arrow/function body assigned to a field uses that function node.
- **Top-level code:** calls outside every function span use the file node.
- **Tied spans:** when multiple innermost function nodes have the same span, use the file node. This preserves the conservative file-node fallback established by #573.
- **Missing or invalid spans:** use the file node.

Function node keys are the same persisted keys used by the graph: `buildQualifiedBaseKey(file, name, containerName)` followed by `buildUniqueNodeKey`. That yields `<file>#<qualified-name>` normally, `@L<startLine>` on a collision, and a numeric suffix if that key is already occupied. The file-node key is the workspace-relative file path. A call whose parsed function has no graph node falls back to that file key.

## Uniformity and persisted policy

The caller policy applies to every `calls` edge in a graph, whether or not a call has a proven Q1/Q2/Q3 target. Proof projection may replace the target; it uses the same caller policy as unresolved and unproven calls. The exact caller remains separately recorded in `call_site_resolutions.caller_node_key`.

The historical policy is identified as `scope-resolver-v1`; `exact-enclosing-v1` is the earlier exact projection and `exact-enclosing-v2` is the exact projection with lexical context links. `contains` continues to mean file ownership only: each file owns its symbols through `contains` edges under every policy. V2 adds two separate relationships:

- `lexical_parent` links an enclosing function to a nested function when their AST spans identify a unique parent.
- `lexical_owner` links a class or struct to a member function or field-initializer function when no enclosing function span applies.
- `caller_candidate` records the distinct function named by the legacy ScopeResolver attribution when it has no persisted `lexical_parent` path from the exact caller. It is an explicit, lower-confidence context candidate, not a containment or dependency claim.

Impact follows `lexical_parent` links from an exact callback caller and includes the enclosing functions. It does not add the enclosing functions' own dependents, so impact breadth matches the `scope-resolver-v1` single call hop. A class/struct owner or the containing file is added only when no named function encloses the caller (for example a top-level or field-initializer callback), so an all-anonymous chain still names the scope a reader can find. When the exact caller has no lexical-parent path to the distinct ScopeResolver-attributed function, impact also includes that function as a `caller-candidate` context row. This preserves the historical named-function impact set without claiming that tied or crossing spans establish containment. Candidate context is terminal: impact does not expand its incoming dependents. `lexical_owner` is also terminal: impact may include the class/struct as context, but does not continue through the owner or expand its incoming dependents. File `contains` links provide ownership context and are never followed as lexical parents. Impact does not recurse over ordinary caller edges, preserving the bounded call-hop behavior. Equal or crossing AST spans remain unlinked, and exact caller attribution still falls back to the file node for ties.

`caller_candidate`, `lexical_parent`, and `lexical_owner` are structural context relations. They are available to impact's bounded context walk but are excluded from query dependency context and topology dependency projections. They never become dependency edges. `contains` remains file ownership only.

A caller candidate is persisted only when its node differs from the resolved callee. Impact also seeds its resolved-node set with the queried target, so a same-span callback or malformed legacy context cannot return the target as its own caller. A direct-callee candidate remains visible with `edgeSource: "caller-candidate"` and is terminal. Real recursive calls follow v1 behavior: the unusable self `calls` graph edge is discarded while its call-site resolution row remains recorded.

Only `exact-enclosing-v2` writes `lexical_parent`, `lexical_owner`, and `caller_candidate`; `scope-resolver-v1` and `exact-enclosing-v1` do not persist these structural links.

The caller candidate rule is deliberately scoped to a missing `lexical_parent` path and an explicit legacy function-node attribution. It does not infer node kinds from keys, alter call targets, or convert ambiguity into containment. This lets v2 preserve ScopeResolver's named-function impact context while retaining exact caller attribution and truthful lexical links.

The earlier deterministic full-source parity audit compared ImpactService membership against ScopeResolver. That measured parity/recall vs v1, not precision: a zero omission count says v2 retains the old entries, but does not establish that v2-only additions are valid. The follow-up precision gate and current default are recorded below.

## V2 default acceptance gate

The parity audit measures recall/parity vs v1; it does not establish addition precision. The unweighted balanced sample score is retained as a **stratified stress score** (TP / all reviewed sample items, with unsure counted as not-TP). It is a diagnostic that gives sampled strata similar influence and is not a population precision estimate.

The gate uses a population-weighted precision estimate over reviewable additions. Within each category, the conservative TP rate is TP / reviewed items; unsure counts as not-TP. Each category rate is weighted by that category's eligible reviewable additions. The reported nominal 95% interval sums the same weights times per-stratum 99% Wilson bounds, with Bonferroni correction across the five fixed categories; a fully labeled stratum uses its exact finite-population rate, and no finite-population correction is used for sampled strata. This interval treats the deterministic hash-ranked sample as randomized within each stratum, so it is a sampling uncertainty estimate rather than a guarantee against label or corpus bias.

The default gate passes only when adequate review coverage is present, the population-weighted interval's lower bound is at least 0.90, and every category with at least 10 eligible additions has a conservative TP rate of at least 0.80. A category with fewer than 10 eligible additions must be exhaustively labeled and is reported separately without a category floor. If any category misses its coverage requirement, the result is **inconclusive**, never pass. The weighted lower bound protects the population-level decision; category floors prevent a low-precision high-volume stratum from being hidden by the other categories.

### Review-label provenance

Review artifacts use unique repository audit identities (`remote URL + HEAD SHA`, or absolute root path + HEAD SHA when no origin exists). Those identities key report lookup and sample labels, so equal basenames cannot mix source evidence. Duplicate identities are rejected before sampling. A review label is carried by `--labels-from` only when both its unique sample key and SHA-256 evidence fingerprint match. The fingerprint covers the audit HEAD, candidate caller policy, target and caller snippets, and call-site evidence. A mismatch becomes an unreviewed placeholder and makes the gate inconclusive until it is reviewed again.

Legacy artifacts may be migrated only with the explicit `--migrate-legacy-labels-from` option. Migration requires an exact match of the old target/caller node keys and source snippets; the resulting artifact stores the new unique key and fingerprint. This migration path is not used by ordinary label carryover.

### Historical pre-fix measurements

The original PR review at `bd5f4bb` reported 5,666 v1 named-function pairs and 7,711 v2 pairs: zero omissions, 2,045 additions, and 966 unique added nodes. Those counts measure parity/recall vs v1 and do not establish whether additions are correct.

Before the self-entry fix, the seven-repository audit at `aeae294e4` parsed 9,726 files and compared 19,451 callees. The old source-review artifact is preserved at [the pre-fix artifact](tiered-call-resolution-exact-caller-impact-review-pre-fix.json), with seed `pr583-aeae294e`:

| Pre-fix measure                              |                             Result |
| -------------------------------------------- | ---------------------------------: |
| V1 / V2 named-function pairs                 |                    38,655 / 43,755 |
| V1 omissions / v2 additions                  |                          1 / 5,101 |
| Unique v2-added named nodes                  |                              3,186 |
| V2-only impact entries                       |                             24,881 |
| Sample labels                                | 29 TP, 21 FP, 10 unsure (60 total) |
| Stratified stress score / judged sample rate |                      48.3% / 58.0% |

All 29 non-TP items in the caller-candidate and ambiguous-span sample strata were self entries (`target.nodeKey === addedCaller.nodeKey`). The self-entry guard removes those artifacts from current impact results. The ten minified D3 rows in the pre-fix artifact remain marked unsure; the revised review excludes minified and vendored bundles from labels but still counts and reports them.

### Post-fix seven-repository audit

The audit was rerun after the persister and impact self-entry guards. Onyx excludes every path segment named `ee`; GitNexus was not used.

| Repository                 | Parsed files | Callee nodes |   V1 pairs |   V2 pairs | V1 omissions | V2 additions |
| -------------------------- | -----------: | -----------: | ---------: | ---------: | -----------: | -----------: |
| Graft                      |          282 |        1,490 |      1,691 |      2,050 |            0 |          359 |
| Nest                       |        2,003 |        1,949 |      1,800 |      2,601 |            0 |          801 |
| typescript-language-server |          106 |          384 |        530 |        644 |            0 |          114 |
| code-review-graph          |          309 |        1,815 |      5,385 |      5,561 |            0 |          176 |
| repomind                   |          329 |          734 |        868 |      1,165 |            0 |          297 |
| Understand-Anything        |          310 |        1,094 |      1,316 |      1,688 |            0 |          372 |
| Onyx (`ee` excluded)       |        6,387 |       11,985 |     27,065 |     29,576 |            1 |        2,512 |
| **Total**                  |    **9,726** |   **19,451** | **38,655** | **43,285** |        **1** |    **4,631** |

The single missing pair remains Onyx `jquery.js#bb` for `preventDefault`; source inspection shows the body does not call `preventDefault`, so this is a v1 false positive. The audit totals 24,411 v2-only impact entries and 2,760 unique added named nodes.

| Measure                                   | Pre-fix (`aeae294e4`) |             Post-fix |
| ----------------------------------------- | --------------------: | -------------------: |
| V1 named-function pairs                   |                38,655 |               38,655 |
| V2 named-function pairs                   |                43,755 |               43,285 |
| V1 omissions / v2 additions               |             1 / 5,101 |            1 / 4,631 |
| Unique v2-added named nodes               |                 3,186 |                2,760 |
| V2-only impact entries                    |                24,881 |               24,411 |
| Sample TP / FP / unsure (different seeds) |          29 / 21 / 10 |           51 / 9 / 0 |
| Stratified stress score (TP / reviewed)   |                 48.3% |                85.0% |
| File delta median / p90 / min / max       |  0 / 0 / -1,177 / +75 | 0 / 0 / -1,177 / +75 |

The post-fix sample has 60 source-reviewed items and seed `pr583-selfguard-final-20261008`. Labels were retained through the explicit legacy migration because each selected item matched its current source snippets; all 60 now carry repo HEAD, policy, and evidence fingerprint provenance. Its rows, source snippets, and one-line justifications are in [the post-fix review artifact](tiered-call-resolution-exact-caller-impact-review.json).

| Category                            |   Eligible | Reviewed |     TP |    FP | Unsure |                    Conservative TP rate |            Stratum uncertainty interval |   Weight |
| ----------------------------------- | ---------: | -------: | -----: | ----: | -----: | --------------------------------------: | --------------------------------------: | -------: |
| Anonymous callback / lexical parent |     21,718 |       29 |     29 |     0 |      0 |                                  100.0% |                 99% Wilson: 81.4–100.0% |   92.03% |
| Ambiguous spans                     |          0 |        0 |      0 |     0 |      0 |                                       — |                          Not applicable |    0.00% |
| Class ownership                     |          2 |        2 |      1 |     1 |      0 |                                   50.0% |                Exact census: 50.0–50.0% |    0.01% |
| Caller candidate                    |          0 |        0 |      0 |     0 |      0 |                                       — |                          Not applicable |    0.00% |
| Other                               |      1,880 |       29 |     21 |     8 |      0 |                                   72.4% |                  99% Wilson: 48.5–88.0% |    7.97% |
| **All reviewable additions**        | **23,600** |   **60** | **51** | **9** |  **0** | **97.8% population-weighted precision** | **95% stratified interval: 78.8–99.0%** | **100%** |

The weighted estimate is the sum of each category's reviewed TP rate (unsure counts as not-TP) times its share of eligible reviewable additions. The interval combines the weighted category bounds: each sampled stratum uses a 99% Wilson interval with Bonferroni correction across five categories; fully reviewed strata use exact census bounds; sampled strata use no finite-population correction. This gives a nominal 95% simultaneous interval. It assumes the deterministic seeded sample behaves like a within-category random sample and does not account for source-label or corpus bias. The 85.0% balanced sample result (51/60) is a **stratified stress score**, not population precision.

The 811 minified or vendored additions are excluded from source labels and counted separately: 500 callback/lexical-parent and 311 other. Thus all 24,411 additions are accounted for as 23,600 reviewable additions plus 811 bundle exclusions. Categories with at least 10 eligible additions need at least 10 reviewed labels; categories below 10 need exhaustive labels. The callback and `other` categories meet the coverage rule with 29 reviewed items each. Class ownership has two eligible additions and both were labeled; ambiguous spans and caller candidates have zero eligible additions after the self-entry fix. The small class-ownership stratum is reported but has no category floor.

### File-level blast radius and known recall gaps

Across the same 19,451 callees, v2 minus v1 distinct impacted-file deltas have median 0, nearest-rank p90 0, minimum -1,177, and maximum +75. This is a **file-level risk proxy**. Production risk uses the confirmed blast-radius entry count (excluding dynamic and caller-candidate rows) and each graph's actual `l2Nodes` count, matching `ImpactWorkflow` and `ImpactService.computeRiskLevelFromCounts`. Its v2-minus-v1 confirmed-entry delta has median 0, p90 3, minimum -1,176, and maximum +187.

| Risk numerator / transition | MEDIUM→MEDIUM | MEDIUM→HIGH | MEDIUM→CRITICAL | HIGH→MEDIUM | HIGH→HIGH | HIGH→CRITICAL | CRITICAL→MEDIUM | CRITICAL→HIGH | CRITICAL→CRITICAL |
| --------------------------- | ------------: | ----------: | --------------: | ----------: | --------: | ------------: | --------------: | ------------: | ----------------: |
| File-level proxy            |        19,285 |           2 |               5 |          38 |        83 |             0 |              30 |             0 |                 8 |
| Production risk             |        17,371 |       1,052 |              99 |          39 |       755 |            37 |              17 |             2 |                79 |

The file-level proxy has 30 CRITICAL→MEDIUM and 38 HIGH→MEDIUM transitions. The production-equivalent metric has 17 CRITICAL→MEDIUM and 39 HIGH→MEDIUM transitions. The distinction matters: these transitions use different numerators even though both use the product risk bands.

The five largest negative deltas are Onyx cases. In each, v1's broad name-based fallback includes many unrelated `get`, `set`, or `delete` calls, but source inspection also found a real caller among the v1-only files:

| Callee                                | File delta | V1-only files and source evidence                                                                                                                                                                                               | Assessment                                                                                                                                                                          |
| ------------------------------------- | ---------: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `_BrokenCache.get`                    |     -1,177 | 1,177 files, including `backend/onyx/server/manage/llm/provider_cache.py`; its `cache.get` call is exercised after the test patches `get_cache_backend` to `_BrokenCache`. `backend/alembic/env.py` is an unrelated name match. | Mixed: the provider call is a real monkeypatch-driven runtime caller, while most v1-only files are unrelated `get` matches. V2 also has a same-file `_FakeCache.get` misresolution. |
| `test_ingest_from_github.py#get@L370` |     -1,177 | 1,177 files, including `backend/onyx/utils/github.py`; its `ssrf_safe_get` call is exercised after the test patches that function to its local `get` callback.                                                                  | Mixed: the patched callback path is real; most v1-only files are unrelated `get` matches.                                                                                           |
| `TenantRedisPipeline.set`             |       -678 | 678 files, including `backend/tests/external_dependency_unit/redis/test_tenant_redis.py`, where `pipe` comes from `tenant_redis.pipeline()` and calls `pipe.set`.                                                               | Recall loss: v2 attributes the local call to `TenantRedisClient.set` and misses the test caller of the distinct pipeline wrapper.                                                   |
| `TenantRedisPipeline.delete`          |       -360 | 360 files, including `backend/tests/external_dependency_unit/redis/test_tenant_redis.py`, where the pipeline wrapper is called as `pipe.delete`.                                                                                | Recall loss: v2 attributes the local call to `TenantRedisClient.delete` and misses the pipeline test caller.                                                                        |
| `PersonaLabelManager.delete`          |       -360 | 360 files, including `backend/tests/integration/tests/personas/test_persona_categories.py`, which calls `PersonaLabelManager.delete`.                                                                                           | Recall loss: v2 adds the unrelated same-file `PersonaManager.delete` HTTP helper and misses the integration test caller.                                                            |

These examples are not losses from the bounded lexical-parent walk. The two monkeypatch cases depend on runtime substitution; the pipeline cases need receiver type flow through `pipeline()`; and the persona helper needs imported class-qualified method resolution. Reopening the broad same-name fallback would restore hundreds of unrelated files alongside those real callers. These file-level recall gaps are disclosed separately from the addition precision gate. They remain unaddressed in exact-v2 because the audit does not establish a narrow receiver-aware repair.

**Measured decision: FAIL. Keep `scope-resolver-v1` as the default; `exact-enclosing-v2` remains opt-in.** The population-weighted point estimate is 97.8%, but its 95% stratified lower bound is 78.8%, below the 90% gate; the `other` category also fails its 80% floor at 21/29 (72.4%). The 85.0% figure is the stratified stress score, not population precision. The eight false positives are same-name calls on a different receiver or to a different local binding: `this.client.execute`, DOM `focus()`, Python `ContextVar.reset()`, `Set.add()`, independent `_call_api` and `analyzeFileFull` methods, and `NoOpSpan.start()`. The class-ownership stratum has two fully reviewed rows (one TP, one FP); its 50.0% population rate is reported without applying the floor because the stratum is smaller than 10.

To reproduce the per-repository parity/recall audit, run the package script once for each corpus root:

```sh
pnpm run eval:exact-caller-impact-parity --root /path/to/repository --out /tmp/repository-parity.json --summary-out /tmp/repository-parity.md
```

For Onyx, add `--exclude-segment ee`. To regenerate the seeded sample from those JSON reports, pass each report with a repeated `--input`:

```sh
pnpm run eval:exact-caller-impact-sample --input /tmp/graft-parity.json --input /tmp/nest-parity.json --out /tmp/review.json --seed pr583-selfguard-final-20261008 --sample-size 60
```

Supply reviewed labels with `--labels-from /path/to/review.json`. The audit output calls membership comparisons parity/recall vs v1; the sample output reports the stratified stress score and population-weighted estimate separately. The weighted lower interval bound plus per-category floors, subject to the coverage rule, drives the default decision.

## Selecting the active policy

The product composition path (`registerCoreProviders`) constructs the graph persister with the active policy resolved from `DOCUVIA_CALLS_CALLER_POLICY` (`scope-resolver-v1`, `exact-enclosing-v1` or `exact-enclosing-v2`). Unset or blank means the `scope-resolver-v1` default; set `DOCUVIA_CALLS_CALLER_POLICY=exact-enclosing-v2` to opt into v2. An unknown value fails with `INVALID_INPUT` rather than silently falling back. `docuvia init` and `analyze` persist under the active policy, and `analyze` compares the stored policy with the active policy: a mismatch triggers one full rebuild before the SHA no-op path. This lets historical or explicitly selected exact-policy graphs migrate once while preserving the selected policy thereafter.

The completed full-init or full-rebuild workflow records its policy under the project-scoped `docuvia_meta` key `graph.calls-projection.caller-policy.v1:<projectId>`. This caller-policy stamp is separate from strict-proof source-index completeness: a skipped oversized or failed file can prevent strict proofs without making the persisted call edges fall back to legacy impact traversal. The workflow writes the stamp only after its full caller projection and path cleanup finish, so delta ingestion and a fresh init interpret the same stored calls consistently. Snapshot metadata carries a separately versioned `callsProjectionCallerPolicy` capability so hydration can restore the policy. Snapshots without a valid capability are treated as historical ScopeResolver graphs. `analyze` detects a policy mismatch before the SHA no-op path and performs a full graph rebuild. The generic metadata table and additive snapshot capability make a schema migration unnecessary.

V1 and v2 use the same uniform exact caller attribution for every `calls` edge. V2 adds lexical containment links and impact traversal. Strict proof scope, target selection, candidate generation, observations, and source content hash semantics remain unchanged.
