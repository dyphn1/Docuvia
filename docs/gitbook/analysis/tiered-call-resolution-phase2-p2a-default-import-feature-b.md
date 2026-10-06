# P2-A Feature B: combined default imports

## Result and scope

Feature B adds the three audited CALIBRATION candidates for a combined default-plus-named import and its unique direct default-function export. CALIBRATION raw and ordered-proposal recall rise from **2,763/2,766 (99.8915%) to 2,766/2,766 (100%)**, a gain of **3 occurrences / 0.1085 percentage points**. TRAIN recall and candidate memberships are unchanged. Across all **31,578 source-only rows**, the feature adds three raw and three proposal memberships and removes none; all three additions are the audited CALIBRATION calls.

Each target row gains one candidate containing `src/app/report/[scan_id]/page.tsx#PrivateReportPage`. The candidate result remains **ambiguous / uncalibrated-signature**, with **no selected target**, `candidateSetComplete=false`, and strict proof **abstained**. This does not authorize skipping Tier B or make a calibrated selection.

The runner reads labels only through the isolated TRAIN and CALIBRATION loaders. TEST and TEMPORAL rows are included only for source-only membership comparison; their labels and all System One artifacts are not read.

## Contract and source boundary

The AST worker now retains the default binding in an ordinary static combined import such as `import Page, { metadata } from "./page"`, and emits a typed direct-export descriptor for `export default function Named() {}` or `export default function () {}`. Candidate generation requires one hash-bound, direct, workspace-local target path, exactly one default export descriptor of type `function`, and exactly one matching top-level function declaration. Anonymous direct default functions receive a stable `#default` candidate key.

These descriptors are candidate-only. `ScopeResolver` receives the legacy import projection, and Phase 6 plus `EdgeComputer.buildScopeMap()` skip `isCombinedDefaultImport`; the default-export descriptors remain inputs only to the call-resolution hypothesis index. `ScopeResolver` itself is unchanged. A real-parser/GraphStore regression fixture covers combined and standalone default imports, default function/class/expression exports, calls, and an unused combined import; its enriched and HEAD-shaped projections persist identical nodes and links.

The feature abstains for multiple default descriptors; default expressions, objects and classes; local-binding aliases such as `function Page() {}; export default Page`; barrels and re-exports; `export =` and CommonJS; dynamic import and `require`; ambiguous extensions or paths; inherited/unsupported path configuration; type-only imports; and paths outside the workspace root. Namespace imports and standalone default imports retain their existing fallback behavior. The parser still reports a default class descriptor for diagnostics, but candidate generation does not treat it as a callable function.

Candidate generator identity is **declared-member-hypothesis-v6**. Ranking remains **ordered-evidence-v1**; `maxCandidates` remains **25**. Filters, thresholds, calibration records, strict proof, and Tier B behavior are unchanged. `candidateSetComplete` remains false for the measured results.

## Measurements

Recall uses confirmed unique-mappable positive target occurrences. Candidate size and zero counts retain every row in each split, including unscorable and source-position-excluded rows: TRAIN **13,496** and CALIBRATION **2,966**.

| Split       | Stage    | Gold denominator | Slice A covered / recall | Slice B covered / recall | Gain |
| ----------- | -------- | ---------------: | ------------------------ | ------------------------ | ---: |
| TRAIN       | raw      |           12,177 | 12,170 / 99.9425%        | 12,170 / 99.9425%        |   +0 |
| TRAIN       | proposal |           12,177 | 12,149 / 99.7701%        | 12,149 / 99.7701%        |   +0 |
| CALIBRATION | raw      |            2,766 | 2,763 / 99.8915%         | 2,766 / 100%             |   +3 |
| CALIBRATION | proposal |            2,766 | 2,763 / 99.8915%         | 2,766 / 100%             |   +3 |

The full source-only comparison includes 13,496 TRAIN, 2,966 CALIBRATION, 12,422 TEST, and 2,694 TEMPORAL rows. It finds **3 raw additions, 0 raw removals, 3 proposal additions, and 0 proposal removals** across all 31,578 rows. TEST/TEMPORAL are not scored and have no labels in this run.

| Split       | Stage    | Key zero sites A → B | Mapped zero sites A → B | Key p50/p95/max | Mapped p50/p95/max |
| ----------- | -------- | -------------------: | ----------------------: | --------------- | ------------------ |
| TRAIN       | raw      |            468 → 468 |               833 → 833 | 1/64/118        | 1/35/96            |
| TRAIN       | proposal |            468 → 468 |               894 → 894 | 1/25/25         | 1/12/25            |
| CALIBRATION | raw      |            180 → 177 |               180 → 177 | 1/23/35         | 1/14/17            |
| CALIBRATION | proposal |            180 → 177 |               183 → 180 | 1/3/25          | 1/3/8              |

