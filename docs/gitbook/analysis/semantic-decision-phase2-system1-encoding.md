# Semantic decision Phase 2: System-1 dataset encoding (P1)

This page specifies the deterministic, offline encoding produced by
`pnpm run eval:semantic:system1-export`. It converts semantic corpus v1 into bounded option
selection requests for later experiments. It implements no model, scorer, calibration, metric,
resource measurement, or production routing behavior.

The encoding reuses the Phase 0 `SemanticDecisionRequest` contract. It keeps deterministic Tier A
facts as the candidate set and places all review/oracle labels in separate files. The snapshot
source and Tier A graph are the only inputs to model state. The collector's checker, oracle, review
and labels do not flow into the state builder.

## State and candidate encoding

Each state JSONL record contains a Phase 0 request plus ambiguity metadata:

| Request field    | Encoded evidence                                                                                                                                                     |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `evidence`       | Stable repo, revision/worktree, project, byte-verified snapshot hash, ordered candidate-set hash, and truncation flag                                                |
| `context.text`   | JSON with the caller file and enclosing symbol; call expression, a source window around the call, call kind, receiver/generic hints, and the callee's import binding |
| Candidate option | Existing Tier A candidate ID and target ID, rank/evidence, `evidenceStatus`, declaration kind, overload count, and bounded declaration signature                     |
| Dataset metadata | Multi-label ambiguity tags, any detector states marked `not-detected`, candidate count, and whether state text was clipped                                           |

The exporter groups samples by repository and revision, materializes one snapshot at a time with
the Phase 1 snapshot machinery, recomputes the hash from tracked source/config bytes, and requires
that it match the corpus manifest. It runs Tier A on that snapshot and checks that the resulting
candidate IDs and order match corpus v1. A mismatch is excluded and counted; the exporter never
substitutes a new target or reorders the manifest's Tier A set.

The exporter also reads the adjacent `collection-report.json` for the repo/revision/subtree/hash
snapshot descriptors needed to materialize the same bytes as the collector. It selects only the
`snapshots` descriptors; checker/oracle summary fields in that report do not feed request state.

Tier A rank and evidence are:

| Rank | Evidence                                                                                              |
| ---: | ----------------------------------------------------------------------------------------------------- |
|    0 | A Tier A `calls` edge from the caller file reaches the candidate node (`tier-a-calls-edge`)           |
|    1 | A Tier A file-level `imports` edge from the caller reaches the candidate file (`tier-a-imports-file`) |
|    2 | Same-name Tier A candidate, with neither stronger edge (`tier-a-same-name`)                           |

Candidate IDs remain the C-02 `tierA:` plus the first 16 hex characters of SHA-256 over the
target node key. Candidate options preserve their existing C-02 order. No option can name a target
outside that set.

If a Tier A candidate's source file is absent from the pinned snapshot or its declaration cannot
be matched syntactically, the candidate remains in its original position. It has
`evidenceStatus: "missing"`, `declarationKind: "unknown"`, an empty signature, and `null` for
overload count, generated marker, and forwarding-wrapper status. A declaration that was found but
whose kind is unmapped has `evidenceStatus: "present"`, its bounded signature, and any syntax facts
that could be counted. Detectors treat missing candidate facts as unavailable rather than positive
evidence. Missing candidate evidence never removes the Tier A target or establishes that it is
invalid. Only an unreadable caller file or missing call expression excludes a sample; every
exclusion is recorded in `excluded.jsonl` with sample ID, deterministic request ID, assigned split,
and reason. `export-report.json` reports candidate-level missing-evidence rates and the rate of
samples with any missing candidate evidence, without using label fields.

Missing evidence is itself a potential shortcut feature: the round-2 diagnostic observed missing
evidence in 0–3.4% of gold candidates versus 10–27% of non-gold candidates, with a substantially
higher gold-missing rate in training than evaluation. The source remains Tier A and pinned snapshot
syntax, so this is not label leakage; however, a later model could learn source/split-specific
missingness. The labels-only `labels-report.json` records gold versus non-gold missingness by split
for auditing. It must never be joined into fitting features.

