# Impact benchmark honesty — Phase 2 epistemic and dynamic-boundary corpus

Source: [#508](https://github.com/dyphn1/Docuvia/issues/508).

Phase 2 turns the Phase 0 epistemic and candidate-boundary slices into an
end-to-end benchmark against the shipped `docuvia impact <target>` path. It
asks one question of every fixture: when the analyzer cannot fully see a
dependency surface, does it still say so?

The Phase 0 invariant applies verbatim:

> UNKNOWN is acceptable when evidence is insufficient. A result must never
> convert missing, ambiguous, stale, bounded-candidate, or failed evidence into
> a confident "no impact" claim.

## Scope

Phase 2 adds:

- a pure projection/observation/gate module and its unit tests;
- a real-CLI corpus of dynamic-boundary fixtures (bounded, overflow,
  unbounded, unresolved receiver, computed member, NodeNext specifier);
- production-path degradation scenarios (stale candidate universe,
  snapshot/clean/auto-hydrate) and one justified corrupted-artifact scenario;
- product fixes for defects the corpus exposes, each landed as
  doc → failing test → implementation.

Phase 2 does **not**:

- redefine any Phase 0 metric (`scoreImpactHonestyCase` /
  `aggregateImpactHonesty` are used unchanged);
- modify the Phase 0/1 contracts, the Phase 1 corpus behavior, or the Phase 6
  eval;
- relax a golden expectation to match current output. Golden truth describes
  intended behavior.

## 1. Frozen executable definitions

### 1.1 Two projections over one real CLI result (additive to Phase 0)

Phase 0 gives each case a single `observedStatus`. Phase 1 used the
**resolution projection** (object → `resolved`) and ignored the epistemic
fields. Phase 2 asks two different questions of the same JSON:

- "which dependents and candidates were surfaced, and through which channel?"
  (`confirmed-positive`, `negative`, `candidate-boundary`, `not-found`
  intents), and
- "did the analyzer claim a complete answer?" (`epistemic-unknown` intent).

Each Phase 2 fixture therefore emits **one Phase 0 case record per asserted
intent**, with scenario id `<fixture>#<intent>`. Each record's
`observedStatus` comes from the projection frozen for that intent. The Phase 0
scorer is used **unchanged**.

Rejected alternative: apply one epistemic projection to all records. That
makes the Phase 0 `candidate-boundary` slice unreachable. Any result that
carries dynamic evidence is `lower-bound`, so it could never be observed as
`resolved`, which is the only status for which Phase 0 computes candidate
coverage.

```ts
// artifacts/cli/test/support/impact-honesty-epistemic.phase2.ts  (pure, unit-tested)

/** Resolution projection — identical to Phase 1's runImpact() mapping. */
function projectResolution(
  run: RawImpactRun,
): "resolved" | "not-found" | "error" {
  if (run.exitCode !== 0) return "error";
  if (run.parseError) return "error";
  if (run.json === null) return "not-found";
  return "resolved";
}

/** Epistemic projection — FROZEN false-safe observation contract (Phase 2). */
function projectEpistemic(
  run: RawImpactRun,
): "resolved" | "unknown" | "not-found" | "error" {
  const base = projectResolution(run);
  if (base !== "resolved") return base;
  const { riskLevel, epistemic, riskNote } = run.json!;
  // fail closed on any shape outside the documented contract
  if (!["LOW", "MEDIUM", "HIGH", "CRITICAL", "UNKNOWN"].includes(riskLevel))
    return "error";
  if (epistemic !== undefined && epistemic !== "lower-bound") return "error";
  if (riskLevel === "UNKNOWN" && epistemic !== "lower-bound") return "error"; // #192 invariant
  if (
    epistemic === "lower-bound" &&
    !(typeof riskNote === "string" && riskNote.length > 0)
  )
    return "error";
  return epistemic === "lower-bound" || riskLevel === "UNKNOWN"
    ? "unknown"
    : "resolved";
}
```

**Confirmed files** (same as Phase 1): map each `blastRadius[]` entry to files
via `l2_nodes.path_patterns`. Remove the selected target's containing-file
context entry, identified through Phase 1's `node_key` fingerprint. Channel
mapping: `edgeSource` absent → `static`, `"lsp-fallback"` → `lsp-fallback`,
`"dynamic-candidate"` → `dynamic-candidate`. Any other value is a harness
`error`. Confirmed = `static ∪ lsp-fallback` (Phase 0 `CONFIRMED_CHANNELS`).

**False-safe (Phase 0 verbatim, now bound to real output):** an
`epistemic-unknown` record with `projectEpistemic(run) === "resolved"` **and**
zero confirmed files. In JSON terms: `epistemic` is absent and
`riskLevel ∈ {LOW, MEDIUM, HIGH, CRITICAL}`, while no static or lsp-fallback
dependent was returned. That is a "verified zero-impact" claim.

**Wrong certainty (Phase 0 verbatim):** the same condition with one or more
confirmed files. Phase 2 **gates this at 0 too**. This is the realistic
failure mode, because the product structurally never emits exact with zero
confirmed dependents.

**Precondition (masking guard):** every Phase 2 JSON result must have
`partialCoverage` absent. Otherwise the case is recorded as `error` with reason
`coverage-masked`, and gate G1 fails.

### 1.2 Evidence-layer observation (additive)

For each fixture, `observeEvidence(run, targetFile, golden)` produces:

```ts
interface Phase2EvidenceObservation {
  records: Array<{
    sourceFile: string;
    status: "bounded" | "unresolved";
    reason: string;
    candidatePaths: string[] /* sorted */;
    overflow: boolean;
  }>;
  goldInCandidateSet: boolean | null; // targetFile ∈ ∪ bounded.candidatePaths; null if no bounded record
  candidateSetSize: number | null; // bounded: |candidatePaths| (max over records); overflow/none: null
  unrelatedAdmitted: string[]; // ∪ bounded.candidatePaths − golden.expectedCandidatePaths
  truncatedOrOverflow: boolean; // any record with reason === `candidate-set-exceeds-${64}`
  evidenceUnavailable: boolean; // explicit D1/D5 state (`dynamicEvidenceUnavailable` present)
}
```

- `overflow` is derived from `reason === "candidate-set-exceeds-64"`. The
  harness holds `PHASE2_MAX_BOUNDED_CANDIDATES = 64` as a test-side constant
  tied by comment to the product's `MAX_BOUNDED_CANDIDATES`; the product
  constant is not exported or changed.
- A bounded candidate set that contains gold is reported through
  `goldInCandidateSet`. It **never** contributes a confirmed true positive.
  This is enforced twice: by Phase 0 channel semantics and by gate G6.
- The true candidate count of an overflowed set is not persisted by the
  product, so `candidateSetSize` is `null` for overflow. This is a documented
  limit, not a defect.

## 2. Fixture corpus

All fixtures are TypeScript under `src/p2/…` in `TestSandbox` sandboxes. Every
symbol name is unique and starts with `evalP2`. No fixture contains
`docuviaFactory` or `TOKENS.` (which would trigger the registry-mediated note),
and loaders never call a plugin symbol by name (which would create
`lsp-fallback` noise).

### 2.1 Sandbox isolation

| Sandbox                          | Why separate                                                                                                                | Fixtures                                   |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| **A — epistemic corpus**         | Normal, mutually non-interfering prefixes                                                                                   | E1a, E1b, E2, E3, E4a, E4b, E6, E7, E8, E9 |
| **B — unbounded**                | An unbounded `import(x)` is target-agnostic and would make **every** target in A `lower-bound`, including the exact control | E5a, E5b                                   |
| **C — degradation (state-diff)** | Mutates repo or DB state sequentially                                                                                       | C0, C1a, C1b, C2a/b/c, C3                  |

### 2.2 Per-fixture golden table

| ID                                              | Intent / what it proves                                                                            | Target                             | Expected status                                                                                       | Expected provenance / candidate set                                                                                                                                                             |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **E1a** bounded-single (template)               | A one-candidate bounded runtime import stays a candidate, never a confirmed edge.                  | `evalP2SingleOnly`                 | epistemic **unknown** (UNKNOWN, lower-bound)                                                          | bounded `bounded-local-pattern`, candidatePaths = [`single/plugins/only.ts`]; cand = [loader]; conf = []                                                                                        |
| **E1b** bounded-single (literal)                | Literal `import("./x")` is bounded evidence, not a static edge.                                    | `evalP2LiteralOnly`                | epistemic unknown                                                                                     | bounded `literal-dynamic-import`, candidatePaths = [only.ts]; cand = [loader]; conf = []                                                                                                        |
| **E2** bounded-multi + static caller            | A candidate containing gold is not a TP; a static dependent stays static; decoys are not admitted. | `evalP2MultiAlpha`                 | positive **resolved** P/R/F1 = 1; epistemic **unknown**                                               | conf = [`multi/direct-user.ts`] static; cand = [loader]; bounded candidatePaths = [alpha, beta, gamma]; unrelated = [] (`plugins-extra/delta.ts`, `plugins/README.md`, `sibling.ts` are decoys) |
| **E3** boundary-64                              | The maximum bounded size stays bounded.                                                            | `evalP2B64P63`                     | epistemic unknown                                                                                     | bounded, exactly the 64 files; size 64; cand = [loader]; overflow = false                                                                                                                       |
| **E4a** overflow-65 (zero callers)              | One over the limit takes the overflow path and is never verified zero-impact.                      | `evalP2O65P64`                     | epistemic **unknown**                                                                                 | unresolved `candidate-set-exceeds-64`, candidatePaths = []; cand = []; conf = []; size = null                                                                                                   |
| **E4b** overflow-65 + static caller             | Overflow keeps a non-empty result lower-bound.                                                     | `evalP2O65P00`                     | positive resolved; epistemic **unknown**                                                              | overflow record as E4a; cand = []                                                                                                                                                               |
| **E5a** unbounded (zero callers)                | Unbounded runtime import → UNKNOWN, never verified zero.                                           | `evalP2UnbTarget`                  | epistemic unknown                                                                                     | unresolved `unbounded-runtime-expression`, candidatePaths = []                                                                                                                                  |
| **E5b** unbounded + static caller               | Unbounded evidence keeps a non-empty result lower-bound.                                           | `evalP2UnbTarget2`                 | positive resolved; epistemic unknown                                                                  | unbounded record present                                                                                                                                                                        |
| **E6** unresolved receiver                      | A member call recovered by name is labeled `lsp-fallback`, **not** `static`.                       | `evalP2RecvTarget`                 | positive resolved (conf = [untyped-caller] via lsp-fallback); epistemic level **recorded, not gated** | expectedPredictions = [{untyped-caller, lsp-fallback}]                                                                                                                                          |
| **E7** computed member call                     | A computed call is never fabricated into a static edge, and the result is not verified-zero.       | `evalP2ComputedTarget`             | epistemic **unknown**                                                                                 | if surfaced, `computed-caller.ts` must be `lsp-fallback`, never `static`                                                                                                                        |
| **E8** static control (calibration)             | Non-vacuity: the epistemic projection **can** observe `resolved`.                                  | `evalP2StaticTarget`               | positive resolved; epistemic projection = **resolved (exact)**                                        | conf = [`ctrl/user.ts`] static; no `dynamicEvidence`, `epistemic`, `riskNote`                                                                                                                   |
| **E9** NodeNext `.js` specifier + static caller | ``import(`./plugins/${n}.js`)`` against `plugins/*.ts`.                                            | `evalP2NnOne`                      | epistemic **unknown**; positive resolved                                                              | bounded candidatePaths = [`nn/plugins/one.ts`]; cand = [loader]                                                                                                                                 |
| **C0** degradation baseline                     | Reference state before degradation.                                                                | `evalP2DegAlpha`, `evalP2Deg64P00` | both epistemic unknown                                                                                | bounded [alpha, beta] and bounded(64)                                                                                                                                                           |
| **C1a** stale universe (production path)        | Adding a candidate file without touching the loader must not create certainty.                     | `evalP2DegGamma`                   | epistemic **unknown**                                                                                 | bounded [alpha, beta, gamma]; cand = [`deg/loader.ts`]                                                                                                                                          |
| **C1b** stale universe crossing 64 → 65         | Incremental growth past the limit must take the overflow path.                                     | `evalP2Deg64P00`, `evalP2Deg64P64` | both epistemic unknown                                                                                | unresolved `candidate-set-exceeds-64`, candidatePaths = [], cand = []                                                                                                                           |
| **C2a/b/c** corrupted evidence artifact         | Corrupted evidence degrades to an explicit uncertainty state.                                      | `evalP2DegAlpha`                   | epistemic **unknown**, exit 0, explicit evidence-unavailable reason                                   | conf = [direct-user] static; cand = [] acceptable; **must not** be exact                                                                                                                        |
| **C3** snapshot → clean → auto-hydrate          | The evidence artifact is missing after a supported round trip.                                     | `evalP2DegAlpha`                   | epistemic **unknown** with explicit evidence-unavailable reason                                       | as C2                                                                                                                                                                                           |

Phase 0 case records per fixture:

- E2, E4b, E5b, E9, C\*: `#confirmed-positive` + `#epistemic-unknown`.
- E2 additionally: `#candidate-boundary` (expectedCandidateFiles = [loader]).
- E1a, E1b, E3: `#candidate-boundary` + `#epistemic-unknown`.
- E4a, E5a, E7: `#epistemic-unknown` only.
- E6: `#confirmed-positive` with `expectedPredictions` (provenance).
- E8: `#confirmed-positive` plus the calibration assertion.
- Records in E2, E3, E6 and E8 carry `expectedPredictions`.
- Identity-checked records carry `expectedTargetIdentity = "<file>#<symbol>"`.

## 3. Harness mechanics

### 3.1 Runner

`runImpactRaw(sandbox, target, format)` returns
`{ exitCode, stdout, stderr, json | null, parseError }` for both
`--format=json` and human mode. Phase 1's `runImpact` is unchanged.

### 3.2 Target identity

Phase 1's `inferObservedTarget`, `dependencyPredictions` and
`mapEvidenceChannel` are reused. The only change to
`impact-honesty-corpus.phase1.ts` is exporting those three functions.

### 3.3 Coverage precondition

A fresh `init` sandbox is always `lower-bound` because Tier B coverage is
`0/N`: `init` only queues Tier B, and no language server is resolvable inside
the test sandbox. Without a coverage precondition, an epistemic gate would
pass for the wrong reason — coverage would mask every dynamic-evidence cause.

After `init`, and after every `analyze` in Sandbox C, the harness therefore:

1. opens the store writable with `GraphStore.open({ dbPath, readonly: false })`;
2. calls `store.files.markTierBProcessed({ projectId, filePath, commitSha: HEAD, processedAt: "2026-01-01 00:00:00" })`
   for every `files.getAllHashes()` row;
3. closes the store.

Justification: this is the same typed-repo write a successful Tier B batch
performs, with precedent in `hydrate-metadata-roundtrip.integration.test.ts`
and `analyze-tier-b-full-resync.test.ts`. It writes **coverage state, not
dependency evidence**, and it is the only way to keep coverage from masking
every dynamic cause without depending on a live language server. The harness
then asserts `partialCoverage` is absent in every Phase 2 JSON result.

`lsp-fallback` provenance (E6/E7) comes only from the deterministic Tier A
`ast_call_sites` reverse read (`ImpactService.resolveCallSiteFallback()`), never
from a live language server, so CI stays environment-independent.

### 3.4 How corrupted or incomplete dynamic evidence is produced

- **Primary: production-path degradations with no DB edit.** C1a/C1b
  (incremental `analyze` after adding candidate files: a stale candidate
  universe) and C3 (`snapshot` → `clean` → auto-hydrate, where the evidence
  artifact is absent). Both use only real `git` plus real `docuvia` commands.
- **Secondary: C2, a corrupted artifact.** #393 evidence has **no auxiliary
  file**. Its only persisted production artifact is the `docuvia_meta` row
  `impact.dynamic-dependencies.v1:<projectId>`, written by
  `persistDynamicDependencyEvidence` and read back by the real
  `docuvia impact` process. Corrupting that row through the typed
  `store.meta.set(...)` repo (never raw DDL) corrupts the production artifact
  itself, while the read path under test is still the real CLI. This is the
  only way to reach the `JSON.parse` failure, the non-array branch and the
  record-shape branch through a real process; it models torn writes, version
  skew, and a database written by another schema version. The original value
  is restored after each variant and C0 is re-asserted as a `[state-diff]`
  check.

### 3.5 Human-output parity

For E2, E4a, E6, E8, C2a and C3 the harness also runs human mode and asserts:

1. the `Risk level: <X>` line equals JSON `riskLevel`;
2. a `Note:` line is present exactly when JSON `epistemic === "lower-bound"`;
3. when any entry has an `edgeSource`, each row's Source column label equals
   the JSON `edgeSource` (or `static`);
4. for E4a, the output contains `candidate-set-exceeds-64`.

Multi-record evidence is not fully rendered in human mode; that is a Phase 3
follow-up, not a Phase 2 gate.

### 3.6 Determinism

Every sandbox is evaluated twice; normalized per-case records **and** raw JSON
stdout per target must be identical. Sandbox C degradation states are each
observed twice. One `[stress]` concurrent pass over Sandbox A (3×
`Promise.all`) must equal the sequential baseline.

## 4. Gates

`assertPhase2ImpactHonestyGates` throws with a distinct message per gate. No
blended score is produced.

| Gate | Condition                                                                                                                                     | Error message regex                             |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| G1   | `errorCases === 0`; every record `statusCorrect`; no `coverage-masked`                                                                        | `/errored\|unexpected status\|coverage-masked/` |
| G2   | epistemic `falseSafeRate === 0` **and** epistemic cases ≥ 10 (non-vacuous)                                                                    | `/false-safe/`                                  |
| G3   | epistemic `wrongCertaintyCases === 0`                                                                                                         | `/wrong-certainty/`                             |
| G4   | E8 calibration: epistemic projection = `resolved`, and `epistemic`, `riskNote`, `dynamicEvidence` are absent                                  | `/calibration/`                                 |
| G5   | provenance `mismatches === 0` and `checked ≥` the golden-declared count                                                                       | `/provenance/`                                  |
| G6   | no file whose only channel is `dynamic-candidate` appears in any record's `confirmedPredictedFiles`; candidate-boundary coverage = 1          | `/candidate promoted/`                          |
| G7   | per-fixture evidence records equal golden (sourceFile, status, reason, sorted candidatePaths); `unrelatedAdmitted` is empty                   | `/evidence state/`                              |
| G8   | E3 bounded with size 64; E4a/E4b overflow (`unresolved`, `candidate-set-exceeds-64`, `[]`, no dynamic-candidate entry, `truncatedOrOverflow`) | `/overflow/`                                    |
| G9   | every C\* fixture: exit 0, epistemic `unknown`, and the explicit reason present (`dynamicEvidenceUnavailable` or dynamic `riskNote`)          | `/degradation/`                                 |
| G10  | two runs are identical (normalized records + raw stdout)                                                                                      | `/determinism/`                                 |
| G11  | `confirmed-positive` records have P/R/F1 = 1                                                                                                  | `/positive/`                                    |
| G12  | human parity (§3.5)                                                                                                                           | `/human parity/`                                |

## 5. Poisoned controls

Poisons are applied to the **raw JSON before projection**, so the projection
itself is exercised. Each must make the named gate throw.

| Control                                | Mutation                                                                                            | Gate that must fail                                   |
| -------------------------------------- | --------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| P1 promote dynamic-candidate to static | E2: delete `edgeSource` (and `dynamicEvidence`) from the loader entry                               | G5 `/provenance/` (and G11: the loader becomes an FP) |
| P2 UNKNOWN to confident empty          | E4a: `riskLevel = "LOW"`; delete `epistemic` and `riskNote`                                         | G2 `/false-safe/`                                     |
| P3 truncate overflow to bounded        | E4a: evidence becomes `status: "bounded"`, first 64 plugin paths, `reason: "bounded-local-pattern"` | G8 `/overflow/`                                       |
| P4 fabricated certainty on non-empty   | E2: delete `epistemic`, `riskNote` and `dynamicEvidence`                                            | G3 `/wrong-certainty/`                                |
| P5 lsp-fallback relabeled static       | E6: delete `edgeSource`                                                                             | G5 `/provenance/`                                     |
| P6 masked coverage                     | E8: add `partialCoverage: true`                                                                     | G1 `/coverage-masked/`                                |
| P7 shape outside contract              | E8: `epistemic: "exact"`                                                                            | projection returns `error`, so G1 fails               |

## 6. Product defects

Classification follows the issue: a fixture that exposes a product defect keeps
its golden expectation and is classified `PRODUCT_DEFECT`; the defect is then
fixed (doc → failing test → implementation) or tracked in
`KNOWN_PRODUCT_DEFECTS` with a linked child issue.

The verdicts below come from running every fixture through the real CLI
before any product change. No golden expectation was altered by the probe.
(The plan's informational `riskLevel` guesses for E1a/E4a were not goldens:
the gates observe the frozen projections, not the risk band.)

| ID                                          | Defect                                                                                                                                                                                                                                                                                                                 | Fixtures | Probe verdict (real CLI, before any fix)                                                                                                                                                                                                                                     |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **D1**                                      | Corrupted or wrong-shape evidence silently becomes "no evidence": `readDynamicDependencyEvidence()` returned `[]` on a parse failure or non-array, so a target with a static caller that is also a bounded candidate flipped to **exact**; a record missing `candidatePaths` threw a `TypeError` and the CLI exited 1. | C2a/b/c  | **Confirmed.** C2a (`{not-json`) and C2b (`{}`) reported exact `MEDIUM` with no `epistemic`; C2c exited 1 with `Cannot read properties of undefined (reading 'includes')`.                                                                                                   |
| **D2**                                      | Stale candidate universe: evidence is recomputed only for files re-parsed in a batch, so retained records keep their old `candidatePaths` after candidate files are added.                                                                                                                                             | C1a, C1b | **Confirmed.** After an incremental `analyze`, `evalP2DegGamma` and `evalP2Deg64P64` reported exact with no evidence, and `evalP2Deg64P00` still claimed a stale bounded set of 64 while the true set is 65 (overflow).                                                      |
| **D3**                                      | NodeNext `.js` specifiers are invisible: ``import(`./plugins/${n}.js`)`` never matched `plugins/*.ts`.                                                                                                                                                                                                                 | E9       | **Confirmed.** The loader record was `unresolved/no-known-local-candidate` and was not surfaced for the target, so `evalP2NnOne` reported exact.                                                                                                                             |
| **D4**                                      | Non-source tracked files may be admitted as candidates for suffix-less patterns.                                                                                                                                                                                                                                       | E2 decoy | **Refuted.** `init` does not track `multi/plugins/README.md` in `project_files`, so it is never a candidate; E2 admits exactly `[alpha, beta, gamma]`. No product change.                                                                                                    |
| **D5**                                      | `snapshot` → `clean` → auto-hydrate loses all #393 evidence (the `docuvia_meta` key is not carried by the knowledge branch).                                                                                                                                                                                           | C3       | **Confirmed.** After hydration `docuvia_meta` held only `hydratedKnowledgeSha`/`lastIngestedSourceSha`, and `evalP2DegAlpha` reported exact. The honest-unavailable state is fixed with D1; carrying the evidence through the knowledge branch is deferred to a child issue. |
| **D7** (found by the corpus, not predicted) | IMPT-001 keeps the target's own containing-file `contains` entry in the blast radius **and** in the confirmed count fed to the epistemic ladder, so a symbol with no real dependent at complete coverage is reported exact `MEDIUM` — a verified zero-impact claim.                                                    | E7       | **Confirmed.** `evalP2ComputedTarget` (reachable only through `svc["evalP2ComputedTarget"]()`) returned `blastRadius = [its own file]`, `riskLevel: MEDIUM`, no `epistemic`: false-safe under §1.1.                                                                          |
| D6                                          | A deleted loader file leaves phantom evidence behind (over-conservative, safe direction).                                                                                                                                                                                                                              | —        | Observation only, not gated. `project_files` rows are never deleted by any product path, so a deleted candidate also stays a candidate (same safe direction).                                                                                                                |

### Resolution

Each confirmed defect is fixed in its own commit (doc → failing test →
implementation). The failing tests were first committed as `it.fails`, tagged
with the defect, so the fix commit flips them to `it`.

- **D1 — fixed.** `readDynamicDependencyEvidenceState()` validates the
  persisted payload and returns `unavailable` with reason `corrupt-json`,
  `not-array` or `invalid-record` (one invalid record makes the whole set
  untrusted). `ImpactService.getDynamicEvidenceAvailability()` surfaces it,
  `ImpactResult.dynamicEvidenceUnavailable: { reason }` is added (omitted when
  available), and the epistemic ladder treats it as a lower-bound cause at the
  dynamic-evidence rung (`RISK_NOTE_DYNAMIC_EVIDENCE_UNAVAILABLE`). An ingestion
  batch that meets an unavailable set rescans every tracked JS/TS source, so the
  next `analyze` heals it instead of writing an "available" partial set. The
  core test that asserted corrupt evidence reads as `[]` encoded the defect and
  was tightened.
- **D5 — honest state fixed with D1; round trip deferred.** A missing evidence
  row while JS/TS sources are tracked is `unavailable/missing`, so C3 reports a
  lower bound with an explicit reason. Carrying the evidence (and
  `ast_call_sites`) through the knowledge branch is a knowledge-branch format
  change, drafted as a child issue of #508 (not gated here, so not registered in
  `KNOWN_PRODUCT_DEFECTS`).

