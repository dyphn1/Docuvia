# P2-A Feature A: configured named-import path aliases

## Result and scope

Feature A adds the 13 audited CALIBRATION named-import targets. Raw and ordered-proposal recall rise from **2,750/2,766 (99.4215%) to 2,763/2,766 (99.8915%)**, a gain of **13 occurrences / 0.4700 percentage points**. Each affected site changes from zero candidates to one candidate containing its unique gold target. TRAIN candidate memberships and coverage are unchanged. No existing raw candidate, proposal, or covered gold occurrence is removed in either split. Existing candidate order is preserved.

This evidence supports the narrow configured-path rule while keeping **maxCandidates=25**, existing filters and ranking policy. The three combined default+named import/unique default-function descriptor gaps remain for a separate slice. All 13 new results remain **ambiguous / uncalibrated-signature**, with **no selected target** and strict proof **abstained**. Candidate availability is not certification or calibrated selection.

## Contract and source boundary

`CallResolutionHypothesisWorkspaceInput.configuredPathAliases` is optional typed configuration evidence: root config path, exact byte SHA-256, paths, baseUrl and extends. The source harness reads and parses root `tsconfig.json` once when explicitly opted in. The core performs no configuration filesystem reads. It snapshots and freezes the evidence and conditionally includes it in the bound source fingerprint; omitting the field preserves the previous source-fingerprint algorithm. Configuration changes also change `featureInputHash`. The opaque workspace handle exposes no configuration object. `sourceIndexComplete` semantics remain unchanged.

The new branch accepts only root `tsconfig.json`, exactly `@/* -> ./src/*`, absent baseUrl/inheritance, one matching indexed source path and one direct named top-level function export. It retains the existing named-rename descriptor and import-binding checks. Missing/stale evidence, multiple mapping patterns/targets, extension ambiguity, duplicate source paths/exports, barrels/re-exports, type-only/shadowed imports, arrow/default targets, traversal and encoded/query/fragment paths retain fallback. JSONC and invalid config shapes leave evidence unavailable. Existing relative-import behavior remains unchanged.

