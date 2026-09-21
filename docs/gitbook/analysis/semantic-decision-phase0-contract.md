# Semantic decision Phase 0: scope and acceptance contract

Source: [#468 Phase 0](https://github.com/dyphn1/Docuvia/issues/468#issuecomment-5763294070).
This is the reviewable specification for schema version 1, extending
[PLAT-011](../adr/platform/PLAT-011-semantic-decision-feature-provider-boundary.md).
It does not supersede [IMPT-002](../adr/impact/IMPT-002-lsp-for-absolute-quality.md).

## Scope and current inventory

| Work | Status / owner |
| --- | --- |
| Isolated package, factory provider token, model import restrictions | Already delivered by #469; retained |
| TypeScript, same-repository, LSP-verifiable cross-file call targets | First experimental slice; this phase defines its contract only |
| Request/response validation and unavailable provider conformance | This Phase 0 implementation |
| Candidate generation, corpus, gold labels, baseline | Phase 1; not implemented |
| Models, calibration, measured precision/cost | Phase 2; not implemented |
| Runtime, policy, shadow, timeout supervision and fallback workflow | Phase 3; not implemented |
| Probabilistic persistence, freshness, opt-in LSP routing, impact UI | Phases 4–6; not implemented |
| Shared daemon / additional languages, imports, dynamic patterns, Tier C | Conditional Phases 7–8; not prerequisites for the first slice |

Tier A owns deterministic facts, legal candidates and evidence snapshots. The provider only
scores supplied options. Domain/orchestration owns validation, policy and verification routing;
schema owns persistence; presentation owns user-facing explanations. No Phase 0 workflow invokes
semantic scoring, writes semantic edges, removes AST facts or bypasses exact/LSP analysis.

## Score and task semantics

| Task | Target semantics | Score interpretation |
| --- | --- | --- |
| `edge-relation` | Multi-target | Each candidate independently estimates a dependency relation. Several targets may be legal. |
| `impact-relevance` | Independent relevance | Relatedness is not a dependency or a verified blast radius. |
| `needs-verification` | Independent verification | VERIFY evidence informs future policy; cannot override exact/critical requirements. |

None is a single-target softmax; per-option values do **not** need to sum to one. Every request
contains exactly one `unknown` and at most one `verify`. `needs-verification` contains one verify
and no candidate options. An unknown-only request is legal for the other tasks. An empty option
array is malformed, not proof of zero dependencies. UNKNOWN means insufficient supported target
evidence; it does not prove that there is no dependency. Option IDs are non-blank and unique,
remain byte-for-byte caller-owned, and are not trimmed or normalized by a provider.

| Concept | Contract / authority |
| --- | --- |
| Raw score | `scoreKind: raw`, finite `probability` in [0,1], `calibrationVersion: null`; no calibration claim |
| Calibrated confidence | `scoreKind: calibrated`, non-blank calibration version tied to model and feature schema; still not correctness |
| Policy decision | Separate `SemanticDecisionPolicyResult`, versioned accept/abstain/verify; `verified: false` even on accept |
| Verified fact | Authoritative resolver/evidence under existing contracts; never produced by this scoring API |

Calibration fitting/mapping remains in the isolated feature package. Thresholds, calibration
compatibility checks, risk overrides and product policy remain domain/orchestration decisions.
A structurally valid calibrated response is not evidence that its calibration passed Phase 2.
No acceptance threshold is introduced here.

## Request, identity and limits

`SemanticDecisionRequest` carries schema version 1, a non-blank request ID, feature schema version,
task, language, relation, context, bounded options, and an evidence identity:

- `repoId`, `worktreeId`, `projectId` separate repository/worktree/project scopes.
- `snapshotHash` identifies actual source/config content, including dirty files; HEAD alone is
  insufficient. `candidateSetHash` identifies ordered candidate IDs and their evidence.
- Hash strings are opaque non-blank identifiers in Phase 0. Phase 1 owns generation and verifies
  source consistency; the validator cannot prove that a supplied hash matches source it never reads.
- `truncated: true` is retained as a diagnostic fact but rejected as an invalid scoring request;
  do not quietly trim input and then accept the result.

The hard contract cap is **32 candidates**, **34 total options**, and **32 KiB of UTF-8 bytes in
`JSON.stringify(request)`**, including metadata/attributes. Equality with a cap is valid. Context
and option text may be empty. Attributes must be finite number, string, boolean or null values.
Unknown structural fields, malformed objects/arrays, unsupported schema/task/kind and missing
identity are rejected. No silent coercion, unknown-key stripping, ID normalization or truncation.

Availability advertises exact `task × language × relation × featureSchemaVersion` capabilities
and tighter provider limits where needed. An empty capability list means no supported slice.
The foundation provider advertises none, even though the contract reserves three task names.
No caller can interpret a type declaration as implemented support. The first future capability is
`edge-relation × typescript × cross-file-call × <versioned feature schema>`; Phase 1 must freeze
that feature schema before collecting data. Other capabilities need their own gates.

## Response validation

`ISemanticDecisionValidator` is a pure domain service, registered under
`TOKENS.SemanticDecisionValidator`. It reads only contracts; neither it nor its consumers import
`semantic-decision`. It validates requests and provider outputs as untrusted data and returns a
fresh validated value, without mutating caller/provider objects. Validators contain no inference,
policy, graph access or I/O; contracts contain no validation implementation.

Every outcome echoes schema version, request ID, feature schema and the complete evidence
identity. Validation checks all identity fields against the request. A scored outcome requires
model provider, model ID, model version and artifact hash; exactly one finite [0,1] score for
every option in **request order**; no unknown/duplicate/missing IDs. Raw and calibrated states are
mutually constrained as above. Model identity is provenance, not a filesystem path or runtime
handle. A semantic response cannot add `verified`, a policy decision or an authoritative edge.

Unavailable is a distinct status with a typed code (`model-not-installed` or
`unsupported-capability`), non-blank reason, matching identity and an empty scores tuple. It
cannot carry a model, calibration, score kind or partial scores. Absence is never a success.
Invalid outcomes always throw `DocuviaError(SEMANTIC_INVALID_RESPONSE)`.

## Deadline, cancellation and errors

The optional `SemanticDecisionCallOptions` is in-process control, separate from serializable
evidence: `deadlineUnixMs` is a nonnegative safe integer absolute Unix millisecond deadline;
`signal` is an AbortSignal. Cancellation takes precedence over an expired deadline. Equality
with the deadline is expired. Invalid controls are `SEMANTIC_INVALID_REQUEST`.
The foundation provider checks controls before immediately returning unavailable. It has no
in-flight inference. Phase 3 providers must observe controls during inference; the orchestration
supervisor must also discard late results from non-cooperative providers and release listeners
and timers. This phase does not claim to implement that supervisor.

| Condition | Result |
| --- | --- |
| Malformed request, truncated evidence, illegal task/options/control | `SEMANTIC_INVALID_REQUEST` |
| Candidate/option/UTF-8 request size exceeds hard cap | `SEMANTIC_INPUT_LIMIT_EXCEEDED` |
| Unknown/duplicate/missing output score, invalid numeric value, mismatched identity or impossible outcome | `SEMANTIC_INVALID_RESPONSE` |
| Pre-cancelled call | `SEMANTIC_CANCELLED` |
| Expired deadline | `SEMANTIC_DEADLINE_EXCEEDED` |
| Model absent / unsupported capability | Unavailable outcome, no scores |
| Future unexpected inference failure | `SEMANTIC_INFERENCE_FAILED`, native cause retained; never converted into success |

Provider control checks assume a structurally validated request. Future consumers must validate
before calling and validate the outcome before use. Runtime capability routing, fallback policy,
retry decisions and mid-flight supervision belong to Phase 3, not these validators.

## Release gates and traceability

Required first-release order: scope/contract → corpus/baseline → offline Go/No-Go → shadow →
provenance/freshness → opt-in workflow/impact → Phase 9 release gate. Phase 2 No-Go stops product
integration. A shared service and other languages each require independent evidence. Phase 0
completion neither enables a model nor grants permission to change the default LSP path.

Tests use `TDD-SOURCE` markers for this specification, PLAT-011 and the
[testing architecture](../architecture/testing-and-quality-architecture.md). Tests are written and
run red before each implementation slice. Pure validation and the no-I/O unavailable stub use
unit tests; real runtime integration tests become mandatory when a runtime exists.

| Requirement | Contract / planned executable evidence |
| --- | --- |
| P0-01 identities, versioning, bounded input, task semantics | `semantic-decision-request.unit.test.ts`: valid variants, exact caps, UTF-8, malformed/duplicate/truncated input |
| P0-02 raw/calibrated distinction, complete output, honest errors | `semantic-decision-outcome.unit.test.ts`: score/identity/failure matrix and negative controls |
| P0-03 capability honesty, cancellation/deadline, no model | `semantic-decision-provider.unit.test.ts`: unavailable/control/lifecycle cases |
| P0-04 replaceable providers, immutable deterministic mapping | `semantic-decision-validator.unit.test.ts`: two complete replays with different contract-only providers through an isolated factory |
| P0-05 no model imports or default-path changes | Existing `test/layer-boundary.test.ts`, registration tests and review of production call sites |

Baseline for P0-01/P0-02/P0-04 is missing executable evidence (TEST_GAP); the old probability
comment claiming calibration is a SOURCE_CONFLICT resolved by this explicit contract. P0-03
already had three foundation tests but lacked identity/control/capability evidence. Execution
results and any infrastructure limitations belong in the PR completion report. #468 remains the
open umbrella for subsequent phases; merging this phase must not close it.