Open question (not gated): an `lsp-fallback`-only result can be **exact**,
because Phase 0 counts `lsp-fallback` as a confirmed channel. Phase 2 gates
only its provenance and records the observed level for Phase 3.

## 7. Test lane

- `artifacts/cli/test/support/impact-honesty-epistemic.phase2.ts` and its unit
  test — pure projections, observation, gates and poisons on hand-written
  JSON (utility tier).
- `artifacts/cli/test/support/impact-honesty-corpus.phase2.ts` — sandbox
  files, goldens, runner, coverage seeding, corruption helpers.
- `artifacts/cli/test/integration/commands/impact-honesty.phase2.integration.test.ts`
  — the real-CLI corpus (persistence tier, all five #263 markers).

TDD sources: issue #508 Phase 2; this document;
`docs/gitbook/analysis/impact-benchmark-honesty-phase0.md`; issue #393; issue
#217; `docs/gitbook/architecture/testing-and-quality-architecture.md`;
`docs/gitbook/guidelines/phase-based-test-quality-hardening.md`.

## 8. Exit gate

Phase 2 is complete when G1–G12 pass on real CLI output, P1–P7 each
demonstrably fail their named gate, the two evaluations are identical, every
confirmed defect is fixed with a failing-first test or registered with a
linked child issue, the Phase 0 scorer and the Phase 0/1 contracts are
untouched, the #263 category ratchet does not regress, and the full CI is
green.
