# Tiered call resolution certification report

## Current cross-track update — Q1 recertification

On implementation `ffbd59732bf423c292ac5ea91e55df059f2af7b6`, the fresh MIT-licensed VS Code slice passed `q1:named-import:v1` with 1,153 sites / 1,131 groups / 1,131 successes / 0 valid contradictions / lower bound `0.997355`. The unchanged, previously labeled Docuvia temporal sample passed with 502 sites / 477 groups / 477 successes / 0 valid contradictions / lower bound `0.993739`. Both tracks clear the zero-contradiction and `.990` lower-bound gates under the same implementation.

The only passing signature is `q1:named-import:v1`. Its candidate artifact is [q1-named-import-candidate-certification.json](tiered-call-resolution-certification-q1-recert-evidence/q1-named-import-candidate-certification.json); it is evidence-only and is not loaded by runtime code. No production certification record or Tier B skip was enabled. The previous VS Code `src/vs/{base,platform,editor}` sample remains burned and was not reused; the fresh sample uses `src/vs/workbench/api/**` and `src/vs/workbench/common/**` as callers.

Details: [Q1 recertification report](tiered-call-resolution-certification-q1-recert.md), [Docuvia temporal results](tiered-call-resolution-certification-temporal-2.md), and [VS Code pre-registration](tiered-call-resolution-certification-vscode.md).

## Historical first-certification result (superseded for current Q1 promotion)

This section preserves the earlier study's report. Its datasets and labels were not reused for the Q1 recertification above. In that historical study, **no signature passed both tracks**; no production certification record was written and no Tier B skip was enabled.

The comparison used frozen source proofs matched to the sample manifests by exact repository-relative file path, line, column, and callee. Duplicate groups are the independent trials. A valid contradiction requires a normal oracle response with exactly one repo-local target that differs from the frozen proof target.

## Freeze and oracle

- Implementation HEAD: `63cbe205731d2b1eb7276ceeba604d7a5bad2214`
- Freeze time: `2026-10-06T09:23:31.927Z`
- Freeze manifest SHA-256: `0daf0454f27fc6e50a05c2b48ab44979fe341610de13c0bb68d9d0e5e6101513`
- Oracle: `typescript-language-server 5.3.0 + tsserver 5.9.3`, Node `v24.14.1`
- Oracle configuration SHA-256: `032d80801a24de4e55c32cf1d0c0df189281dfb6f44f0a366be4d76451fd627e`
- Request timeout: 30 s; readiness cap: 60 s; tsserver memory limit: 4,096 MB.
- Labeling began at `2026-10-06T09:55:05Z` for GitNexus and `2026-10-06T09:56:38Z` for Nest.
- No oracle dependency install was needed. The collector Node heap was capped at 4,096 MB; source replay peaks recorded by the parity tooling ranged from 2,160,672,768 to 4,928,061,440 bytes. Process-table access was blocked during oracle labeling, so combined collector/tsserver RSS was not independently measured.

The combined frozen hashes for the rule/signature configurations are:

| Rule signature             | Combined SHA-256                                                   |
| -------------------------- | ------------------------------------------------------------------ |
| `q1:named-import:v1`       | `046ee416f509b9ea3c039da70a91fcfb4390232d54760ae56761fbf2e5720f3b` |
| `q2:reexport-trace:v1`     | `f94fc6e2a74682622f7d464ed745a9142c2c893dc990ec57f454aac2de7b1a88` |
| `q3:super-call:v1`         | `0cd9c21f5f03a746221c8922ddf499756cef4db4398abd7bdb8173848e629238` |
| `q3:this-inherited:v1`     | `0cd9c21f5f03a746221c8922ddf499756cef4db4398abd7bdb8173848e629238` |
| `q3:typed-receiver:v1`     | `0cd9c21f5f03a746221c8922ddf499756cef4db4398abd7bdb8173848e629238` |
| `q3:new-receiver:v1`       | `0cd9c21f5f03a746221c8922ddf499756cef4db4398abd7bdb8173848e629238` |
| `single-candidate-this-v1` | `e9c025800d2d3e679e3415715587e3c1cc4fe5ff75535247ba9a850439d80f13` |

The freeze manifest lists the SHA-256 for every implementation/configuration file, source collection/evaluation tool, and corpus artifact. Those resolver files were rechecked against implementation HEAD after labeling; all matched.

## Frozen corpora