The request always appends exactly one `UNKNOWN` option and one `VERIFY_WITH_LSP` option after the
candidate options. `UNKNOWN` means there is not enough supported evidence to select a target; it
does not mean there is no dependency. `VERIFY_WITH_LSP` asks for authoritative language-server
verification. Neither option is a target. These meanings follow the
[Phase 0 contract](semantic-decision-phase0-contract.md).

## Labels stay separate

Each split has a separate `*-labels.jsonl` file keyed by request ID. A label record contains only
positive target IDs, negative target IDs, review status, oracle status, and `candidateMiss`. The
miss flag is true when a positive target is absent from the Tier A candidate set. Such a miss is a
Tier A candidate-generation miss; it never adds a gold target to the model options.

The core state builder takes a dedicated label-free input type. It has no oracle, review, checker,
or label properties. The unit leakage test supplies those fields as decoys and verifies that they
do not appear in the encoded request. The exporter builds all state records from an explicit
projection of corpus identity, Tier A candidates, and parsed snapshot syntax, then makes a
separate pass to build labels.

## UTF-8 byte limits

All listed text limits count UTF-8 bytes, not characters. Clipping occurs only at Unicode code
point boundaries and sets `request.evidence.truncated`; stable identity fields such as target IDs
are never clipped. A sample whose target ID or complete request cannot fit is excluded and counted
by reason.

| Field                                                |                                 Maximum |
| ---------------------------------------------------- | --------------------------------------: |
| Tier A candidates / request options                  |        32 candidates / 34 total options |
| Whole serialized Phase 0 request                     |                                  32 KiB |
| Serialized caller/call/import context                |                                   4 KiB |
| Caller file path / enclosing symbol                  |                         256 / 192 bytes |
| Callee name / call expression / source window        |                 128 / 384 / 1,536 bytes |
| Receiver hint / generic hint                         | 128 bytes each; at most 4 generic hints |
| Import local name / imported name / source specifier |                   128 / 128 / 256 bytes |
| Candidate target ID / declaration signature          |                         512 / 256 bytes |
| Repo, revision, project, or snapshot identity        |   256 bytes each; sample ID 1,024 bytes |

The request limit is also checked after candidate options and metadata are serialized. An oversized
context or total request is excluded rather than silently accepted. The report distinguishes any
truncated evidence, clipped state text, and a C-02 candidate set that was already marked
truncated.

## Ambiguity class detectors

Tags are multi-label and use only parser syntax plus Tier A candidate facts. Every rule is
deterministic. An unknown required syntax fact is listed under `notDetectedClasses`; the exporter
does not guess a class from labels, checker results, oracle results, or review outcomes.

| Class                                          | Detector rule                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `alias/renamed import`                         | A named import binds a local name different from the imported name.                                                                                                                                                                                                                                                                                                                                                                 |
| `barrel/re-export`                             | The resolved imported module re-exports from another module, including `export *`, or re-exports an imported local binding. Resolution uses the sample's JSONC TypeScript configuration, including `extends`, and is restricted to tracked snapshot files. An unresolved module is reported as `not-detected` for this class.                                                                                                       |
| `path alias`                                   | The import specifier matches a literal or wildcard pattern in the sample project's parsed TypeScript configuration. JSONC and `extends` are honored, and paths use TypeScript's config-relative base even without `baseUrl`. If the project config cannot be parsed, report `not-detected`.                                                                                                                                         |
| `generic factory`                              | The call has explicit type arguments and its callee starts with `create`, `make`, `build`, `provide`, or `resolve`, or ends with `Factory` or `Provider` (case-insensitive).                                                                                                                                                                                                                                                        |
| `overloads`                                    | The candidate resolves to a function/method/call signature and another same-name callable declaration shares the same actual AST container: class, interface, type literal, object literal, module, function body, or source-file overload group. Getter/setter accessors and class/type/property name collisions do not count.                                                                                                     |
| `fluent/chained call`                          | The call is a member call whose receiver is itself a call or has a nested property/element access chain.                                                                                                                                                                                                                                                                                                                            |
| `DI/registry lookup`                           | The receiver identifier is exactly `container`, `injector`, `registry`, or `serviceLocator`, and the method is `get`, `resolve`, or `inject` (case-insensitive).                                                                                                                                                                                                                                                                    |
| `framework convention`                         | The call is on a typed constructor-parameter property or `@Inject`-decorated field inside a class carrying a recognized Nest or Angular decorator, or is a recognized framework registry lookup such as `moduleRef.get/resolve`. Candidate decorators and unrelated decorators elsewhere in the file never tag a call.                                                                                                              |
| `computed-but-bounded import`                  | The caller module contains `import()` with a template or string-concatenation expression that resolves only through string literals and `const` string literals and is no more than 512 UTF-8 bytes.                                                                                                                                                                                                                                |
| `runtime string token`                         | A recognized DI/registry lookup call has at least one string-literal or no-substitution-template argument.                                                                                                                                                                                                                                                                                                                          |
| `unresolved receiver with small candidate set` | A member, `this` member, or argument-chain call has 2–4 Tier A candidates, is not a recognized DI lookup, and has no syntactic receiver type. Field declarations, constructor parameter properties, `new X(...)` initializers/assignments, typed initializers, and `as X`/`satisfies X` assertions provide a type hint and prevent this tag. Non-resolvable complex receiver expressions are reported as not-detected, not guessed. |
| `generated wrapper/facade`                     | A candidate is under a `generated`, `gen`, `facade`, or `wrappers` path component, has an `@generated` leading comment, or has one direct call statement forwarding one of its own parameters to a named function/method found in source. Built-in/standard collection methods (including `RegExp.test`, `Map`/`Set` accessors, and reactive subject methods) do not establish a wrapper. Plain one-line bodies do not qualify.     |
| `other/plain`                                  | No supported detector matches and none of the required detector inputs is unknown. This is a detector fallback label, not proof that the call is semantically unambiguous.                                                                                                                                                                                                                                                          |

