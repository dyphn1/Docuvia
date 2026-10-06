# P2-A CALIBRATION candidate cap sensitivity

## Result and recommendation

Keep the production cap at **25**. CALIBRATION candidate recall is **2,750/2,766 (99.4215%)** for raw generation and every proposal cap from 25 through 33. The 16 missing targets are already absent from raw generation; none is lost by the proposal filters or cap. Cap 33 adds 14 proposal-key memberships (+0.3501%) and six unique-mapped memberships (+0.1578%) across two sites, with no additional gold coverage. Both caps exceed #559’s useful ~90% direction; this in-split, two-family result supports investigating the 16 generation losses before enlarging sets. It does not measure candidate precision or certify a rule. Runtime cap, filters, ranking, thresholds, calibration records, proof, and Tier B behavior are unchanged.

## Scope and exact source replay

This analysis loads **CALIBRATION labels only**, through `labelsForSplitIsolated("calibration", completeSampleIds)`, after source replay verifies the complete pinned population and every v4 decision fingerprint. It never opens the run-c corpus manifest, test/temporal labels, or System One artifacts. TRAIN below is descriptive comparison copied from its published audit; this runner does not load TRAIN labels. The existing TRAIN-only capture helpers and guards remain intact. A separate opt-in service subclass captures exact stage identities while invoking the unchanged service.

All **2,966 source sites** remain in candidate-size and zero-set denominators, including abstentions and the **200 unscorable** positive sites (13 ambiguous and 187 unmapped target occurrences). Recall uses **2,766 confirmed, uniquely mappable positive target occurrences**. All 2,966 labels are confirmed, with one unique positive occurrence per scorable site. Quantiles use the nearest-rank definition and include zeros. Mapped sizes deduplicate target IDs within each site; proposal caps apply to exact source keys before that deduplication.

Pinned CALIBRATION replay matched **2,966/2,966** v4 decision fingerprints, configuration, and source fingerprints. It reparsed 119 Understand-Anything caller files and 178 repomind caller files against 302/328 pinned fact-file rows; zero parse failures and no extra import-target files. There are **zero source-position-excluded rows** and **zero missing exact parser facts**; all 2,966 facts join `(caller file, 0-based line, column, calleeName)`. No direct-service bypass or merged capability correction is needed. The exclusion-ID hash is the canonical empty-list hash `4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945`; exact parser-fact input hash is `ef196599b16cdb07c2d5b1b41d76a659c6ee011e6057a10e5c1c8d11650adcd7`.

| Family              | Pinned revision                            | All sites | Source fingerprint                                                 |
| ------------------- | ------------------------------------------ | --------: | ------------------------------------------------------------------ |
| understand-anything | `6df3065f1d8ddc2ce3615314d1d493f36d6b1c80` |     1,759 | `4d404c2a2a93949955a9f436513d32aa12c8c7ba26602d883babe99ad5fdd4a9` |
| repomind            | `6a46bb25a132f3bb35da76ef678b99718e37c2f5` |     1,207 | `adb0c75149e94dcbed7fe56448b47c7bc0b007d5ae1c7a29436b6b88b8b262ad` |

## All-site candidate sets

| Stage           | Covered / unique gold  | Key memberships | Unique-mapped memberships | Key zeros / 2,966 | Mapped zeros / 2,966 | Key p50/p95/max | Mapped p50/p95/max |
| --------------- | ---------------------- | --------------: | ------------------------: | ----------------- | -------------------- | --------------- | ------------------ |
| Raw             | 2,750/2,766 (99.4215%) |          11,854 |                     9,737 | 193 (6.5071%)     | 193 (6.5071%)        | 1/23/35         | 1/14/17            |
| Proposal cap 25 | 2,750/2,766 (99.4215%) |           3,999 |                     3,802 | 193 (6.5071%)     | 196 (6.6082%)        | 1/3/25          | 1/3/8              |
| Proposal cap 33 | 2,750/2,766 (99.4215%) |           4,013 |                     3,808 | 193 (6.5071%)     | 196 (6.6082%)        | 1/3/32          | 1/3/9              |