| Track      | Pinned source                                                                                           | Sample / independent groups | Split and SHA-256                                                              | Pre-label manifest SHA-256                                                                                                                                |
| ---------- | ------------------------------------------------------------------------------------------------------- | --------------------------: | ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| New family | `abhigyanpatwari/GitNexus` at `58be52885deee423e2079ae05b4a860ab0f3df75` (PolyForm Noncommercial 1.0.0) |               8,229 / 7,212 | `test`: `8f5587f8653986f3437de00b37852d8a63d33d9147b1f191dba26547560e86ef`     | Artifact `c6cd102f882ab59f3707b56f3067801d122dec53d314ed0e996a1c227462889d`; canonical `1adec1c80fa535b80321a2fa08276f1054732d6c8e1abd436b3f5507b1f87fe0` |
| Temporal   | `nestjs/nest` at `35142c3eca8edaaf6abc5984d915da2fbd458aa2` (MIT)                                       |                   516 / 493 | `temporal`: `3b242ac5a9c80ad16d88e4e343b4600fa95fdc0081537e9d58d6404be6900db4` | Artifact `5bba3e0c39a21af872fa03ee4e6549686d3dcba997a7c12433d8e28c2136e91d`; canonical `43aa0b00ed20873c289e31b35e52871bce168972a49e8cae8dd79fdfc0d8089b` |

All other named splits are empty; their canonical empty-array SHA-256 is `4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945`.

Nest’s corpus-pinned revision is `b1014b6862c3602e86b5a4c750d26bf25ff4b524` (2026-09-25). It is an ancestor of the certified revision, which is 95 commits later (2026-10-02). The baseline and target snapshot hashes are `a50e72b10ae438d46fcddb3412e42dfc8bea9647f9f33a2c0bc07afe6064cf66` and `aaf52fd909fb8c38726b82f59c625bdb777797aabcd37a53f7f794a011c15fbe` respectively.

The labeled dataset hashes are `a11504bbd524050ba01f59b954bd82a95822c18470fac5d2c801b842b0cb7661` for GitNexus and `98e07c6a51305f480f8a82c39b704e8a960770d89c87141ac543109807a66be2` for Nest. Raw labeled-manifest SHA-256 values are `121431d072e5b1ea5b1931a00070c9a868df13466efb8029e54069a8a909343f` and `376f10329063d81e9c128465f95562c2d284122cbd4a5e24ab6f6958f5fd2054` respectively.

## Per-signature results

The lower bound is the repository’s exact one-sided 95% Clopper–Pearson bound over duplicate groups. `n` is the number of groups containing an in-scope persisted proof for that signature. All groups shown as successful had every such site match one unique oracle target.

| Signature                  | GitNexus: sites / n / successes / valid contradictions / lower bound | Nest: sites / n / successes / valid contradictions / lower bound | Overall                        |
| -------------------------- | -------------------------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------ |
| `q1:named-import:v1`       | 3,895 / 3,603 / 3,603 / 0 / 0.999169                                 | 20 / 20 / 20 / 0 / 0.860892                                      | Underpowered in Nest           |
| `q2:reexport-trace:v1`     | 82 / 82 / 82 / 0 / 0.964126                                          | 5 / 5 / 5 / 0 / 0.549280                                         | Underpowered in both           |
| `q3:super-call:v1`         | 0 / 0 / 0 / 0 / 0.000000                                             | 0 / 0 / 0 / 0 / 0.000000                                         | Underpowered in both; no sites |
| `q3:this-inherited:v1`     | 0 / 0 / 0 / 0 / 0.000000                                             | 0 / 0 / 0 / 0 / 0.000000                                         | Underpowered in both; no sites |
| `q3:typed-receiver:v1`     | 1,138 / 726 / 726 / 0 / 0.995882                                     | 8 / 8 / 8 / 0 / 0.687656                                         | Underpowered in Nest           |
| `q3:new-receiver:v1`       | 339 / 225 / 225 / 0 / 0.986774                                       | 21 / 19 / 19 / 0 / 0.854131                                      | Underpowered in both           |
| `single-candidate-this-v1` | 0 / 0 / 0 / 0 / 0.000000                                             | 0 / 0 / 0 / 0 / 0.000000                                         | Underpowered in both; no sites |

The gate requires zero valid contradictions and a lower bound of at least `0.990` in **both** tracks; 299/299 is the first all-success sample size to reach that threshold. No signature meets the two-track gate.

### Oracle outcomes outside the contradiction count

For in-scope persisted proof sites, every oracle result was a single matching repo-local target:

| Track    | Matching unique sites | Timeout | No result | External / unsupported | Multi-location | Error / other |
| -------- | --------------------: | ------: | --------: | ---------------------: | -------------: | ------------: |
| GitNexus |                 5,454 |       0 |         0 |                      0 |              0 |             0 |
| Nest     |                    54 |       0 |         0 |                      0 |              0 |             0 |

Across all labeled samples, GitNexus returned 8,229 normal `resolved` outcomes: 8,228 with one target and one with multiple targets. Nest returned 516 normal `resolved` outcomes with one target each. The GitNexus multi-location sample was not an in-scope persisted proof site and is not a contradiction.

There were no valid contradictions, so there are no contradiction root causes to report. Oracle timeouts, no-result responses, external/unsupported results, and multi-location results were kept out of the contradiction count.

## Source-proof persistence exceptions

Whole-source parsing completed with zero parse failures on both snapshots (4,596 GitNexus files and 2,054 Nest files). The source summaries and proof-site list are preserved under each track’s evidence directory.

- GitNexus Q1 found 14,956 service proof candidates and persisted 14,954. The two caller-node mapping failures are in test files outside the frozen sample manifest, so they do not remove an in-scope proof site.
- GitNexus Q2 persisted all 516 source proof sites.
- GitNexus Q3 found 2,538 service proof candidates and persisted 2,531. Five unpersisted candidates match frozen sample locations (`repository-policy.ts:274,275,277,293` and `resources.ts:335`); each failed because the target function node in `local-backend.ts` was ambiguous. Two further candidates are outside the frozen sample locations. These five have no persisted selected target key and are listed separately in the source-proof manifest; they are neither successes nor valid contradictions in the table.
- All Q1/Q2/Q3 source proof candidates on the Nest target snapshot were persisted (688, 188, and 734 respectively).

The GitNexus Q1 and Q3 whole-source parity runners therefore reported their existing persistence invariant as false. No resolver or rule code was changed, and no replay was tuned or repeated after oracle outcomes were inspected.

## Evidence files

- [Freeze manifest](tiered-call-resolution-certification-evidence/freeze-manifest.json)
- [Historical blocked preflight](tiered-call-resolution-certification-evidence/preflight.json), marked as superseded by the final freeze after the owner supplied Git-backed clones and authorized pre-label collection.
- [Oracle labeling timestamps and dataset hashes](tiered-call-resolution-certification-evidence/oracle-labeling-timestamps.json)
- [GitNexus source-proof manifest](tiered-call-resolution-certification-evidence/gitnexus/source-proof-manifest.json)
- [Nest source-proof manifest](tiered-call-resolution-certification-evidence/nest/source-proof-manifest.json) and [evaluation results](tiered-call-resolution-certification-evidence/nest/evaluation-results.json)
- [Archived per-sample artifacts](tiered-call-resolution-certification-evidence/archived-artifacts.json): pre-label manifests, labeled corpora, per-site evaluation results, proof sites and large source-parity summaries are kept out of the repository and recorded by size and SHA-256. GitNexus is licensed PolyForm Noncommercial 1.0.0 and was used for evaluation only; no derived per-sample data from it is distributed here.

## Verification

Pre-label focused tests and typecheck passed. The focused Vitest summary was:

```text
RUN  v1.6.1 /Users/daniel.chang/Desktop/GitHub/Docuvia
✓ |root| semantic-corpus/certification-proof-scope.unit.test.ts  (3 tests) 2ms
✓ |root| semantic-corpus/phase3-whole-source-parity.unit.test.ts  (3 tests) 1ms
✓ |root| semantic-corpus/prelabel-manifest.unit.test.ts  (3 tests) 2ms
Test Files  3 passed (3)
     Tests  9 passed (9)
  Start at  16:50:28
  Duration  1.86s (transform 1ms, setup 0ms, collect 41ms, tests 5ms, environment 0ms, prepare 111ms)
```

The category and weak gates reported:

```text
FAIL_COUNT=232
BASE_REF=ae26b88efa9ccc46a6812b69961da567cb4fd2dc
HEAD_REF=HEAD
BASE_FAIL_COUNT=232
HEAD_FAIL_COUNT=232
BASE_FILES_SCANNED=351
CATEGORY_RATCHET=PASSED: FAIL_COUNT unchanged at 232
Weak assertions 214 / 7606, threshold 220
```

No tests or resolver runs were repeated after oracle outcomes were inspected.
