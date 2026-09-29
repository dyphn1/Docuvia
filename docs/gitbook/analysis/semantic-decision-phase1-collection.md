# Semantic decision Phase 1: real collection, oracle and baseline

Source: [#506](https://github.com/dyphn1/Docuvia/issues/506), under the
[#468 umbrella](https://github.com/dyphn1/Docuvia/issues/468). Builds on the
[Phase 1 corpus audit](semantic-decision-phase1-corpus.md) (P1-01–03) and the
[Phase 0 contract](semantic-decision-phase0-contract.md). This is offline evaluation tooling:
it does not change `analyze`, Tier B routing, graph persistence or any default LSP behavior.

The frozen capability is unchanged: `typescript × cross-file-call`, restricted to
same-repository targets the current LSP path can verify. Imports, dynamic/runtime targets,
other languages, impact relevance and `needs-verification` stay out of scope.

## C-01 — Snapshot identity

Every repository snapshot is materialized from `git archive <revision> [<subtree>]` into a fresh
directory, then committed into a private throwaway repository so `docuvia analyze` has a `HEAD`.
The user's checkout is never written to.

The **snapshot hash** is computed from bytes on disk, never from a supplied string: SHA-256 over
the lines `<path>\0<sha256(file bytes)>\n`, sorted by path (UTF-16 code unit order), for every
tracked file that is a TS/JS source (`.ts .tsx .mts .cts .js .jsx .mjs .cjs`) or a project
configuration file (`tsconfig*.json`, `jsconfig*.json`, `package.json`). Candidate collection,
checker evidence and the LSP oracle each recompute it independently, immediately before their
own stage. Any mismatch surfaces as `freshness-mismatch` through the P1-01 labeler.

## C-02 — Tier A candidate set (feature schema `tier-a-name-match/v1`)

Tier A is Docuvia's own AST ingestion (`docuvia analyze`, no Tier B). For each Tier A call site in
a `.ts/.tsx/.mts/.cts` file, the candidate set is every symbol node (`node_key` containing `#`) in
the same project whose `name` equals the call site's `callee_name` and whose file differs from the
caller file. Candidates are ranked, then ordered by `node_key` within a rank:

| Rank | Tier A evidence                                                                  |
| ---- | -------------------------------------------------------------------------------- |
| 0    | Target of a Tier A `calls` edge whose source node is in the caller file          |
| 1    | Declared in a file the caller file `imports` (Tier A `imports` edge, file level) |
| 2    | Any other same-name symbol                                                       |

The set is capped at the contract limit of 32 candidates; a larger set is recorded
`truncated: true` with its full match count. An empty set is legal and stays in the denominator
as a candidate miss. Candidate IDs are `tierA:` + the first 16 hex characters of
SHA-256(`node_key`), so IDs are stable across replays. No LSP result, checker result or label can
add a candidate.

## C-03 — Target identity

Targets are Docuvia `node_key`s. A declaration `(file, containerName?, name, startLine,
nameLine)` maps to the first key present in the Tier A graph among `base@L<startLine>`,
`base@L<nameLine>` and `base`, where `base = buildQualifiedBaseKey(file, name, containerName)`
and `containerName` is the nearest enclosing named class. A declaration with no graph node
(for example an interface method signature) is **unmappable** and cannot be gold.

## C-04 — Population and independent evidence

A call site enters the corpus only when the **TypeScript type checker** (compiler API,
`ts.createProgram` for the nearest `tsconfig.json`, aliases followed) resolves the callee to one
or more declarations that are all in-repository, all mappable, and include at least one file
other than the caller's. Selection therefore never depends on Tier A candidates or on the LSP
oracle. Exclusions are counted by reason in the collection report (`no-configured-project`,
`checker-unresolved`, `external-target`, `same-file-target`, `unmappable-target`,
`non-typescript-file`, `no-identifier-at-position`).

Review evidence per sample:

- `positiveTargetIds`: the checker's mapped cross-file declarations.
- `negativeTargetIds`: only for `bare` calls whose declarations are all concrete (function,
  method with body, class, constructor or function-valued variable) — static binding is then
  certain, so every other candidate is an explicit negative. Receiver calls (`member`, `this`,
  `arg-chain`) never get negatives, because dynamic dispatch can legally select another candidate.
- `evidenceRefs`: `ts-checker:typescript@<version>:<file>:<line>:<column>` per declaration, plus
  the syntactic source audit result below.

**Syntactic source audit** (independent of the type checker): for `bare` calls and
`namespace.member` calls, the caller file's import declaration binding the callee (named, aliased,
default or namespace import) is resolved by relative/`paths`-free module resolution, following
`export … from` re-exports up to depth 5. When the audit resolves a file, it must be the gold
target's file, or the sample's review becomes `conflict` (quarantined). Calls the audit cannot
check syntactically are marked `source-audit:not-applicable`; they are listed in the human audit
worksheet described in C-08.

## C-05 — LSP oracle

The oracle is the real `typescript-language-server` over `--stdio`, driven by Docuvia's own
`LspJsonRpcClient` (including its #525 ContentModified/ServerCancelled retry), with
`textDocument/definition` at the Tier A call-site position — the same request the Tier B forward
pass issues. One server serves one `tsconfig` project group and is restarted between groups to
bound memory. The config hash covers the server and tsserver versions, initialization options
(`maxTsServerMemory`), request timeout and readiness policy.

Readiness: before a project group's requests, up to three of its call sites are polled
round-robin until one resolves to a mapped, in-repo, cross-file target (or the readiness cap
expires). "Any non-empty answer" is not enough: while tsserver is still loading the project,
typescript-language-server's syntax server answers in its place and returns only same-file and
`lib.d.ts` definitions (observed on the first collection run: 48 of 921 requests on
typescript-language-server came back empty before this rule). A group that never becomes ready
records `not-ready` for every sample. Per request the outcome is:

| Server answer                                                    | Oracle status |
| ---------------------------------------------------------------- | ------------- |
| One or more locations mapping to in-repo, cross-file graph nodes | `resolved`    |
| Locations, none of them an in-repo cross-file graph node         | `unsupported` |
| `null` / empty array                                             | `empty`       |
| Request timeout                                                  | `timeout`     |
| Group not ready                                                  | `not-ready`   |
| Any other JSON-RPC or transport error                            | `error`       |

All mapped locations are kept (multiple legal targets). The oracle never turns an empty answer
into a negative; the P1-01 labeler already treats every non-`resolved` status as an oracle
failure, and a resolved set that disagrees with the checker as `label-conflict`.

## C-06 — Deduplication and splits

Deduplication runs before split assignment:

- **Repository families**: a pair of snapshots whose normalized source-file hash sets overlap by
  ≥20% of the smaller set, or that share a root commit, is related. Related snapshots declared in
  different families fail the collection; they must be merged in the spec.
- **Fragments**: a call site's duplicate group is SHA-256 of its whitespace-normalized ±2-line
  window plus the callee name, across all snapshots. This captures copied fragments, generated
  duplicates and the same call site across neighboring revisions.

Splits are declared per family in the versioned corpus spec before collection. Evaluation-only
licenses are assigned only to `test`. After assignment, a duplicate group present in more than
one split keeps only the members of the first split present in the order `test`, `temporal`,
`calibration`, `train`, and drops the others (`dedup-cross-split`), so held-out data is never
removed in favor of fitting data. A temporal sample is kept only when its duplicate group occurs
nowhere in the family's earlier snapshot — sampled or not (`temporal-unchanged`). Temporal ordering is verified from git ancestry (`merge-base
--is-ancestor`) and committer timestamps of the source repository, not from the spec.

## C-07 — Replay

The full collection (snapshot, Tier A, checker, oracle, dedup, splits, audit) runs twice from the
same spec into separate work directories. `eval:semantic:replay` compares the correctness-bearing
fields: snapshot hashes, candidate IDs/order/sets, oracle status/targets, review evidence, labels
and reasons, duplicate groups, family relations, split assignment, dataset hash, report metrics
and gates. Timing fields are excluded. Any mismatch is reported by field and fails the replay.

## C-08 — Human audit worksheet

The collector emits every `label-conflict` sample plus a stratified ≥10% sample (per repository
× split × callee kind, seeded by the corpus split seed) with source excerpts for the caller and
each target. Automated syntactic audit results are pre-filled; entries without one are
`pending-human`. Phase 1 exit still requires this review; automation does not replace it.

## C-09 — Paired baseline

`eval:semantic:baseline` measures the current production path on the same snapshots:

| Workload             | Command                                                             |
| -------------------- | ------------------------------------------------------------------- |
| AST-only full        | `docuvia analyze` on an empty graph                                 |
| AST+LSP full         | the above, then `docuvia analyze --escalate-to-lsp --fallback-ast`  |
| AST-only incremental | commit a one-file change, `docuvia analyze` (post-commit hook path) |
| AST+LSP incremental  | the above, then `--escalate-to-lsp --fallback-ast` (pre-push path)  |

Each repetition uses a fresh process and a fresh graph. `cold` means the first repetition after
materializing the snapshot (process-cold; the OS page cache cannot be flushed without root and is
not claimed cold); `warm` means subsequent repetitions. Per workload the report keeps raw
samples, p50, p95, min and max, the Tier B file/edge/process counts parsed from the analyze log,
and the machine manifest (commit, Node/pnpm, OS, CPU, memory, TypeScript and LSP versions).
`--lsp-processes` is pinned and recorded so memory stays bounded; that pin is a documented
deviation from the auto-derived default.

## Memory safety

Stages run strictly one at a time per snapshot (Tier A → checker → oracle). Node stages run with
an explicit `--max-old-space-size`; tsserver gets `maxTsServerMemory`. A watchdog polls
`memory_pressure` and aborts the current stage — recording `collection-aborted-memory` — when free
memory falls below the configured floor, instead of letting macOS swap to exhaustion.

## Delivery status

| Slice | Scope                                                     | Status      |
| ----- | --------------------------------------------------------- | ----------- |
| C-01  | Byte-verified snapshot hash                               | Implemented |
| C-02  | Deterministic Tier A candidate set                        | Implemented |
| C-03  | Target identity mapping                                   | Implemented |
| C-04  | Checker evidence and syntactic source audit               | Implemented |
| C-05  | Real LSP oracle with distinct outcomes                    | Implemented |
| C-06  | Source-based dedup, spec-declared splits, temporal checks | Implemented |
| C-07  | Twice-replay comparison                                   | Implemented |
| C-08  | Human audit worksheet                                     | Implemented |
| C-09  | Paired fixed-hardware baseline                            | Implemented |

Results for a concrete corpus version are reported on #506, not in this specification.