The 193 raw-key and raw-mapped zero rows include the 16 scorable generation misses and 177 unscorable rows. Three additional proposal-mapped zero rows have nonempty source-key proposals whose targets cannot be uniquely mapped; they remain unscorable. Their parser facts exist. This separates actual generator zeros from oracle mapping zeros.

### Exact cap sweep

Only the prefix of the existing `beforeMaxCandidates` sequence changes. All earlier filters and proposal order remain fixed.

| Cap | Covered gold | Key memberships | Mapped memberships | Key p50/p95/max | Mapped p50/p95/max |
| --: | -----------: | --------------: | -----------------: | --------------- | ------------------ |
|  25 |        2,750 |           3,999 |              3,802 | 1/3/25          | 1/3/8              |
|  26 |        2,750 |           4,001 |              3,804 | 1/3/26          | 1/3/8              |
|  27 |        2,750 |           4,003 |              3,806 | 1/3/27          | 1/3/8              |
|  28 |        2,750 |           4,005 |              3,806 | 1/3/28          | 1/3/8              |
|  29 |        2,750 |           4,007 |              3,806 | 1/3/29          | 1/3/8              |
|  30 |        2,750 |           4,009 |              3,808 | 1/3/30          | 1/3/9              |
|  31 |        2,750 |           4,011 |              3,808 | 1/3/31          | 1/3/9              |
|  32 |        2,750 |           4,013 |              3,808 | 1/3/32          | 1/3/9              |
|  33 |        2,750 |           4,013 |              3,808 | 1/3/32          | 1/3/9              |

Key-zero/mapped-zero counts remain **193/196** at every cap. Cap 33 equals cap 32 because the largest surviving pre-cap sequence has 32 keys. All sizes and membership counts are computed from exact sequences; no extrapolation is used.

| Set size | Cap-25 key sites | Cap-33 key sites | Cap-25 mapped sites | Cap-33 mapped sites |
| -------: | ---------------: | ---------------: | ------------------: | ------------------: |
|        0 |              193 |              193 |                 196 |                 196 |
|        1 |             2241 |             2241 |                2244 |                2244 |
|        2 |              306 |              306 |                 310 |                 310 |
|        3 |              109 |              109 |                 106 |                 106 |
|        4 |               36 |               36 |                  36 |                  36 |
|        5 |               17 |               17 |                  17 |                  17 |
|        6 |               27 |               27 |                  29 |                  27 |
|        7 |                7 |                7 |                   7 |                   7 |
|        8 |               21 |               21 |                  21 |                  21 |
|        9 |                0 |                0 |                   0 |                   2 |
|       23 |                7 |                7 |                   0 |                   0 |
|       25 |                2 |                0 |                   0 |                   0 |
|       32 |                0 |                2 |                   0 |                   0 |

Each frequency column sums to 2,966. The two expanded sites move key size 25→32 and mapped size 6→9. Their existing cap-25 proposals already contain the gold target.

## Family × call shape × syntax evidence

The tables show cap 25. Cap 33 has the same coverage and zero counts for every group. Full raw and cap-25–33 group metrics and frequency distributions are in the linked artifact. `callee-import`/`callee-unbound` are parser binding facts; receiver labels record exact binding kind and whether the same binding has peer-member facts. They do not claim type proof or completeness.

| Family                        | Shape  | All sites | Covered / gold         | Key / mapped zeros | Key p50/p95/max | Mapped p50/p95/max |
| ----------------------------- | ------ | --------: | ---------------------- | ------------------ | --------------- | ------------------ |
| 403errors/repomind            | bare   |      1204 | 1,177/1,193 (98.6588%) | 17/17              | 1/5/25          | 1/5/8              |
| 403errors/repomind            | member |         3 | 3/3 (100.0000%)        | 0/0                | 1/1/1           | 1/1/1              |
| Egonex-AI/Understand-Anything | bare   |      1018 | 835/835 (100.0000%)    | 176/176            | 1/1/23          | 1/1/2              |
| Egonex-AI/Understand-Anything | member |       741 | 735/735 (100.0000%)    | 0/3                | 1/2/3           | 1/2/2              |

