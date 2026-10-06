# P2-A CALIBRATION raw-loss pinned-source audit

## Findings

All **16** CALIBRATION raw-generation losses are ordinary static import cases in pinned repomind source. **13** use renamed named imports through the explicit `@/* → ./src/*` configuration and point to direct named top-level function exports. **Three** call the default binding in a combined default-plus-named import; the worker omits that default import descriptor and the target’s direct default-function export descriptor, leaving the exact call fact’s binding `unbound`. No row requires whole-program type inference, dynamic import execution, a barrel/re-export traversal, or an inferred alias convention.

This commit records source evidence only. Current fallback remains appropriate until each missing capability is implemented with source-backed ambiguity gates. The next two feature slices are separate: **A)** configured-path named-import candidates; **B)** combined-default import and unique direct `export default function` descriptors/candidates. They must keep existing candidate order, cap/filter policy, and ranking behavior, and measure TRAIN and CALIBRATION separately. Multiple matching aliases/exports, ambiguous paths, barrels/re-exports, unresolved config inheritance, or non-function/default-expression targets must retain fallback.

## Boundary and reproducibility

The audit uses only the verified CALIBRATION cap summary, its exact CALIBRATION replay, source-only facts, and `git show` at revision `6a46bb25a132f3bb35da76ef678b99718e37c2f5`. No new labels are opened: the 16 target IDs are copied from the pinned CALIBRATION summary whose labels were loaded through the isolated loader. No run-c corpus manifest, test/temporal labels, or System One artifact is read. The complete 2,966-site/2,766-unique-positive denominators and 2,750 covered targets remain the [cap report’s original result](tiered-call-resolution-phase2-p2a-calibration-cap-sensitivity.md); this source audit does not rescore or change them.

The runner reads exactly **13 unique caller/target files** (six callers, seven targets), plus pinned `tsconfig.json`. Caller hashes match the committed replay; all 13 code hashes match corrected fact rows. It reparses those 13 files, with **zero failures**, and matches **16/16 exact `(0-based line, column, calleeName)` facts** and **16/16 original callsite input hashes**. Each unique gold target is exactly one top-level function declaration. Production/replay implementation hashes must also match before parsing.

```bash
PATH=/Users/daniel.chang/.nvm/versions/node/v24.14.1/bin:$PATH pnpm exec tsx scripts/semantic-corpus/phase2-tiered-call-resolution-calibration-miss-source-audit.mts
```

Run at this audit’s source revision; later parser or candidate changes intentionally fail its implementation/fact pins. The runner accepts no path/split overrides and writes only to ignored results. The committed [source evidence artifact](tiered-call-resolution-phase2-p2a-calibration-miss-source-evidence/calibration-miss-source-summary.json) is byte-identical to its output.

## Configured named imports: 13 rows