Classes without a reliable syntax detector are reported in `notDetectedClasses`, never guessed.
Unreadable candidates leave affected overload and wrapper evidence unavailable and cannot create a
positive detector tag by themselves. The syntax parser/detectors and colocated Vitest tests live in
`lib/core/src/semantic/system1/`; `scripts/semantic-corpus/system1-syntax.mts` contains snapshot
reads and module resolution only. The detector limits above are intentional; they do not claim
complete recall for framework conventions, dependency injection, generated code, or computed
imports.

## Splits and seals

The exporter writes state and labels to independent JSONL files for `train`, `calibration`,
`temporal`, and `test`. Each file is sorted by request ID and uses one compact JSON record per line.
Files and reports contain no timestamps.

Apply the C-06 split precedence `test > temporal > calibration > train` when split eligibility
overlaps. Corpus v1's `usage: evaluation-only` samples are legal in the held-out `temporal` and
`test` partitions. They are forbidden in `train` and `calibration`; finding one in either fitting
split fails the export. Temporal and test remain separate, sealed holdouts.

Each holdout has its own `<split>-seal.json` manifest with the partition name, state/label
filenames, SHA-256 of the exact state and labels bytes, and record count. The seal is computed
after deterministic JSONL serialization. Temporal receives the same protection as test. Later
phases can verify both files before using either holdout and can keep both out of fitting and
calibration.

Every excluded sample is also written to `excluded.jsonl` with `sampleId`, the deterministic
request ID, its assigned split, and the exclusion reason. Records are ordered by request ID and
contain no label/oracle/review/checker values. Candidate declaration read failures are not
exclusions. The export report summarizes exclusions by reason and records the excluded file's
count and SHA-256. The dataset payload hash covers this file alongside the state, labels,
labels-only diagnostic, and seal files, so exclusions participate in the two-run determinism check.

All artifacts are under the gitignored
`evaluate/results/semantic-corpus/v1/system1-dataset/` directory. `export-report.json` is the
label-free state report: it includes split and ambiguity-class counts, per-split class counts,
candidate-set size distribution, candidate-level and per-sample missing-evidence rates by split,
truncation counts, exclusions by reason and excluded-file digest, both seal manifests, the
evaluation-only fitting-leakage check, the labels-report digest, and a stable `payloadSha256`.
`labels-report.json` separately holds candidate-miss counts and gold/non-gold missing-evidence
rates by split. The payload hash covers the sorted names and contents of all state, labels,
label-diagnostic, seal, and excluded files; it does not hash the report that contains it.
