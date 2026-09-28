# Impact benchmark honesty — Phase 3 staleness and graph state-transition robustness

Source: [#508](https://github.com/dyphn1/Docuvia/issues/508) (Phase 3, plus the
"State-transition, freshness and partial-state robustness" follow-up comment).

Phase 3 asks two questions of `docuvia impact` across real repository and index
state changes:

1. After a **successful** re-ingest, are the reported dependents correct?
2. Is a **stale, partial, failed or in-flight** graph ever presented as a fresh,
   complete answer?

The Phase 0 invariant applies verbatim:

> UNKNOWN is acceptable when evidence is insufficient. A result must never
> convert missing, ambiguous, stale, bounded-candidate, or failed evidence into
> a confident "no impact" claim.

## Scope

Phase 3 adds:

- a pure transition/projection/gate module and its unit tests;
- a real-CLI state-transition corpus (compiled `dist/cli.js`) that mutates one
  sandbox repository through commits, renames, deletions, a HEAD rewind, a held
  knowledge lock and concurrent `analyze` runs, and observes `impact` before and
  after every re-ingest;
- read-only database stale-record invariants and a fresh-`init` oracle;
- product fixes for the defects the corpus confirms, each landed as
  doc → failing test → implementation.

Phase 3 does **not**:

- redefine any Phase 0 metric (`scoreImpactHonestyCase` /
  `aggregateImpactHonesty` are used unchanged), or change a Phase 0–2 contract,
  scorer, golden or gate;
- repair stale state by writing to the database behind the product path. The
  only write is the Phase 2 §3.3 Tier B coverage seed;
- use `analyze --escalate-to-lsp` (without a language server it prunes orphaned
  links and drains Tier C, which would make edge loss permanent and the corpus
  environment-dependent);
- treat an uncommitted working-tree edit as staleness (decision Q1 below).

## Decisions