| Family                        | Shape  | Evidence                         | All sites | Covered / gold         | Key / mapped zeros | Key p50/p95/max | Mapped p50/p95/max |
| ----------------------------- | ------ | -------------------------------- | --------: | ---------------------- | ------------------ | --------------- | ------------------ |
| 403errors/repomind            | bare   | callee-import                    |      1198 | 1,174/1,187 (98.9048%) | 14/14              | 1/5/25          | 1/5/8              |
| 403errors/repomind            | bare   | callee-unbound                   |         6 | 3/6 (50.0000%)         | 3/3                | 0/1/1           | 0/1/1              |
| 403errors/repomind            | member | receiver-unbound-without-peers   |         3 | 3/3 (100.0000%)        | 0/0                | 1/1/1           | 1/1/1              |
| Egonex-AI/Understand-Anything | bare   | callee-import                    |      1018 | 835/835 (100.0000%)    | 176/176            | 1/1/23          | 1/1/2              |
| Egonex-AI/Understand-Anything | member | receiver-field-without-peers     |         3 | 3/3 (100.0000%)        | 0/0                | 1/1/1           | 1/1/1              |
| Egonex-AI/Understand-Anything | member | receiver-local-with-peers        |       203 | 200/200 (100.0000%)    | 0/3                | 1/1/2           | 1/1/1              |
| Egonex-AI/Understand-Anything | member | receiver-local-without-peers     |       498 | 495/495 (100.0000%)    | 0/0                | 1/2/3           | 1/2/2              |
| Egonex-AI/Understand-Anything | member | receiver-parameter-with-peers    |         5 | 5/5 (100.0000%)        | 0/0                | 1/1/1           | 1/1/1              |
| Egonex-AI/Understand-Anything | member | receiver-parameter-without-peers |        18 | 18/18 (100.0000%)      | 0/0                | 1/2/2           | 1/2/2              |
| Egonex-AI/Understand-Anything | member | receiver-unbound-without-peers   |        14 | 14/14 (100.0000%)      | 0/0                | 2/2/2           | 2/2/2              |

All **16** scorable misses are **repomind bare** calls: **13 callee-import** and **three callee-unbound**. Understand-Anything has 1,570/1,570 unique-positive targets covered; repomind has 1,180/1,196 (98.6622%). The narrow three-site repomind member group is descriptive and does not establish member generalization.

### Exact missing-target rows

Every row below has an exact parser fact, zero raw keys, and first loss `raw-generation`. These are generation losses in this replay. Import binding evidence alone does not identify the source-level cause; a later bounded source audit can inspect aliases/re-exports/default imports and the unbound syntax. This cap slice does not propose an implementation for them.