The three exact CALIBRATION rows at source positions `111:21`, `128:27`, and `150:27` move from zero candidates to one candidate, each containing the unique gold target in both raw and proposal stages. No other source-only row changes.

## Reproduction and integrity

The paired runner replays Slice A with combined-default descriptors suppressed, verifies those TRAIN/CALIBRATION candidate sets against the pinned Slice A replay, and enables the descriptors only for the Slice B feature pass. It validates source and fact pins before loading labels, then loads the complete authorized split only through `labelsForSplitIsolated`. The pinned source-only v4 predictions declare `labelsRead=false`. No test/temporal labels or System One artifacts are read.

```bash
node --import tsx scripts/semantic-corpus/phase2-tiered-call-resolution-configured-alias-impact.mts --default-import
```

- [Reviewable impact summary](tiered-call-resolution-phase2-p2a-default-import-feature-b-evidence/default-import-impact-summary.json): SHA-256 `d4ce88988d339f031f5d67b8e83a9723f85d35904227e85d5af0cff47c4ddbf7`.
- [Artifact manifest](tiered-call-resolution-phase2-p2a-default-import-feature-b-evidence/artifact-manifest.json): SHA-256 `44cb3e8719f2022bd77e89723b065d26b5f9cbf62b1673ec1518ea409e3dcfd1`.
- Source-only paired replay: `evaluate/results/semantic-corpus/v1/phase2-p2a-v6-default-import-impact/default-import-paired-replay.jsonl`, 31,578 rows, SHA-256 `376b702315470063d1484a60f47e124a3dfc89c1ddf7138538b5e3170f9ce7b3`.
- Final implementation fingerprint: `1fa35dfbdb6b447861fd06689489fe5be5c926a566f32c37226c4eb7a938a813`.
- Final runner SHA-256: `566186b2fd034cfd3df66800a82c1162e4c2053427b4e01c379c18ef48970bfd`.
- Pinned Slice A baseline replay SHA-256: `c1147a42d82855d50c59e8ddd2a2215d91c58de805536d3dcce51e232c0cbc64`.
- TRAIN isolated label-row hash: `4983b8bd52ca2c8048fd5fc9a5f4b8efdb6f7d48843740044e097e7901f9f62a`.
- CALIBRATION isolated label-row hash: `5b2892aa4be1ea53c76ff6dc189c0c78c3bf3d83af61639cbd1c59716710c426`.

The host reported no swap I/O and 69% system-wide free memory after the replay. The sandbox denied process inspection, so per-process peak RSS was unavailable. The Slice A feature document is not listed in `SUMMARY.md`; this document is therefore not added to that summary.

## Graph-output parity

The parity audit archived commit `9ad485c10272584f05679698ec5309d8c2daecad`, parsed its 882 discoverable source files with the working AST worker, then persisted the same results twice with `CallResolutionHypothesisService` enabled: once with the exact HEAD-shaped AST output (combined-default descriptors and default-export descriptors removed, as they are absent in HEAD) and once with enriched results. Stable node rows and `node_links` were compared as sorted multisets keyed by `node_key`; generated SQLite row ids and timestamps were excluded. Both projections have **16,436 nodes** and **33,510 links**, with matching SHA-256 hashes and empty exact node/link set diffs. There were zero parse failures. Link counts match by type: `contains` 15,554; `calls` 13,974; `depends_on` 464; `implements` 43; `extends` 28; `imports` 3,447. Peak RSS was **1,880,129,536 bytes** (1.75 GiB).

That committed source snapshot contains eight default-export descriptors and no combined-default import descriptors, so the fixture parity test covers the combined-import call/import regression directly. The persisted-node hash is `719c34c6a0d07a633c126f2e0dd08767278c4be4a24a72d8b4bbe0ec20f73147`; the node-link hash is `2fe4d0f7f665298ddb5468096e9ab2ac4a885770b7fc4495a67ac350d85e04d8`. The machine-readable [whole-graph parity summary](tiered-call-resolution-phase2-p2a-default-import-feature-b-evidence/whole-graph-parity-summary.json) has SHA-256 `e99c918fb09fd1c9663600fc92f800e39c0e47774f4f631da9ee61ea54da58c7`; the [parity runner](../../../scripts/semantic-corpus/phase2-default-import-graph-parity.mts) has SHA-256 `00a0e3aa9db958bafedd8edd01ee00827a7c49742479037ef5dab935559ea3ea` and can reproduce the audit from an archive of the baseline commit.