Pinned repomind config: [tsconfig.json](https://github.com/403errors/repomind/blob/6a46bb25a132f3bb35da76ef678b99718e37c2f5/tsconfig.json), SHA-256 `235139181c8ebfc0f1f6cb07771d00cabed961d7c41469c9ef6b3cb04f86d6ef`. The [16-row pinned source audit](tiered-call-resolution-phase2-p2a-calibration-miss-source-audit.md) provides exact callers, targets, descriptors and hashes. Nest config facts contain multiple patterns and produce no new candidates. Other measured snapshots provide no accepted configured mapping.

Candidate generator identity is **declared-member-hypothesis-v5**. Ranking policy remains **ordered-evidence-v1**. The existing configuration-hash formula includes generator version, so its identity changes from v4 despite unchanged ranking weights, cap, filters and thresholds. A hash-valid synthetic v4 calibration record is rejected by the existing version gate; no calibration records are generated or promoted in this slice. P2-B evidence for v5 requires a later TRAIN/CALIBRATION run.

## Measurements

Recall uses confirmed unique-mappable positive target occurrences. Size and zero counts retain every sample ID, including unscorable/abstaining rows: TRAIN **13,496** and CALIBRATION **2,966**. The machine artifact contains complete count distributions and family × shape × evidence breakdowns.

| Split       | Stage    | Gold denominator | Baseline covered / recall | Feature covered / recall | Gain |
| ----------- | -------- | ---------------: | ------------------------- | ------------------------ | ---: |
| TRAIN       | raw      |           12,177 | 12,170 / 99.9425%         | 12,170 / 99.9425%        |   +0 |
| TRAIN       | proposal |           12,177 | 12,149 / 99.7701%         | 12,149 / 99.7701%        |   +0 |
| CALIBRATION | raw      |            2,766 | 2,750 / 99.4215%          | 2,763 / 99.8915%         |  +13 |
| CALIBRATION | proposal |            2,766 | 2,750 / 99.4215%          | 2,763 / 99.8915%         |  +13 |

TRAIN preserves the original position-gated replay: **7 source-position exclusions**, **13,489 exact service requests**, zero additional missing parser facts. The seven tagged-template capability probes in the [TRAIN source audit](tiered-call-resolution-phase2-p2a-candidate-stage-train-audit.md) are a separate measurement and are not merged here. They are source-oracle/replay exclusions, not seven generator losses. CALIBRATION has **0 exclusions, 2,966 exact parser requests, 0 missing facts**. Source and call-input hashes are retained for every eligible request. No product resolver gate or replay eligibility policy changes.

| Split       | Stage    | Key memberships baseline → feature | Unique mapped memberships baseline → feature | Key zero sites baseline → feature | Mapped zero sites baseline → feature | Key p50/p95/max (unchanged) | Mapped p50/p95/max (unchanged) |
| ----------- | -------- | ---------------------------------: | -------------------------------------------: | --------------------------------: | -----------------------------------: | --------------------------- | ------------------------------ |
| TRAIN       | raw      |                  137,469 → 137,469 |                              89,589 → 89,589 |                         468 → 468 |                            833 → 833 | 1/64/118                    | 1/35/96                        |
| TRAIN       | proposal |                    44,060 → 44,060 |                              31,412 → 31,412 |                         468 → 468 |                            894 → 894 | 1/25/25                     | 1/12/25                        |
| CALIBRATION | raw      |                    11,854 → 11,867 |                                9,737 → 9,750 |                         193 → 180 |                            193 → 180 | 1/23/35                     | 1/14/17                        |
| CALIBRATION | proposal |                      3,999 → 4,012 |                                3,802 → 3,815 |                         193 → 180 |                            196 → 183 | 1/3/25                      | 1/3/8                          |

CALIBRATION adds exactly **13 raw and 13 proposal key memberships**, each uniquely mapped; TRAIN adds zero. The only frequency changes are 13 CAL sites moving **0 → 1** in all four key/mapped distributions. The 200 CAL and 1,319 TRAIN unscorable sites remain in size/zero denominators. Corpus replay wall time is not a resolver latency measurement; this slice adds no latency claim.

### CALIBRATION family × shape × evidence

| Family                        | Shape  | Evidence                         | All sites | Gold occurrences | Raw covered baseline → feature | Proposal covered baseline → feature |
| ----------------------------- | ------ | -------------------------------- | --------: | ---------------: | -----------------------------: | ----------------------------------: |
| 403errors/repomind            | bare   | callee-import                    |      1198 |             1187 |                    1174 → 1187 |                         1174 → 1187 |
| 403errors/repomind            | bare   | callee-unbound                   |         6 |                6 |                          3 → 3 |                               3 → 3 |
| 403errors/repomind            | member | receiver-unbound-without-peers   |         3 |                3 |                          3 → 3 |                               3 → 3 |
| Egonex-AI/Understand-Anything | bare   | callee-import                    |      1018 |              835 |                      835 → 835 |                           835 → 835 |
| Egonex-AI/Understand-Anything | member | receiver-field-without-peers     |         3 |                3 |                          3 → 3 |                               3 → 3 |
| Egonex-AI/Understand-Anything | member | receiver-local-with-peers        |       203 |              200 |                      200 → 200 |                           200 → 200 |
| Egonex-AI/Understand-Anything | member | receiver-local-without-peers     |       498 |              495 |                      495 → 495 |                           495 → 495 |
| Egonex-AI/Understand-Anything | member | receiver-parameter-with-peers    |         5 |                5 |                          5 → 5 |                               5 → 5 |
| Egonex-AI/Understand-Anything | member | receiver-parameter-without-peers |        18 |               18 |                        18 → 18 |                             18 → 18 |
| Egonex-AI/Understand-Anything | member | receiver-unbound-without-peers   |        14 |               14 |                        14 → 14 |                             14 → 14 |

### Exact changed rows

Positions below are **1-based line:column**; pinned source links use 1-based line numbers. Artifact positions remain explicitly the original 0-based corpus coordinates. Per-row sample IDs, source/input/feature hashes, added keys, unique targets and outcome facts are in the machine artifact. Every row below adds one raw/proposal key and one covered gold occurrence.

| Caller (1-based position; links use 1-based lines)                                                                                                                                                             | Callee → direct exported target                                                                      |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| [src/app/actions.ts:1028:24](https://github.com/403errors/repomind/blob/6a46bb25a132f3bb35da76ef678b99718e37c2f5/src/app/actions.ts#L1028)                                                                     | `createScanShareLinkRecord` → `src/lib/services/scan-share-links.ts#createScanShareLink`             |
| [src/app/actions.ts:1044:12](https://github.com/403errors/repomind/blob/6a46bb25a132f3bb35da76ef678b99718e37c2f5/src/app/actions.ts#L1044)                                                                     | `resolveScanFromShareTokenRecord` → `src/lib/services/scan-share-links.ts#resolveScanFromShareToken` |
| [src/app/actions.ts:1066:24](https://github.com/403errors/repomind/blob/6a46bb25a132f3bb35da76ef678b99718e37c2f5/src/app/actions.ts#L1066)                                                                     | `createScanShareLinkRecord` → `src/lib/services/scan-share-links.ts#createScanShareLink`             |
| [src/app/actions.ts:1108:25](https://github.com/403errors/repomind/blob/6a46bb25a132f3bb35da76ef678b99718e37c2f5/src/app/actions.ts#L1108)                                                                     | `buildFindingFingerprint` → `src/lib/services/report-service.ts#findingFingerprint`                  |
| [src/app/actions.ts:1252:12](https://github.com/403errors/repomind/blob/6a46bb25a132f3bb35da76ef678b99718e37c2f5/src/app/actions.ts#L1252)                                                                     | `_searchRepositoryCode` → `src/lib/services/artifact-service.ts#searchRepositoryCode`                |
| [src/app/actions.ts:1258:12](https://github.com/403errors/repomind/blob/6a46bb25a132f3bb35da76ef678b99718e37c2f5/src/app/actions.ts#L1258)                                                                     | `_getRecentSearches` → `src/lib/services/history-service.ts#getRecentSearches`                       |
| [src/app/actions.ts:436:12](https://github.com/403errors/repomind/blob/6a46bb25a132f3bb35da76ef678b99718e37c2f5/src/app/actions.ts#L436)                                                                       | `_getRepoSuggestions` → `src/lib/services/repo-suggestions.ts#getRepoSuggestions`                    |
| [src/app/admin/blog/actions.ts:28:9](https://github.com/403errors/repomind/blob/6a46bb25a132f3bb35da76ef678b99718e37c2f5/src/app/admin/blog/actions.ts#L28)                                                    | `deletePostFromDb` → `src/lib/services/blog-service.ts#deletePost`                                   |
| [src/lib/services/\_\_tests\_\_/fix-verification.test.ts:176:29](https://github.com/403errors/repomind/blob/6a46bb25a132f3bb35da76ef678b99718e37c2f5/src/lib/services/__tests__/fix-verification.test.ts#L176) | `buildFindingFingerprint` → `src/lib/services/report-service.ts#findingFingerprint`                  |
| [src/lib/services/fix-verification.ts:104:22](https://github.com/403errors/repomind/blob/6a46bb25a132f3bb35da76ef678b99718e37c2f5/src/lib/services/fix-verification.ts#L104)                                   | `buildFindingFingerprint` → `src/lib/services/report-service.ts#findingFingerprint`                  |
| [src/lib/services/fix-verification.ts:132:22](https://github.com/403errors/repomind/blob/6a46bb25a132f3bb35da76ef678b99718e37c2f5/src/lib/services/fix-verification.ts#L132)                                   | `buildFindingFingerprint` → `src/lib/services/report-service.ts#findingFingerprint`                  |
| [src/lib/services/security-verification.ts:766:37](https://github.com/403errors/repomind/blob/6a46bb25a132f3bb35da76ef678b99718e37c2f5/src/lib/services/security-verification.ts#L766)                         | `buildFindingFingerprint` → `src/lib/services/report-service.ts#findingFingerprint`                  |
| [src/lib/services/security-verification.ts:809:29](https://github.com/403errors/repomind/blob/6a46bb25a132f3bb35da76ef678b99718e37c2f5/src/lib/services/security-verification.ts#L809)                         | `buildFindingFingerprint` → `src/lib/services/report-service.ts#findingFingerprint`                  |

## Reproduction and integrity

The runner accepts no split/path overrides. It verifies source-only v4 prediction provenance, complete pinned TRAIN/CAL ID populations and matching snapshot/fact hashes. No-config replay reproduces every v4 decision field after excluding only the intentionally versioned rule signature. Existing order and raw memberships are asserted for both variants. Labels are loaded only after all paired source replays pass, through `labelsForSplitIsolated` for the complete authorized split. TRAIN and CAL use their existing, differently ordered ID-hash conventions; the hashes are preserved. No run-c corpus manifest, test/temporal labels or System One outcomes are read.

```bash
PATH=/Users/daniel.chang/.nvm/versions/node/v24.14.1/bin:$PATH pnpm exec tsx scripts/semantic-corpus/phase2-tiered-call-resolution-configured-alias-impact.mts
```

- [Reviewable artifact](tiered-call-resolution-phase2-p2a-configured-path-alias-feature-a-evidence/configured-alias-impact-summary.json): SHA-256 `d1c7bda4a593f5affe80a7eb2a5c74e28a2f641e822fba73264895c313b61af3`.
- Runner SHA-256: `3e65bd9fcf14f287c45a76557a42982b6d1c9a02cfed34d6b2b765e16054cb17`.
- Implementation fingerprint: `d7b566b43d43a9400e78ae430fb97542cde7f1e4e1e148e956be6252944f2a56`.
- v5 configuration hash: `b9359c21c2b5f0e23f471c0f34f6074f0e1d9d8dd2646c2a2e5c8b1f1d878d5e`; v4 hash: `e09018b7f5abca2e246fd1b6a9c7e078d6972b0a66fa54b67c2eeabc17437fdd`.
- Ignored paired replay: `evaluate/results/semantic-corpus/v1/phase2-p2a-v5-configured-alias-impact/configured-alias-paired-replay.jsonl`, 16,462 rows, SHA-256 `c1147a42d82855d50c59e8ddd2a2215d91c58de805536d3dcce51e232c0cbc64`.
- TRAIN isolated label-row hash: `4983b8bd52ca2c8048fd5fc9a5f4b8efdb6f7d48843740044e097e7901f9f62a`.
- CALIBRATION isolated label-row hash: `5b2892aa4be1ea53c76ff6dc189c0c78c3bf3d83af61639cbd1c59716710c426`.

Historical v4 audit runners retain their implementation pins. Reproduce them at their original commits; this feature does not rewrite old v4 measurements or loosen TRAIN-only trace guards.

## Validation

RED fixtures first failed on the missing resolver/measurement helpers. Focused parser/core/source/measurement gates pass **44/44 tests in 5 files**. They cover configured resolution, no-config fingerprint compatibility, mutation snapshots, version mismatch, unique/ambiguous paths and exports, fallback syntax/bindings, exact config hashes, split contamination, complete denominators and empty candidate sets.

Repository typecheck, runner TypeScript check, lint and build pass. The final full coverage suite passes **344 files / 3,265 tests**, with **1 file / 7 tests skipped**; overall statement coverage is **91.27%**, branch coverage **87.37%**. Normal pre-push formatting and test-quality/category gates also run before push; exact hook results, commit and CI status accompany the handoff. The graph decision is recorded against the index source. No unrelated runtime tests or quality policy are changed.

```bash
pnpm run typecheck
pnpm run lint
pnpm run build
pnpm run test
pnpm exec vitest run lib/core/src/semantic/call-resolution-configured-path-alias.unit.test.ts lib/core/src/semantic/call-resolution-configured-path-alias.integration.test.ts lib/core/src/semantic/call-resolution-hypothesis.service.integration.test.ts test/semantic-corpus/phase2-tiered-call-resolution-configured-path-alias.unit.test.ts test/semantic-corpus/phase2-tiered-call-resolution-configured-alias-impact.unit.test.ts
```