Pinned [tsconfig.json](https://github.com/403errors/repomind/blob/6a46bb25a132f3bb35da76ef678b99718e37c2f5/tsconfig.json) contains exactly `compilerOptions.paths: { "@/*": ["./src/*"] }`, with no `baseUrl` or `extends`. The config SHA-256 is `235139181c8ebfc0f1f6cb07771d00cabed961d7c41469c9ef6b3cb04f86d6ef`. Each imported module path expands to the exact target file, and that target has one direct exported function with the import descriptor’s original name. All 13 worker callee bindings are `import` and all descriptors are single named, non-type-only, non-re-export imports. The current v4 enrichment resolves only relative module paths, so these configured paths are rejected before alias enrichment.

| Local callee                      | Imported original           | Module path                       | Rows |
| --------------------------------- | --------------------------- | --------------------------------- | ---: |
| `createScanShareLinkRecord`       | `createScanShareLink`       | `@/lib/services/scan-share-links` |    2 |
| `resolveScanFromShareTokenRecord` | `resolveScanFromShareToken` | `@/lib/services/scan-share-links` |    1 |
| `buildFindingFingerprint`         | `findingFingerprint`        | `@/lib/services/report-service`   |    6 |
| `_searchRepositoryCode`           | `searchRepositoryCode`      | `@/lib/services/artifact-service` |    1 |
| `_getRecentSearches`              | `getRecentSearches`         | `@/lib/services/history-service`  |    1 |
| `_getRepoSuggestions`             | `getRepoSuggestions`        | `@/lib/services/repo-suggestions` |    1 |
| `deletePostFromDb`                | `deletePost`                | `@/lib/services/blog-service`     |    1 |

These seven distinct local/original-name pairs account for 13 calls; `buildFindingFingerprint → findingFingerprint` appears in four caller files and six rows. A safe cheap candidate rule can consume explicit, hash-bound config evidence and require one root-local path, one non-type-only import binding, one direct function export, and one source declaration. It must not infer `@/` semantics from spelling or file layout.

## Combined default import/export descriptors: three rows

The pinned [caller import](https://github.com/403errors/repomind/blob/6a46bb25a132f3bb35da76ef678b99718e37c2f5/src/app/report/[scan_id]/page.test.tsx#L54) is:

```ts
import ReportPage, { generateMetadata } from "@/app/report/[scan_id]/page";
```

The pinned [target declaration](https://github.com/403errors/repomind/blob/6a46bb25a132f3bb35da76ef678b99718e37c2f5/src/app/report/[scan_id]/page.tsx#L94) is a direct `export default async function PrivateReportPage(...)`. The worker emits the three exact `ReportPage(...)` call facts at zero-based positions **111:21, 128:27, and 150:27**, but emits **zero import descriptors for `ReportPage`**, sets its binding to **unbound**, and emits **no default export descriptor** for `PrivateReportPage`. The named `generateMetadata` export remains present. The target function declaration itself exists in declared facts.

This is a missing import/export descriptor pair around supported static syntax, with an exact call fact present. It is distinct from the TRAIN source-position exclusions. Correcting the binding alone would not supply the configured-path/default-target candidate; slice B must follow slice A and require a unique direct default function export. Namespace imports, default expressions/classes, conflicting exports, and re-exported defaults remain fallback.

## Every affected callsite and target

All rows below have zero raw keys and `firstLossStage=raw-generation`. Links use one-based source lines; displayed corpus coordinates are zero-based. Per-row caller/target hashes, exact worker facts, descriptors, target declarations, and input hashes are retained in the artifact.

| Caller (0-based line:column; links use 1-based lines)                                                                                                                                                          | Unique target                                                    | Classification                                |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | --------------------------------------------- |
| [src/app/actions.ts:1027:23](https://github.com/403errors/repomind/blob/6a46bb25a132f3bb35da76ef678b99718e37c2f5/src/app/actions.ts#L1028)                                                                     | `src/lib/services/scan-share-links.ts#createScanShareLink`       | configured-path-named-import-gap              |
| [src/app/actions.ts:1043:11](https://github.com/403errors/repomind/blob/6a46bb25a132f3bb35da76ef678b99718e37c2f5/src/app/actions.ts#L1044)                                                                     | `src/lib/services/scan-share-links.ts#resolveScanFromShareToken` | configured-path-named-import-gap              |
| [src/app/actions.ts:1065:23](https://github.com/403errors/repomind/blob/6a46bb25a132f3bb35da76ef678b99718e37c2f5/src/app/actions.ts#L1066)                                                                     | `src/lib/services/scan-share-links.ts#createScanShareLink`       | configured-path-named-import-gap              |
| [src/app/actions.ts:1107:24](https://github.com/403errors/repomind/blob/6a46bb25a132f3bb35da76ef678b99718e37c2f5/src/app/actions.ts#L1108)                                                                     | `src/lib/services/report-service.ts#findingFingerprint`          | configured-path-named-import-gap              |
| [src/app/actions.ts:1251:11](https://github.com/403errors/repomind/blob/6a46bb25a132f3bb35da76ef678b99718e37c2f5/src/app/actions.ts#L1252)                                                                     | `src/lib/services/artifact-service.ts#searchRepositoryCode`      | configured-path-named-import-gap              |
| [src/app/actions.ts:1257:11](https://github.com/403errors/repomind/blob/6a46bb25a132f3bb35da76ef678b99718e37c2f5/src/app/actions.ts#L1258)                                                                     | `src/lib/services/history-service.ts#getRecentSearches`          | configured-path-named-import-gap              |
| [src/app/actions.ts:435:11](https://github.com/403errors/repomind/blob/6a46bb25a132f3bb35da76ef678b99718e37c2f5/src/app/actions.ts#L436)                                                                       | `src/lib/services/repo-suggestions.ts#getRepoSuggestions`        | configured-path-named-import-gap              |
| [src/app/admin/blog/actions.ts:27:8](https://github.com/403errors/repomind/blob/6a46bb25a132f3bb35da76ef678b99718e37c2f5/src/app/admin/blog/actions.ts#L28)                                                    | `src/lib/services/blog-service.ts#deletePost`                    | configured-path-named-import-gap              |
| [src/app/report/[scan\_id]/page.test.tsx:111:21](https://github.com/403errors/repomind/blob/6a46bb25a132f3bb35da76ef678b99718e37c2f5/src/app/report/[scan_id]/page.test.tsx#L112)                              | `src/app/report/[scan_id]/page.tsx#PrivateReportPage`            | combined-default-import-export-descriptor-gap |
| [src/app/report/[scan\_id]/page.test.tsx:128:27](https://github.com/403errors/repomind/blob/6a46bb25a132f3bb35da76ef678b99718e37c2f5/src/app/report/[scan_id]/page.test.tsx#L129)                              | `src/app/report/[scan_id]/page.tsx#PrivateReportPage`            | combined-default-import-export-descriptor-gap |
| [src/app/report/[scan\_id]/page.test.tsx:150:27](https://github.com/403errors/repomind/blob/6a46bb25a132f3bb35da76ef678b99718e37c2f5/src/app/report/[scan_id]/page.test.tsx#L151)                              | `src/app/report/[scan_id]/page.tsx#PrivateReportPage`            | combined-default-import-export-descriptor-gap |
| [src/lib/services/\_\_tests\_\_/fix-verification.test.ts:175:28](https://github.com/403errors/repomind/blob/6a46bb25a132f3bb35da76ef678b99718e37c2f5/src/lib/services/__tests__/fix-verification.test.ts#L176) | `src/lib/services/report-service.ts#findingFingerprint`          | configured-path-named-import-gap              |
| [src/lib/services/fix-verification.ts:103:21](https://github.com/403errors/repomind/blob/6a46bb25a132f3bb35da76ef678b99718e37c2f5/src/lib/services/fix-verification.ts#L104)                                   | `src/lib/services/report-service.ts#findingFingerprint`          | configured-path-named-import-gap              |
| [src/lib/services/fix-verification.ts:131:21](https://github.com/403errors/repomind/blob/6a46bb25a132f3bb35da76ef678b99718e37c2f5/src/lib/services/fix-verification.ts#L132)                                   | `src/lib/services/report-service.ts#findingFingerprint`          | configured-path-named-import-gap              |
| [src/lib/services/security-verification.ts:765:36](https://github.com/403errors/repomind/blob/6a46bb25a132f3bb35da76ef678b99718e37c2f5/src/lib/services/security-verification.ts#L766)                         | `src/lib/services/report-service.ts#findingFingerprint`          | configured-path-named-import-gap              |
| [src/lib/services/security-verification.ts:808:28](https://github.com/403errors/repomind/blob/6a46bb25a132f3bb35da76ef678b99718e37c2f5/src/lib/services/security-verification.ts#L809)                         | `src/lib/services/report-service.ts#findingFingerprint`          | configured-path-named-import-gap              |

### Unique source-file hashes

| Pinned source path                                    | SHA-256                                                            |
| ----------------------------------------------------- | ------------------------------------------------------------------ |
| `src/app/actions.ts`                                  | `3210cc74f578d9f4a1dd81b094cd7b0b6b29fbe7c153fa5b26a5f465af852e6b` |
| `src/lib/services/scan-share-links.ts`                | `3dcbf9e1190f258689dfe4ae081b7c829c29a63d30f4c53b750f892bfe7395dd` |
| `src/lib/services/report-service.ts`                  | `445abe678cd0e992964e2924a4d3616e93aee24d9d4e8754d3d61d055f5a7ca7` |
| `src/lib/services/artifact-service.ts`                | `8714e13e743393b863ffbbc83aeedde956b5b486975d43c6c6c3e924bafa7183` |
| `src/lib/services/history-service.ts`                 | `29bc8e52369f0d31007c1df5b6b63d91fcc5b4a6a089b6bfd7e3cb0cb8fcf2b4` |
| `src/lib/services/repo-suggestions.ts`                | `29c1d0b9e535dd02e6de42d00f099f51fa5050ff37c5694a6b3ed3504a445273` |
| `src/app/admin/blog/actions.ts`                       | `66ab3350e435a1af8655026d1ee3807238b5605817e98ac8e221215be1945791` |
| `src/lib/services/blog-service.ts`                    | `d071188cadce17d46308d09c148d5c7603bc1835358105e351c860404be11dd6` |
| `src/app/report/[scan_id]/page.test.tsx`              | `34504c9b5a21a3a5c9a9fea506794722123bc1bddf7944ba79509a66d4c3e773` |
| `src/app/report/[scan_id]/page.tsx`                   | `a7d138e127b9706374fabad9a4452a6e654a13cef5377da93dc00a7fb14b248c` |
| `src/lib/services/__tests__/fix-verification.test.ts` | `5e1d36183c315dc0abe03fe7a4b55eb3e137429483187991126cc4e2f6a183d5` |
| `src/lib/services/fix-verification.ts`                | `676c552218094c9771804493dff5f1e937a8aea68a8bf57b3d410169fec3deb0` |
| `src/lib/services/security-verification.ts`           | `2ce620b69734a422e1e0a6f00687d66c0318a01ad042f21543b2aa1e9edf1117` |

## Artifact and gates

| Evidence                                        | SHA-256                                                            |
| ----------------------------------------------- | ------------------------------------------------------------------ |
| Source audit artifact                           | `b6aa476ed9ea827ca40f6af87bde5cbad9148ee6c68f739fbb6b99ae1fd013c7` |
| Audit runner                                    | `866b1464749fa86739b5cff779204af13793c83ab5a3c18a75eeb31e20790078` |
| Input CALIBRATION cap summary                   | `afe3d04099ca83ab5330962a638aeb1367cf6e0947f1a5697928653219f1b13f` |
| Isolated CALIBRATION label rows (prior summary) | `5b2892aa4be1ea53c76ff6dc189c0c78c3bf3d83af61639cbd1c59716710c426` |
| Original CALIBRATION replay                     | `a54ea61858e9025b53468a94fbe25e7ecb18319913e15e4fbf66463969e33e02` |
| Corrected source facts                          | `ba7b631b36ed05b1f16c6b500b0c17b5e4273acd939a493800848225c4dad14e` |
| Sixteen exact parser input tuples               | `759d07598f33cbdf50bd310ad14698057edc4932a2f0513bcd7a0e33b20a14dd` |

TDD started with a missing-module RED run. Four focused fixtures validate the two exact source classifications, ambiguous/unmatched configuration rejection, and refusal to infer a default binding from an unbound call fact alone. Focused source/cap/TRAIN-stage suites passed **18/18**; explicit runner and repository typecheck, build, lint, and diff checks passed. Repeated source audits produced byte-identical artifacts. The normal pre-push hook runs the full suite and HEAD-based category/weak-assertion gates; its exact outcome accompanies the pushed commit. No production code, ranker, threshold, calibration promotion, strict proof, or Tier B policy is changed.