| Caller (0-based line:column; links use 1-based lines)                                                                                                                                                          | Binding evidence | Unique target                                                    |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- | ---------------------------------------------------------------- |
| [src/app/actions.ts:1027:23](https://github.com/403errors/repomind/blob/6a46bb25a132f3bb35da76ef678b99718e37c2f5/src/app/actions.ts#L1028)                                                                     | callee-import    | `src/lib/services/scan-share-links.ts#createScanShareLink`       |
| [src/app/actions.ts:1043:11](https://github.com/403errors/repomind/blob/6a46bb25a132f3bb35da76ef678b99718e37c2f5/src/app/actions.ts#L1044)                                                                     | callee-import    | `src/lib/services/scan-share-links.ts#resolveScanFromShareToken` |
| [src/app/actions.ts:1065:23](https://github.com/403errors/repomind/blob/6a46bb25a132f3bb35da76ef678b99718e37c2f5/src/app/actions.ts#L1066)                                                                     | callee-import    | `src/lib/services/scan-share-links.ts#createScanShareLink`       |
| [src/app/actions.ts:1107:24](https://github.com/403errors/repomind/blob/6a46bb25a132f3bb35da76ef678b99718e37c2f5/src/app/actions.ts#L1108)                                                                     | callee-import    | `src/lib/services/report-service.ts#findingFingerprint`          |
| [src/app/actions.ts:1251:11](https://github.com/403errors/repomind/blob/6a46bb25a132f3bb35da76ef678b99718e37c2f5/src/app/actions.ts#L1252)                                                                     | callee-import    | `src/lib/services/artifact-service.ts#searchRepositoryCode`      |
| [src/app/actions.ts:1257:11](https://github.com/403errors/repomind/blob/6a46bb25a132f3bb35da76ef678b99718e37c2f5/src/app/actions.ts#L1258)                                                                     | callee-import    | `src/lib/services/history-service.ts#getRecentSearches`          |
| [src/app/actions.ts:435:11](https://github.com/403errors/repomind/blob/6a46bb25a132f3bb35da76ef678b99718e37c2f5/src/app/actions.ts#L436)                                                                       | callee-import    | `src/lib/services/repo-suggestions.ts#getRepoSuggestions`        |
| [src/app/admin/blog/actions.ts:27:8](https://github.com/403errors/repomind/blob/6a46bb25a132f3bb35da76ef678b99718e37c2f5/src/app/admin/blog/actions.ts#L28)                                                    | callee-import    | `src/lib/services/blog-service.ts#deletePost`                    |
| [src/app/report/[scan\_id]/page.test.tsx:111:21](https://github.com/403errors/repomind/blob/6a46bb25a132f3bb35da76ef678b99718e37c2f5/src/app/report/[scan_id]/page.test.tsx#L112)                              | callee-unbound   | `src/app/report/[scan_id]/page.tsx#PrivateReportPage`            |
| [src/app/report/[scan\_id]/page.test.tsx:128:27](https://github.com/403errors/repomind/blob/6a46bb25a132f3bb35da76ef678b99718e37c2f5/src/app/report/[scan_id]/page.test.tsx#L129)                              | callee-unbound   | `src/app/report/[scan_id]/page.tsx#PrivateReportPage`            |
| [src/app/report/[scan\_id]/page.test.tsx:150:27](https://github.com/403errors/repomind/blob/6a46bb25a132f3bb35da76ef678b99718e37c2f5/src/app/report/[scan_id]/page.test.tsx#L151)                              | callee-unbound   | `src/app/report/[scan_id]/page.tsx#PrivateReportPage`            |
| [src/lib/services/\_\_tests\_\_/fix-verification.test.ts:175:28](https://github.com/403errors/repomind/blob/6a46bb25a132f3bb35da76ef678b99718e37c2f5/src/lib/services/__tests__/fix-verification.test.ts#L176) | callee-import    | `src/lib/services/report-service.ts#findingFingerprint`          |
| [src/lib/services/fix-verification.ts:103:21](https://github.com/403errors/repomind/blob/6a46bb25a132f3bb35da76ef678b99718e37c2f5/src/lib/services/fix-verification.ts#L104)                                   | callee-import    | `src/lib/services/report-service.ts#findingFingerprint`          |
| [src/lib/services/fix-verification.ts:131:21](https://github.com/403errors/repomind/blob/6a46bb25a132f3bb35da76ef678b99718e37c2f5/src/lib/services/fix-verification.ts#L132)                                   | callee-import    | `src/lib/services/report-service.ts#findingFingerprint`          |
| [src/lib/services/security-verification.ts:765:36](https://github.com/403errors/repomind/blob/6a46bb25a132f3bb35da76ef678b99718e37c2f5/src/lib/services/security-verification.ts#L766)                         | callee-import    | `src/lib/services/report-service.ts#findingFingerprint`          |
| [src/lib/services/security-verification.ts:808:28](https://github.com/403errors/repomind/blob/6a46bb25a132f3bb35da76ef678b99718e37c2f5/src/lib/services/security-verification.ts#L809)                         | callee-import    | `src/lib/services/report-service.ts#findingFingerprint`          |

The artifact includes each full sample ID, target ID, exact first-loss stage, and pre-cap rank. The ignored per-site replay retains source/fact hashes, exact call facts, raw keys, and every stage key/mapped-ID sequence.

## TRAIN descriptive comparison

The prior [TRAIN source audit](tiered-call-resolution-phase2-p2a-candidate-stage-train-audit.md) found a different mix: 17 gold targets lost at cap 25 and four lost by filters. Its original replay at caps 25/33 covered 12,149/12,166 of 12,177; after seven separate direct-service capability rows, the explicitly merged view covered 12,156/12,173. TRAIN cap 25→33 added 5,589 keys (+12.7%) and 2,022 mapped memberships (+6.4%), with key p95 25→31. The current CALIBRATION sweep adds no gold coverage and only 14 keys/six mapped memberships. These are separate split populations, not a pooled estimate or heldout certification.

## Reproduction and provenance

```bash
PATH=/Users/daniel.chang/.nvm/versions/node/v24.14.1/bin:$PATH pnpm exec tsx scripts/semantic-corpus/phase2-tiered-call-resolution-calibration-cap-audit.mts
```

The runner accepts no split/path overrides. Pinned manifest, source, configuration, complete IDs, implementation files, snapshot bytes, decision fields, and isolated calibration label hashes must all match. It writes only under ignored results. The committed [summary artifact](tiered-call-resolution-phase2-p2a-calibration-cap-evidence/calibration-cap-summary.json) is byte-identical to the runner output.

| Evidence                    | SHA-256                                                            |
| --------------------------- | ------------------------------------------------------------------ |
| Summary artifact            | `afe3d04099ca83ab5330962a638aeb1367cf6e0947f1a5697928653219f1b13f` |
| Runner                      | `6eee782dd068a2f53c26f7fb4ee36116592feaa6b1426ab8cec87ed88396e727` |
| Per-site replay             | `a54ea61858e9025b53468a94fbe25e7ecb18319913e15e4fbf66463969e33e02` |
| Complete 2,966 sample IDs   | `c95b92a9d5cd284250cdfaf178b990b77b59cf6d60b81e5068a2c7c573fe76c9` |
| Isolated calibration labels | `5b2892aa4be1ea53c76ff6dc189c0c78c3bf3d83af61639cbd1c59716710c426` |
| Pinned v4 predictions       | `6d99b1b940d470cbeb94e2bd55527a8e372d2c30c26b56b7d51fc9d773c0e622` |
| Source-only v4 manifest     | `de7dc8ec977ac316addce6263fcdb9e3190ceed84a4cc8b7e7506f2a04f5ad9e` |
| Source callsites            | `b61764cdaa1168ba453689c5e11f6a9b035a05273532068648092c48a0dbd362` |
| Corrected facts             | `ba7b631b36ed05b1f16c6b500b0c17b5e4273acd939a493800848225c4dad14e` |
| Configuration               | `e09018b7f5abca2e246fd1b6a9c7e078d6972b0a66fa54b67c2eeabc17437fdd` |
| Decision-equivalence proof  | `ef550230c90e0bee2e3e5eb9abadf3ed55747461614efe59998af1852591daf6` |

The isolated label hash and raw 2,750/2,766 recall exactly match the existing [v4 calibration candidate-recall artifact](tiered-call-resolution-phase2-p2a-direct-import-alias-evidence/candidate-recall-calibration.json). The summary also records source spec/collection pins, pinned v4 and replay implementation hashes, snapshot revisions, and parser-input hash formula. Generated files have no timestamps; repeated runs must remain byte-identical.

## Validation

Focused synthetic fixtures verify prefix coverage, null/duplicate mapped IDs, inclusion of unscorable sites, family/shape/evidence grouping, unconfirmed-positive handling, split rejection, complete unique IDs, invalid caps, and duplicate-gold rejection. The first RED run failed on the missing module; the expanded fixture then passed 5/5. Focused audit suites passed **14/14** (five new calibration fixtures). Repository typecheck, explicit runner typecheck, build, lint, Prettier, and `git diff --check` passed; the staged graph review reports five files / LOW risk / no local graph impact. Every exact parser fact and non-null source/input hash is required; an eligibility gap fails closed before labels are loaded and requires a separate capability probe. The quality gate passed at **215/7,303 weak assertions** (ceiling 220), with category ratchet unchanged at **234/234**. Two final source replays produced byte-identical summaries and per-site evidence. The full pre-push suite passed **3,246 tests / seven skipped** (339 files / one skipped); format, lint, typecheck, and build also passed. The initial push stopped at category ratchet because the new fixture lacked required name markers. Its existing happy-path, invalid-input, and error-handling cases now carry explicit markers; the quality policy is unchanged.

Only two calibration families are represented. The result establishes candidate availability and set sizes for the pinned in-split source population; it does not evaluate System One ranking, select thresholds, grant proof/completeness, certify unseen behavior, or enable Tier B skip. No runtime policy change is included.
