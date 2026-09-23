# Semantic decision Phase 1: corpus and baseline

Source: [#468 Phase 1](https://github.com/dyphn1/Docuvia/issues/468#issuecomment-5763312024).
Depends on the [Phase 0 contract](semantic-decision-phase0-contract.md) and
[PLAT-011](../adr/platform/PLAT-011-semantic-decision-feature-provider-boundary.md).
This is an offline data-quality boundary, not a production scoring or routing path.

## P1-01 — Trusted labels

`ISemanticCorpusService.label` consumes an untrusted, data-only observation. The v1
record retains sample/repository/family/revision/project/call-site identity, source
snapshot SHA-256, license and permitted usage, real/synthetic origin, split and
duplicate group, bounded ordered candidate IDs/target IDs, truncation, oracle
server/version/config/snapshot identity, and independent gold review evidence.
Target IDs identify symbols in the source snapshot, not positions in a candidate list.
Multiple gold targets and gold targets absent from candidates are legal.

The collector owns source hashing, family/duplicate classification, source access and
oracle execution. This boundary checks the declared identities; it cannot verify
unseen source bytes, license claims or the quality of a human review. The first
capability is `typescript × cross-file-call`. Other capabilities are out of scope.

Only a resolved oracle with **confirmed independent review**, nonempty evidence
references, matching source/oracle/review snapshots and matching positive target sets
can produce confirmed labels. This conservative first slice requires review for every
gold observation (stronger than the eventual stratified 10% minimum). A candidate
absent from oracle output is **unresolved** unless independently listed as negative.
Positive and negative gold sets must be disjoint; conflicts quarantine the whole sample.

Failure precedence is source/oracle/review snapshot mismatch → explicit conflict or
oracle/gold contradiction → unsupported scope → oracle failure → unreviewed →
truncated input → ready. Timeout, empty response, not-ready, unsupported and error
remain oracle failures, including when a stale annotation claims negatives. A resolved
oracle with no targets is treated as an empty response, never proof of no dependencies.
All quarantined candidates are unresolved (or out-of-scope), with no training labels.
Ready samples retain missing gold targets as candidate-generation failures.

The result preserves candidate order/IDs and all gold targets without changing input.
Malformed, unknown-field, duplicate-ID, oversized (>32 candidates), sparse/accessor
or contradictory-shape data throws `SEMANTIC_CORPUS_INVALID`; ordinary oracle failures
are diagnostic results. Snapshot/config hashes use lowercase SHA-256 hex. Dense plain
arrays and own enumerable data properties are required; frozen records are legal.

## P1-02 — Corpus audit and repeatable denominators

`audit` accepts a versioned manifest (`schemaVersion`, `corpusId`, `corpusVersion`,
`splitSeed`, `samples`). It validates every record through P1-01. Unknown fields,
duplicate sample IDs, duplicate repo/project/call-site/source snapshots, inconsistent
repo-to-family assignments and >100,000 records fail with `SEMANTIC_CORPUS_INVALID`.
Evaluation-only samples in train, family overlap between splits, or duplicate-group
overlap between splits fail with `SEMANTIC_CORPUS_LEAKAGE`. This initial audit permits
temporal data from sealed-test families or separate held-out families; a collector
must separately establish that temporal snapshots are later. Supplied family/duplicate groups are declarations,
not a substitute for source-based clone/fragment discovery.

The deterministic report sorts by sample ID, hashes canonical JSON (object keys sorted,
array order retained), and includes every label result, reason counts and separate
real/synthetic × split metrics. Two replays of the same manifest must match in full.
Input sample order or object key order cannot change the dataset hash or report.

Candidate recall is covered gold targets / all independently confirmed gold targets;
set coverage is requests covering every gold target / requests with trusted gold.
Known misses, empty candidate sets and truncated observations remain in these
denominators. Truncated observations contribute diagnostic recall but never usable
training labels. Stale/conflicting/failed-oracle/unreviewed/out-of-scope observations
have no trusted gold and remain visible in reason counts, never silently dropped or
turned into negatives. Zero denominators are `null` and evidence-insufficient.

Sample-size eligibility counts only ready real observations, deduplicated by the
collector's duplicate group. Family minimums count only those observations: ≥4 train,
≥2 calibration, ≥2 sealed test, ≥10,000 independent requests overall in those three
splits, ≥2,000 independent test requests, and ≥1 temporal request. Synthetic fixtures
and unusable observations cannot satisfy these gates. Aggregate real candidate recall
remains a diagnostic metric, while the candidate-recall gate requires ≥99% on the
**sealed-test real split** so train/calibration volume cannot mask held-out candidate misses.
The separate sample-size gate ensures a fully passing corpus also contains ≥2,000 independent
sealed-test requests. Per-split results remain in the report for review.

These gates report data quantity and declared candidate quality only. Even a `pass`
is not Phase 1 completion: collection provenance, dedup correctness, temporal ordering,
real oracle replay, fixed-hardware paired baselines and corpus review still require
external evidence. No model/precision/LSP-avoidance metric is fabricated.

## P1-03 — Offline audit command

Run `pnpm run eval:semantic --input corpus.json --output evaluate/results/semantic.json`
from the repository after installing dependencies. This developer evaluation entrypoint
bootstraps the existing contracts factory, then calls `ISemanticCorpusService.audit`.
It does not initialize a graph, load a model, contact an oracle or change CLI routing.

The input is a UTF-8 JSON manifest (maximum 64 MiB). Size checks and bounded reads
use one opened file descriptor; replacing the pathname after the size check cannot
swap the bytes being audited. Reading is capped even if the opened file grows.
The report is written atomically
only after validation/audit succeeds; malformed input cannot overwrite an earlier
report. Input and output must be different files. The output directory is created as
needed. Standard output contains a JSON summary with dataset hash and gate results;
errors are structured JSON on standard error. Exit codes: **0** for passing quantity
and candidate-recall gates; **2** for a valid report with failed/insufficient gates;
**1** for arguments, JSON, validation, leakage or filesystem failure. Exit 0 is still
not the external review/baseline exit gate for Phase 1.

The child-process regression runs a synthetic fixture twice and compares report bytes,
summary, ordered results, provenance hash and exit status. It also checks corrupt JSON,
leakage, missing files, output failures and preservation of an existing report.

## Delivery and remaining gates

| Slice         | Scope                                                                                                                     | Status      |
| ------------- | ------------------------------------------------------------------------------------------------------------------------- | ----------- |
| P1-01         | Provenance contract and honest label quarantine                                                                           | Implemented |
| P1-02         | Split leakage, candidate recall and evidence sufficiency report                                                           | Implemented |
| P1-03         | Offline audit command, atomic reports and explicit exit status                                                            | Implemented |
| Collection    | Source hashing, deterministic candidate generation, real LSP capture                                                      | Pending     |
| Corpus exit   | ≥8 real repo families (4 train / 2 calibration / 2 test), ≥10,000 requests, ≥2,000 sealed-test requests, temporal holdout | Pending     |
| Baseline exit | Fixed hardware; paired AST-only/AST+LSP; cold/warm and initial/incremental; full analyze/commit/pre-push timings          | Pending     |

Unit fixtures demonstrate policy behavior only. They are not a real training corpus,
model-quality evidence, a measured baseline or permission to start Phase 2. The existing
`eval:impact` gate remains mandatory and unchanged. #468 stays open.

Tests cite P1-01–03 and the testing architecture, cover positive/negative/malformed/failure
cases and complete repeated replay. Shared shapes live in contracts; pure policy lives
in Domain Core behind a transient factory token. No model imports, I/O or global state.