| #   | Question                                                         | Decision                                                                                                                                                                                                                                                         |
| --- | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q1  | Does a dirty working tree make the graph stale?                  | **No.** Freshness is HEAD-sha only (PLAT-007, #193). The dirty-tree scenario O1 is recorded as an observation, not gated. Follow-up: [#523](https://github.com/dyphn1/Docuvia/issues/523).                                                                       |
| Q2  | D9 fix direction                                                 | **Correctness.** Tier A re-attaches incoming edges from files outside the re-parse batch by `node_key` during the per-file replace, and `deleteNodesForPath` removes incoming links so no dangling rows remain. Results are never merely marked uncertain.       |
| Q3  | Does `impact` emit `graphFreshness` when freshness is `unknown`? | **No.** `graphFreshness` is emitted only when the graph is stale and omitted otherwise (fail-open parity with #193 `status`). `unknown` (no git provider, unborn HEAD, missing meta) is a documented non-goal.                                                   |
| Q4  | Fix scope                                                        | **Split.** Fixed here: D8, D9, D6 + D11. Registered, not fixed: D10 → [#522](https://github.com/dyphn1/Docuvia/issues/522), D12 → [#521](https://github.com/dyphn1/Docuvia/issues/521). Their fixtures and goldens are kept unchanged and fail as known defects. |
| Q5  | CLI runner                                                       | Compiled `dist/cli.js` through `TestSandbox.runDistCli` and one `buildDistCli()` per suite.                                                                                                                                                                      |

## 1. Frozen executable definitions

### 1.1 Freshness (the only definition of stale/fresh in Phase 3)

Ground truth is `docuvia_meta.lastIngestedSourceSha` compared with
`git rev-parse HEAD`, both read **read-only** by the harness as facts. The
observed truth is the impact JSON.

```ts
// artifacts/cli/test/support/impact-honesty-transition.phase3.ts
type Phase3Freshness = "fresh" | "stale" | "error";
function projectFreshness(
  run: RawImpactRun,
): Phase3Freshness | "not-applicable" {
  if (projectResolution(run) !== "resolved") return "not-applicable"; // null / exit != 0
  const f = run.json!.graphFreshness;
  if (f === undefined) return "fresh";
  if (typeof f !== "object" || f === null) return "error";
  const { state, graphSourceSha, headSha } = f as Record<string, unknown>;
  if (state !== "stale") return "error"; // Q3: only "stale" is in contract
  if (
    !isSha40(graphSourceSha) ||
    !isSha40(headSha) ||
    graphSourceSha === headSha
  )
    return "error";
  if (run.json!.epistemic !== "lower-bound") return "error"; // stale may never be exact
  if (!(
    typeof run.json!.riskNote === "string" && run.json!.riskNote.length > 0
  ))
    return "error";
  return "stale";
}
```

- **fresh** = `graphFreshness` absent; the gate additionally requires the meta
  sha to equal HEAD at that checkpoint.
- **stale** = `graphFreshness.state === "stale"`, both shas 40-hex and
  different, `graphSourceSha` equal to the meta fact, `headSha` equal to the
  HEAD fact, `epistemic === "lower-bound"`, non-empty `riskNote`.
- Any other shape is `error` and fails closed (as Phase 2 P7).
- **User-visible parity:** human `impact` prints a `Note:` line exactly when the
  JSON has `riskNote`; `docuvia status`'s `Graph Freshness` row reads `stale`
  when the graph is stale and `fresh` when it is fresh.
- `not-found` (`null` JSON) carries no freshness field. It is Phase 0
  `not-found`, not a safety claim. Documented limit: a symbol added at HEAD but
  not yet ingested reads `not-found` on a stale graph.

### 1.2 Projections reused unchanged

- `projectResolution` / `projectEpistemic` (Phase 2 §1.1). A stale result is
  `lower-bound`, so it projects to `unknown`.
- Confirmed-file mapping and channel mapping (Phase 1/2): blast-radius names are
  mapped through `l2_nodes.path_patterns`, and the target's own containing-file
  row is removed. Channels are `static`, `lsp-fallback`, `dynamic-candidate`.
- The Phase 2 masking precondition is **replaced per checkpoint** by a golden
  `expectedCoverage: "complete" | "partial"`: `partialCoverage` must be absent
  where complete is expected and `true` where partial is expected. The mismatch
  reason is `coverage-mismatch` (error).

### 1.3 Phase 0 records per checkpoint (additive accounting, scorer unchanged)

Scenario id: `<transition>@<phase>:<target>#<intent>`, with phase one of
`before | after | afterTierA | failed | inflight`.

- **before / failed / inflight** (graph stale): one `#epistemic-unknown` record
  per observed target (`expectedStatus: "unknown"`). No `#confirmed-positive`
  against HEAD truth — a stale answer is expected to be incomplete. Its
  dependents are asserted by state-diff S7a instead.
- **after** (successful re-ingest, coverage seeded), HEAD truth:
  - target with confirmed dependents: `#confirmed-positive` with
    `expectedPredictions` (channel `static`) and `expectedTargetIdentity`, plus
    `#epistemic-unknown` when the golden expects lower-bound;
  - target with no confirmed dependent and no candidate: `#negative` +
    `#epistemic-unknown`;
  - dynamic target with candidates: `#candidate-boundary` + `#epistemic-unknown`;
  - removed symbol: `#not-found`.
- **afterTierA** (T1 only, before seeding): `#epistemic-unknown`, coverage
  expected partial.

An `after` target whose golden is exact must be observed exact; a lower-bound
observation there is an `unexpected status` (S0).

## 2. Fixture and transitions

### 2.1 Fixture tree S0

TypeScript under `src/p3/`, every symbol prefixed `evalP3`/`EvalP3`, no
`docuviaFactory`/`TOKENS.`, and no symbol name containing another observed
target name (so the `LIKE` fallback of `findNodeByName` cannot resolve a removed
symbol to a neighbor).

```
.gitignore                      -> .claude/ .cursor/ .continue/ .github/ .docuvia/ AGENTS.md .hermes.md  (hazard H2)
src/p3/core/target.ts           -> evalP3Target(); class EvalP3Base
src/p3/core/other.ts            -> evalP3Other()
src/p3/users/caller-a.ts        -> evalP3CallerA() calls evalP3Target
src/p3/users/caller-b.ts        -> evalP3CallerB() calls evalP3Target
src/p3/users/switcher.ts        -> evalP3Switch()  calls evalP3Target   (switches to evalP3Other in T4)
src/p3/users/grow.ts            -> evalP3Grow()    calls evalP3Target   (oversized in T10)
src/p3/users/sub.ts             -> class EvalP3Sub  extends EvalP3Base
src/p3/users/sub2.ts            -> class EvalP3Sub2 extends EvalP3Base
src/p3/dyn/loader.ts            -> evalP3Load(n) = import(`./plugins/${n}`)
src/p3/dyn/plugins/{alpha,beta,gamma}.ts
src/p3/ctrl/ctrl-target.ts + ctrl-user.ts -> evalP3CtrlTarget, static control, never mutated
```

Observed targets: `evalP3Target`, `EvalP3Base`, `evalP3Other` (until it is
removed in T11), `evalP3Alpha`, `evalP3CtrlTarget`. Coverage is seeded after
`init` and after every **successful** `analyze` (Phase 2 §3.3 justification
verbatim: it models a completed Tier B batch and writes coverage state only,
never edges). `afterTierA` is observed before seeding. Nothing is seeded after a
failed `analyze`.

Every harness commit disables hooks (`core.hooksPath` pointed at an empty
directory, hazard H1), pins `GIT_AUTHOR_DATE`/`GIT_COMMITTER_DATE` and a fixed
identity, and stages only `src/p3` (plus `.gitignore` in S0), so commit SHAs are
identical across runs.

Stale, partial, failed and in-flight states are induced only through real
product paths:

- **stale** = commit and do not run `analyze`;
- **failed** = hold `.git/docuvia-knowledge.lock` (the artifact a concurrent
  writer leaves), then `analyze` times out after
  `KNOWLEDGE_LOCK_MAX_WAIT_MS = 10_000` with exit 1;
- **in-flight** = hold the lock, start `analyze` in the background, observe;
- **partial** = Tier B pending after a delta that adds a file (the product's
  own coverage state), and a newly oversized file (T10).

Parse-failure-induced partial ingestion is **not** fixtured: tree-sitter is
error-tolerant, so no deterministic product path produces an `AstParseFailure`.
Suspected, not gated: the delta stamps `lastIngestedSourceSha` even when
`filesFailed > 0`.

### 2.2 Transition table

Execution order is the table order. T10 and T12 run last because their defects
(D10, D12) are registered rather than fixed in this phase; running them earlier
would carry their stale rows into every later checkpoint and blur which defect a
failure belongs to.

"Before" means: after the commit, before re-ingest. Every before checkpoint
expects `stale` + `lower-bound` for every target and dependents equal to the
previous fresh checkpoint (S1, S3, S7a, S13), so the column lists only what is
transition-specific. `conf` = confirmed files (static), `cand` = dynamic
candidate files, `ex` = exact, `lb` = lower-bound.

| ID                | Mutation (one commit)                                                                                                      | Re-ingest                                                                         | Expected after (fresh)                                                                                                                            | Must disappear                                      | Oracle |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- | ------ |
| **T0**            | S0                                                                                                                         | `init`                                                                            | Target conf={a, b, switcher, grow} ex; Base conf={sub, sub2} ex; Other UNKNOWN/lb; Alpha cand=[loader], bounded [alpha, beta, gamma], lb; Ctrl ex | —                                                   | yes    |
| **T1**            | add `users/caller-c.ts` calling `evalP3Target`                                                                             | `analyze`                                                                         | **afterTierA**: caller-c present, `partialCoverage: true`, lb. **after** (seeded): Target conf += caller-c, ex                                    | —                                                   | yes    |
| **T2**            | edit `target.ts` (body + comment, non-contract)                                                                            | `analyze`                                                                         | Target conf={a, b, c, switcher, grow} all static ex; Base conf={sub, sub2} static ex                                                              | 0 dangling links (R1)                               | yes    |
| **T3**            | edit `target.ts` again **and** `sub2.ts`                                                                                   | `analyze`                                                                         | Base conf={sub, sub2} static ex                                                                                                                   | R1                                                  | —      |
| **T4**            | `switcher.ts` calls `evalP3Other` instead                                                                                  | `analyze`                                                                         | Target removed {switcher}; Other conf={switcher} ex                                                                                               | switcher under Target                               | yes    |
| **T5**            | `git mv users/caller-b.ts users/caller-b-renamed.ts`                                                                       | `analyze`                                                                         | Target conf has caller-b-renamed, not caller-b                                                                                                    | `caller-b.ts` in output and records (R2–R4)         | —      |
| **T6**            | delete `users/caller-a.ts`                                                                                                 | `analyze`                                                                         | Target removed {caller-a}                                                                                                                         | `caller-a.ts` in output and records                 | yes    |
| **T7**            | `git mv core/target.ts core/target-moved.ts` + update every importer                                                       | `analyze`                                                                         | identity `core/target-moved.ts#…`; conf unchanged, static ex (Target and Base)                                                                    | old path in identity, output, records; 0 dangling   | yes    |
| **T8**            | delete `dyn/plugins/beta.ts`                                                                                               | `analyze`                                                                         | Alpha candidatePaths=[alpha, gamma], cand=[loader], lb                                                                                            | `beta.ts` in candidatePaths and records (R4, R5)    | —      |
| **T9**            | delete `dyn/loader.ts`                                                                                                     | `analyze`                                                                         | Alpha conf=[], cand=[], **no dynamicEvidence**, UNKNOWN/lb                                                                                        | loader evidence record and `loader.ts` records      | —      |
| **T11**           | remove `evalP3Other`; switcher calls a new local helper                                                                    | `analyze`                                                                         | `impact evalP3Other` → `null` (Phase 0 `not-found`, exit 0)                                                                                       | the switcher edge; 0 dangling                       | yes    |
| **F1**            | hold lock; add `users/caller-d.ts`                                                                                         | `analyze` **fails** (exit 1, lock timeout)                                        | **failed**: meta sha unchanged, stale + lb, caller-d missing. Release, `analyze` → **after**: conf += caller-d ex                                 | —                                                   | —      |
| **I1**            | hold lock; add `users/caller-e.ts`; background `analyze`                                                                   | in flight → release → await → follow-up                                           | **inflight** (lock held): stale + lb, caller-e missing. **after**: conf += caller-e ex                                                            | —                                                   | yes    |
| **R1**            | (a) `analyze` twice; (b) `commit --allow-empty` + `analyze`; (c) 3× edit `target-moved.ts` + `analyze`, revert + `analyze` | `analyze` each time                                                               | S11: store facts and raw stdout after every step equal the pre-R1 reference; dangling = 0                                                         | any growth in counts                                | —      |
| **C1** `[stress]` | add `users/caller-f.ts`; two concurrent `analyze` processes                                                                | concurrent, then one sequential `analyze`                                         | converges to the oracle; individual exit codes recorded, not gated (#480 owns SQLite contention)                                                  | —                                                   | yes    |
| **O1**            | uncommitted `users/caller-g.ts` (observation only)                                                                         | none                                                                              | recorded: `status` fresh, impact without caller-g (PLAT-007 limit, [#523](https://github.com/dyphn1/Docuvia/issues/523))                          | —                                                   | —      |
| **T10**           | `grow.ts`: remove the call and pad past 512,000 bytes                                                                      | `analyze`                                                                         | Target removed {grow}; oracle agrees (`init` never ingests oversized files)                                                                       | `grow.ts` l2 nodes and edges (R2)                   | yes    |
| **T12**           | `git reset --hard <T6 commit>`                                                                                             | `analyze` (full-ingestion fallback; `analyze.delta.head_not_descendant` asserted) | every target equals the golden for the T6 tree                                                                                                    | paths absent from the T6 tree in output and records | yes    |

The harness captures per transition: HEAD sha, meta sha, freshness projection,
`status` row, dependents/candidates/evidence/epistemic state before and after,
the operation result (exit code, analyze log event names, `delta.summary`
counts), the `mustDisappear` outcome, and the user-visible note. Every
transition feeds Phase 0 records, so all of them are in the benchmark
denominators.

## 3. Stale-record invariants (read-only store facts, S6)

`readStoreFacts` opens `local.db` read-only and checks, against the HEAD tree
(`git ls-files` at HEAD minus files over `MAX_FILE_SIZE_BYTES`):

- **R1** dangling `node_links` (source or target id missing) = 0;
- **R2** every `l2_nodes.path_patterns` path is in the HEAD tree;
- **R3** every `ast_call_sites.file_path` is in the HEAD tree;
- **R4** every `project_files.file_path` is in the HEAD tree;
- **R5** every `impact.dynamic-dependencies.v1:<projectId>` record's
  `sourceFile` and every `candidatePaths[]` entry is in the HEAD tree;
- counts (for S11): l2_nodes, node_links, ast_call_sites, project_files,
  evidence records.

Reading is observation, not repair. No test writes these tables.

## 4. Gates

`assertPhase3ImpactHonestyGates` throws with a distinct message per gate. No
blended score is produced. Violations are reported in the order below, so a
poisoned control fails its **named** gate before a generic one. S7 and S11 run
before S6 because store facts are checkpoint-wide: a poison aimed at one
target's state-diff or at accumulation must not be masked by a stale record
elsewhere in the same store.

| Gate | Condition                                                                                                                                                                                                                                | Regex                                             |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| S0   | Phase 0 `errorCases === 0`, no `coverage-mismatch`, freshness projection never `error` (checked first); every record `statusCorrect` and every exact golden observed exact (checked last)                                                | `/errored\|unexpected status\|coverage-mismatch/` |
| S9   | Ingestion failure: the failed operation's exit code is non-zero, meta sha unchanged, post-failure observations `stale` + `unknown`; the failed checkpoint stays a counted row                                                            | `/ingestion failure/`                             |
| S2   | Phase 0 epistemic `falseSafeRate === 0` over all Phase 3 epistemic records, which number at least 25 at corpus level                                                                                                                     | `/false-safe/`                                    |
| S3   | `wrongCertaintyCases === 0`                                                                                                                                                                                                              | `/wrong-certainty/`                               |
| S4   | **Incomplete certainty = 0** (additive metric): every `after` confirmed-positive record whose epistemic projection is `resolved` has Phase 0 `fn === 0`                                                                                  | `/incomplete-certainty/`                          |
| S5   | **Stale edge**: after every successful re-ingest no `mustDisappear` path (declared per target; `*` = every target) appears in confirmed files, candidate files, `dynamicEvidence[].sourceFile`, `candidatePaths`, or the target identity | `/stale edge/`                                    |
| S7   | **State-diff**: (a) a stale checkpoint's confirmed and candidate sets equal the previous fresh checkpoint's; (b) after − previous and previous − after equal the golden difference exactly                                               | `/state-diff/`                                    |
| S11  | **Accumulation**: every R1 step leaves store counts and raw stdout identical to the reference, dangling = 0                                                                                                                              | `/accumulation/`                                  |
| S6   | **Stale record**: store facts satisfy R1–R5 after every successful re-ingest                                                                                                                                                             | `/stale record/`                                  |
| S1   | Every checkpoint's freshness equals its golden, shas equal the facts, human `Note:` and `status` parity hold; at corpus level at least 8 stale observations                                                                              | `/freshness/`                                     |
| S8   | **Oracle**: at every oracle checkpoint the normalized impact JSON per target equals a fresh `init` + seed of the same tree                                                                                                               | `/oracle/`                                        |
| S10  | `after` confirmed-positive P/R/F1 = 1; provenance mismatches = 0 with `checked ≥` the golden count; candidate-boundary coverage = 1; `dynamicEvidence` records equal the golden (no stale or missing candidate)                          | `/positive\|provenance/`                          |
| S12  | **Determinism**: two complete runs from fresh sandboxes produce identical normalized records, raw JSON stdout, store facts and analyze event names per operation                                                                         | `/determinism/`                                   |
| S13  | Calibration: `evalP3CtrlTarget` is fresh + exact + static at every `after`, and stale at every `before`                                                                                                                                  | `/calibration/`                                   |

S12 exclusions: log timestamps and operation wall time; the I1 background
`analyze` (exit code and events depend on timing); and the C1 concurrent
`analyze` pair (#480). The follow-up sequential `analyze` in both makes the end
state deterministic, and that end state is compared.

## 5. Poisoned controls

Applied to observations or raw JSON **before** projection. Each must throw its
gate; the unpoisoned target passes every gate.

| Control | Mutation                                                                                                                                | Must fail                          |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| Q1      | T6-after Target: add a `blastRadius` entry `evalP3CallerA` mapped to `caller-a.ts`                                                      | S5 `/stale edge/` (also S10, S7)   |
| Q2      | T1-before Target: `blastRadius = [own file row]`, `riskLevel: "LOW"`, no `epistemic`/`riskNote`/`graphFreshness`                        | S2 `/false-safe/` (also S1)        |
| Q3      | F1 failed: operation exit code 0 and Target replaced by an exact empty `LOW` result without `graphFreshness`                            | S9 `/ingestion failure/` (also S2) |
| Q4      | T1-before Target: delete `graphFreshness`, `epistemic`, `riskNote`                                                                      | S3 `/wrong-certainty/` (also S1)   |
| Q5      | T3-after Base: drop the `EvalP3Sub` entry, keep exact                                                                                   | S4 `/incomplete-certainty/`        |
| Q6      | T6-after facts: add `caller-a.ts` to `project_files` and set dangling = 1                                                               | S6 `/stale record/`                |
| Q7      | run 2: alter one byte of T4-after Other raw stdout                                                                                      | S12 `/determinism/`                |
| Q8      | R1 step facts: node_links + 1                                                                                                           | S11 `/accumulation/`               |
| Q9      | T4-after Other: drop the switcher entry and mark the result lower-bound (so the defect is only the missing edge, not a certainty claim) | S7 `/state-diff/` (also S10)       |
| Q10     | T1-before Target: `graphFreshness.state = "fresh"`                                                                                      | S0 (projection `error`)            |

## 6. Determinism, lanes and markers

- Two complete runs, each in a new sandbox from S0, with pinned commit dates and
  a fixed identity, so raw stdout (including the shas in a stale `riskNote`) must
  be byte-identical.
- Hazards: H1 hooks disabled on every harness commit, and the corpus asserts
  that `.docuvia/logs/post-commit-hook.log` never appears; H2 `.gitignore`
  excludes the files `init` generates; H3 `--escalate-to-lsp` is never used.
- Lanes: utility tier `artifacts/cli/test/support/impact-honesty-transition.phase3.unit.test.ts`;
  persistence tier `artifacts/cli/test/integration/commands/impact-honesty.phase3.integration.test.ts`;
  product unit/repo tests next to each fix.
- All five #263 markers (`[happy]`, `[invalid-input]`, `[error-handling]`,
  `[stress]`, `[state-diff]`) plus `[negative-control]`.
- TDD sources: issue #508 Phase 3; this document; the Phase 0 and Phase 2
  contracts; issue #193; issue #480 (C1); PLAT-007;
  `docs/gitbook/architecture/testing-and-quality-architecture.md`;
  `docs/gitbook/guidelines/phase-based-test-quality-hardening.md`.

## 7. Product defects

Classification follows the issue: a checkpoint that exposes a product defect
keeps its golden expectation and is classified `PRODUCT_DEFECT`; the defect is
then fixed (doc → failing test → implementation) or registered with a child
issue (§8).

Predicted during planning on the shipped CLI at `143ff12e`; the verdicts are
recorded from the corpus before any product change.

| ID      | Predicted defect                                                                                                                                                                                                                                                | Checkpoints                  | Plan |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- | ---- |
| **D8**  | `impact` has no freshness signal: `ImpactWorkflow` never reads `lastIngestedSourceSha`, so an un-ingested HEAD returns an exact answer from the old graph while `status` says stale.                                                                            | every before/failed/inflight | fix  |
| **D9**  | A Tier A re-parse of a depended-on file orphans every incoming edge from unchanged files: `deleteNodesForPath` deletes only outgoing links and the file is re-inserted with new ids. `extends` dependents vanish; `calls` dependents degrade to `lsp-fallback`. | T2, T3, T7, R1               | fix  |
| **D6**  | A deleted candidate stays in `candidatePaths`, and a deleted loader leaves a phantom evidence record: `project_files` rows are never deleted, and evidence is refreshed only by batches that parse files.                                                       | T8, T9                       | fix  |
| **D11** | `ast_call_sites` and `project_files` rows of deleted or renamed paths outlive their files (`persistDelta` only calls `deleteNodesForPath`).                                                                                                                     | T5, T6, T7                   | fix  |
| **D10** | A dependent that grows past `MAX_FILE_SIZE_BYTES` in a delta is skipped, but its old rows and edges stay while `lastIngestedSourceSha` moves to HEAD.                                                                                                           | T10                          | #522 |
| **D12** | The full-ingestion fallback (HEAD rewound, `delta.head_not_descendant`) hash-skips files over lingering `project_files` rows and never prunes vanished paths: phantom and missing dependents, reported exact.                                                   | T12                          | #521 |

### Verdicts (real CLI, before any product change)

Recorded by running the corpus against the compiled CLI at `143ff12e` plus the
Phase 3 harness only. No golden was altered by the run.

| ID      | Verdict       | Evidence (checkpoint: observation)                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **D8**  | **Confirmed** | Every before/failed/inflight checkpoint (T1…T12, F1, I1, R1b, R1c\*, C1): impact had no freshness field and non-empty targets were **exact** (S3 wrong-certainty, 3 per checkpoint) while `status` read `stale`. `evalP3CtrlTarget` could never be observed stale (S13).                                                                                                                                                                                                                     |
| **D9**  | **Confirmed** | T2: 7 dangling `node_links`; `EvalP3Base` lost both subclasses (UNKNOWN), `evalP3Target` callers fell back to `lsp-fallback` (5 provenance mismatches). T3: `EvalP3Base` **exact** with only `sub2.ts` (S4). T5 (stronger than predicted): after the rename, `evalP3Target` was **exact** with only `caller-b-renamed.ts`, silently missing `caller-c.ts` and `grow.ts` (S4). R1: every step kept 7 dangling rows (S11); the count did not grow across cycles, but the rows never went away. |
| **D11** | **Confirmed** | T5: `ast_call_sites` and `project_files` rows for `caller-b.ts` survive (R3, R4); T6: likewise for `caller-a.ts`; T7: the `project_files` row for `core/target.ts` survives (R4).                                                                                                                                                                                                                                                                                                            |
| **D6**  | **Confirmed** | T8: `beta.ts` still in the loader's `candidatePaths` (S5, R5). T9: the deleted loader's evidence record remains and `loader.ts` is still surfaced as a `dynamic-candidate` of `evalP3Alpha` (S5, R4, R5).                                                                                                                                                                                                                                                                                    |
| **D10** | **Confirmed** | T10: after `grow.ts` grew past 512,000 bytes (`delta.summary.filesSkippedOversized = 1`), its `l2_nodes` and `ast_call_sites` rows remain (R2, R3) while `lastIngestedSourceSha` moved to HEAD.                                                                                                                                                                                                                                                                                              |
| **D12** | **Confirmed** | T12 (`analyze.delta.head_not_descendant` emitted): phantom `core/target-moved.ts` nodes and a phantom `caller-f.ts` dependent (S5, R2), `grow.ts` and the restored `loader.ts` candidate missing (S7, S10), oracle mismatch for every changed target.                                                                                                                                                                                                                                        |

Unaffected before any fix: T0 (baseline equals the oracle), T1 `afterTierA`
(partial coverage through the product's own Tier B state), T1 `after`, the T11
`not-found` result, F1's operation facts (exit 1 with `analyze.auto.error`, meta
sha unchanged), I1's in-flight graph, the concurrent-read `[stress]` pass, C1's
two concurrent `analyze` runs (both exit 0), and S12 determinism across two
clean runs. Q1 and Q6 cannot be demonstrated on the real corpus while D9 holds:
the poisoned `T6@after` target already fails S4, so their tests are tagged as
masked by D9.

### Resolution

Each fixed defect lands in its own commit (doc → the failing test already
committed as `it.fails` → implementation → flip).

- **D8 — fixed.** `resolveGraphFreshness(workspaceRoot, store)`
  (`lib/ui-core/src/utils/resolve-graph-freshness.ts`) is extracted from
  `StatusWorkflow` (whose output is unchanged) and shared with `ImpactWorkflow`.
  `ImpactResult.graphFreshness: { state: "stale", graphSourceSha, headSha }` is
  additive and emitted only when stale (Q3). A stale graph is the first rung of
  `resolveImpactEpistemic`, for empty and non-empty results alike: `lower-bound`
  with `RISK_NOTE_GRAPH_STALE` naming both short shas; empty results stay
  `UNKNOWN` and non-empty ones keep the earned band. The human `Note:` line
  already prints `riskNote`, and the MCP `docuvia_impact` description mentions
  `graphFreshness`.

- **D9 — fixed (Q2: correctness).** `IGraphNodesRepo.getExternalIncomingLinks(filePaths)`
  returns incoming links (`contains` excluded) into a batch's nodes whose source
  lives outside the batch, found through the `node_key` index and
  `node_links.target_node_id`'s index (no `l2_nodes` scan). `GraphPersisterService`
  captures them before the per-file replace and re-inserts each one whose
  `node_key` still resolves after the insert and linking passes, in the same
  transaction; an edge into a removed or renamed symbol is dropped.
  `deleteNodesForPath` now deletes incoming links too (its interface doc is
  updated), so no dangling row remains. PLAT-007 carries a dated update. The
  schema test that simulated a dangling row through `deleteNodesForPath`
  encoded the defect and now writes the legacy row directly.

Observations, not gated: **O1** dirty working tree (#523); **H2** Docuvia's own
generated hook scripts are ingested by the full-ingestion fallback when not
ignored ([#524](https://github.com/dyphn1/Docuvia/issues/524)); the Phase 2 D5
knowledge-branch round trip stays with
[#516](https://github.com/dyphn1/Docuvia/issues/516).

## 8. Registered product defects

A registered checkpoint keeps its golden. The integration test asserts that the
gates still fail for exactly the registered checkpoints, so a product fix forces
the registry entry's removal.

| Checkpoint  | Defect | Child issue                                          |
| ----------- | ------ | ---------------------------------------------------- |
| `T10@after` | D10    | [#522](https://github.com/dyphn1/Docuvia/issues/522) |
| `T12@after` | D12    | [#521](https://github.com/dyphn1/Docuvia/issues/521) |

## 9. Exit gate

Phase 3 is complete when S0–S13 pass on real CLI output in two clean runs for
every non-registered checkpoint, Q1–Q10 each fail their named gate while the
unpoisoned controls pass, every transition asserts dependents **and**
freshness/epistemic state, false-safe = wrong-certainty = incomplete-certainty
= 0, removed or renamed dependencies, candidates and evidence do not survive a
re-ingest, repeated ingestion does not accumulate, every confirmed defect is
fixed failing-first or registered with a child issue, the Phase 0–2 contracts
and suites are unchanged and green, and full CI is green.
