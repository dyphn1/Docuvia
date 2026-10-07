# Tiered call resolution Q1 recertification

## Decision

The corrected amendment-3 evaluation certifies `q1:named-import:v1` on both frozen tracks under implementation `8013b99b1410f1302c576178e557c4484735077a`. It found zero valid contradictions and one-sided 95% lower bounds of `0.997355` for VS Code and `0.993739` for Docuvia temporal. The current Q1 rule-configuration SHA-256 is `96d314c147163bed22286b1116941a43c2065ed6d644bff8f77b2e449e9de728`. A new pinned artifact is shipped and the runtime gate is active for qualifying, proven, source-current, unquarantined Q1 sites outside the deterministic canary. The earlier failed amendment-3 attempt remains recorded below as an event; its zero-proof result was caused by the #578 inventory regression and was not label-agreement evidence.

No other signature passes both tracks. In particular, `q2:reexport-trace:v1` remains below `0.990` in both tracks; no Q2 certification is active.

## New-family pre-registration and frozen slice

- **Repository and revision:** MIT-licensed `microsoft/vscode` at `4f2dfc552c95b9ff4729fa13f109bfda5f886d69`.
- **Caller population:** `src/vs/workbench/api/**` and `src/vs/workbench/common/**` TypeScript source.
- **Caller exclusions:** declaration files; `node_modules`, test, tests, `__tests__`, fixture, fixtures, and `__fixtures__` path segments; and `.test.ts` / `.spec.ts` files.
- **Resolution support:** `src/vs/base/**` and `src/vs/platform/**` outside test/fixture paths, with all `src/vs/platform/agentHost/**` excluded; `src/tsconfig*.json`, `src/typings/**`, `src/vscode-dts/**`, `src/vs/amdX.ts`, `src/vs/nls.ts`, and `src/vs/monaco.d.ts`.
- **Burned-path separation:** no caller samples came from `src/vs/base/**`, `src/vs/platform/**`, or `src/vs/editor/**`. The first two appear only as resolution support. The previously labeled base/platform/editor sample was not reused.
- **Freeze:** amendment 1 freeze SHA-256 `3282da0abb1f045685648898a14b804493ed02181aadb427591af178e8648d02`, made before proof counts and oracle labels. It supersedes freeze `74a9190d2d6b3667d4962465ab025558a3435d275acb208bd08faba3b5ca00a8`: the first support slice exceeded the 4,096 MB heap cap during Q1 parity before any labels were opened. The caller population did not change in amendment 1; the resolution-only support was narrowed to fit the cap.
- **Frozen population:** 6,397 sample sites / 6,219 duplicate groups; source snapshot SHA-256 `850a548733820aa4159cb93c71aab702b94ef88fee3143777dd3e8cf8780fe5a`; prelabel manifest SHA-256 `e192c82979bf26cb6033a0034bd9d740bb58f07489a2e1165ac969f1c4222692`.
- **Implementation:** `ffbd59732bf423c292ac5ea91e55df059f2af7b6`, frozen with Q1 rule configuration SHA-256 `046ee416f509b9ea3c039da70a91fcfb4390232d54760ae56761fbf2e5720f3b`.

### Q1 rule-configuration hash

The frozen file set is `resolverRuleSignatures["q1:named-import:v1"].implementationConfigurationFiles` in the [certification freeze manifest](tiered-call-resolution-certification-evidence/freeze-manifest.json):

- `lib/core/src/semantic/call-resolution-hypothesis.service.ts`
- `lib/core/src/semantic/call-resolution-hypothesis-index.ts`
- `lib/core/src/semantic/call-resolution-hypothesis-internal.ts`
- `lib/core/src/semantic/call-resolution-strict-proof.ts`
- `lib/contracts/src/interfaces/call-resolution-hypothesis.interfaces.ts`
- `lib/contracts/src/interfaces/call-site-shape-facts.interfaces.ts`
- `lib/contracts/src/interfaces/declared-type-facts.interfaces.ts`

Each file hash is SHA-256 over its raw bytes. The combined value is SHA-256 over the compact UTF-8 `JSON.stringify` serialization of the path-to-file-hash object, preserving the file order shown in the freeze manifest. `scripts/semantic-corpus/q1-rule-configuration.mts` shares this file set and algorithm between the certification audit and the unit guard.

### Persisted-proof parity and count gate

All runners parsed the same 1,455 source files with zero parse failures and source-manifest SHA-256 `81064f330009cd47f20c9d2b14d5b04fd2c9f324510186255457aa277a67ab9b`.

| Runner | Service proposals | Persisted | Counted exclusions | Silent gap | In-sample sites / independent groups |
| ------ | ----------------: | --------: | -----------------: | ---------: | -----------------------------------: |
| Q1     |             5,673 |     5,673 |                  0 |          0 |                        1,153 / 1,131 |
| Q2     |               392 |       392 |                  0 |          0 |                            299 / 297 |
| Q3     |             2,137 |     2,137 |                  0 |          0 |                            566 / 543 |

The Q1 sample passed the prelabel count gate with 1,131 persisted-proof groups, 832 above the 299-group minimum. The other signature counts are reported for completeness; they do not meet the two-track gate unless their final confidence bound also passes.

## VS Code oracle labeling

The labels were opened only after amendment 1 was frozen and the parity/count gate passed. The run labeled the 2,018 unique in-scope proof-site samples needed to evaluate all signatures; no labels were opened for out-of-scope proof sites.

- Oracle: `typescript-language-server 5.3.0 + tsserver 5.9.3`.
- Configuration SHA-256: `032d80801a24de4e55c32cf1d0c0df189281dfb6f44f0a366be4d76451fd627e`.
- Request timeout: 30 seconds; readiness cap: 60 seconds; poll interval: 500 ms; tsserver memory cap: 4,096 MB.
- One `src/tsconfig.json` project group became ready in 1.712 seconds. The oracle made 2,018 site requests and 4 readiness probes; all 2,018 outcomes were resolved.
- Elapsed time: 2.526 seconds. Sampled parent-process peak RSS: 495,583,232 bytes. The tsserver child was capped at 4,096 MB; its actual peak RSS was not directly measured.
- Labels remain outside the repository at `/private/tmp/docuvia-q1-recert/vscode/oracle-labels-amendment-1.json`, SHA-256 `0fa6f2facec99ce22f99280747f726f3e57aabca7e8bd7be7c7d4f49a333c66f`.

## Temporal track amendment 2

**Amendment 2:** implementation updated for #571/#574, fix motivated only by the VS Code new-family finding; Docuvia labels were not consulted for the fix.

The same Docuvia sample and labels were retained: MIT-licensed `dyphn1/Docuvia` at `113a2afe97d2407d0b6ba19624f42408875831cf`, relative to training baseline `204c40fb7080ebded011f65a3dae7d749cce9ed1`; amended freeze SHA-256 `526b5e656ed23b00879386cf842e0901530fc3ca3fd450f91aa33a59af5103b5`; 947 labeled sites / 878 sample groups; manifest SHA-256 `0c161537e3d9680b6e2d66c613fba540002cfb1ca88fc50d36fe48006cd64841`.

Amendment 2's then-current Q1/Q2/Q3 parity parsed all 907 target files with zero parse failures. It recorded 3,347 / 47 / 1,190 proposals, all persisted, with zero counted exclusions and zero silent gap, and matched the then-current evaluation. That result predates the amendment 3 rerun of the current `#570` / `#576` implementation; see the amendment 3 section below for the current source hash and results.

## Certification results

Each row reports persisted proof sites / independent duplicate groups (`n`) / successful groups / valid contradictions / one-sided 95% lower bound. Empty signature populations have no evidence; the evaluator reports its zero sentinel as `0`.

| Signature                  | VS Code: sites / n / successes / contradictions / LB95 | Docuvia: sites / n / successes / contradictions / LB95 |
| -------------------------- | -----------------------------------------------------: | -----------------------------------------------------: |
| `q1:named-import:v1`       |                 1,153 / 1,131 / 1,131 / 0 / `0.997355` |                       502 / 477 / 477 / 0 / `0.993739` |
| `q2:reexport-trace:v1`     |                       299 / 297 / 297 / 0 / `0.989964` |                          12 / 12 / 12 / 0 / `0.779078` |
| `q3:super-call:v1`         |                          19 / 19 / 19 / 0 / `0.854131` |                                    0 / 0 / 0 / 0 / `0` |
| `q3:this-inherited:v1`     |                                    0 / 0 / 0 / 0 / `0` |                                    0 / 0 / 0 / 0 / `0` |
| `q3:typed-receiver:v1`     |                       320 / 304 / 304 / 0 / `0.990194` |                             4 / 4 / 4 / 0 / `0.472871` |
| `q3:new-receiver:v1`       |                       227 / 220 / 220 / 0 / `0.986475` |                         104 / 95 / 95 / 0 / `0.968958` |
| `single-candidate-this-v1` |                                    0 / 0 / 0 / 0 / `0` |                                    0 / 0 / 0 / 0 / `0` |

There were no valid contradictions in either track, so the contradiction list is empty. Q2 falls short of `.990` in both tracks. Typed receiver clears the new-family bound but is underpowered temporally. The other signatures also fail at least one required track gate.

## Candidate artifact and runtime scope

The active candidate is [q1-named-import-candidate-certification.json](tiered-call-resolution-certification-q1-recert-evidence/q1-named-import-candidate-certification.json), SHA-256 `c81a6de05c1cd954f33238f160ac45cbcf0368fee1efec6fa693f67c825e651f`. It uses schema `docuvia-call-resolution-certification/v1` and pins implementation `8013b99b1410f1302c576178e557c4484735077a`, Q1 rule configuration `96d314c147163bed22286b1116941a43c2065ed6d644bff8f77b2e449e9de728`, both track identities and split hashes, oracle configuration, and combined corpus manifest digest `597e2415b5d15d4098daadc072f6c128633dd3780e8ba54f552efc26ce64bdd2`. The artifact contains only `q1:named-import:v1`. The previous artifact is retained as [superseded evidence](tiered-call-resolution-certification-q1-recert-evidence/q1-named-import-candidate-certification-superseded-ffbd59732.json), SHA-256 `f7d37887e989a9db6b91db9f28dc3b85164c2a75b67f30a56fd0e3515a143a05`.

The byte-identical runtime resource is `lib/ui-core/src/workflows/analyze/q1-named-import-candidate-certification.json`. The CLI package includes it in the built `dist` resource set. Trust goes through `loadCallResolutionCertificationArtifact` with pinned artifact, implementation, rule-configuration, oracle, corpus, and track inputs. A source-hash mismatch rejects certification. The deterministic canary remains scheduled, and quarantine overrides certification. Each Tier B batch records `analyze.tierB.call_resolution_certification` in `.docuvia/logs/analyze.log`. The [analyze guide](../user-guide/cli/analyze.md) describes the status fields that show whether Q1 is active.

## Evidence and verification

The evidence directory contains the current freeze and an aggregate with parity counts, signature outcomes, and hashes. The superseded OOM freeze is retained under `/private/tmp` and referenced by its SHA-256 in the aggregate. Per-sample manifests, proofs, labels, and full evaluator outputs remain in `/private/tmp`; the repository contains no per-sample artifacts. The temporal freeze and aggregate-only results remain in [the temporal-2 evidence directory](tiered-call-resolution-certification-temporal-2-evidence/).

Verification results for the corrected amendment-3 run:

- `pnpm --filter @workspace/core exec vitest run`: 128 files passed; 1,310 tests passed and 1 skipped (1,311 total).
- `pnpm --filter @workspace/schema exec vitest run`: 1 file passed; 7 tests passed.
- `pnpm --filter @workspace/ui-core exec vitest run`: 6 files passed; 153 tests passed.
- `pnpm --filter docuvia exec vitest run test/integration/dist-build.test.ts`: 1 file passed; 8 tests passed.
- `pnpm exec vitest run test/semantic-corpus`: 30 files passed; 177 tests passed. The first invocation ended with SIGSEGV after ten files; the unchanged retry passed all tests.
- `pnpm run build`, `pnpm run typecheck`, `pnpm run lint`, and `pnpm exec prettier --check .`: passed.

No GitNexus or Onyx `ee/` data was used. No network access, Docuvia checkout `.git` write, or `project_files.content_hash` semantic change was made. Runtime Tier B changed only for the certified Q1 signature and only under the proven, source-current, unquarantined, non-canary conditions described above.

## Amendment 3: corrected current-implementation recertification

### Earlier unsuccessful evaluation

The first amendment-3 evaluation ran against implementation `7df7d9335d289e6a14f71a213d645e38d7c85b8b` with Q1 rule hash `fa63092fc95326ebfe3cf796caf2452efb43fa84d6f77fc17241ab4555a514ab`. The #578 regression made the import candidate inventory incomplete, so every import-bound call abstained: Q1 and Q2 had zero proof groups on both tracks; Q3 parity still passed. That attempt did not certify Q1. Its aggregate is retained at [amendment-3-initial-failed-aggregate.json](tiered-call-resolution-certification-q1-recert-evidence/amendment-3-initial-failed-aggregate.json), and is also recorded as `priorAttempt` in the corrected aggregate. The zero-proof observation that exposed #578 was a proof-count observation, not a label-agreement observation.

### Corrected parity rerun

After the #578 fix, the Q1, Q2, and Q3 proof runners were rerun against the same frozen source snapshots: VS Code workbench freeze `3282da0abb1f045685648898a14b804493ed02181aadb427591af178e8648d02` and Docuvia temporal freeze `526b5e656ed23b00879386cf842e0901530fc3ca3fd450f91aa33af5103b5`. The freeze manifests pin source snapshot SHA-256 `850a548733820aa4159cb93c71aab702b94ef88fee3143777dd3e8cf8780fe5a` (VS Code, 1,463 files) and `853dc03a873bdb7f7e95ef37a68f2192fe03fbbc6068938ae8661a6ce9d8a24d` (Docuvia, 911 tracked files). Within each track, all three runner summaries report the same source-manifest digest, file count, parsed file count, and zero parse failures; those digests also match the prior frozen parity aggregate. VS Code source-manifest SHA-256 is `81064f330009cd47f20c9d2b14d5b04fd2c9f324510186255457aa277a67ab9b` (1,455 parsed files); Docuvia source-manifest SHA-256 is `ea844871fb9c8e272fd16a811457bf73ee63f8f5ddc629aa16d878c55f623d70` (907 parsed files).

| Track             | Q1 proposals / persisted / exclusions / gap | Q2 proposals / persisted / exclusions / gap | Q3 proposals / persisted / exclusions / gap | Import-bound calls |
| ----------------- | ------------------------------------------: | ------------------------------------------: | ------------------------------------------: | -----------------: |
| VS Code workbench |                       5,673 / 5,673 / 0 / 0 |                           392 / 392 / 0 / 0 |                       2,130 / 2,130 / 0 / 0 |              8,477 |
| Docuvia temporal  |                       3,347 / 3,347 / 0 / 0 |                             47 / 47 / 0 / 0 |                       1,190 / 1,190 / 0 / 0 |             16,821 |

The frozen sample identities and prelabel manifests are unchanged: VS Code `3282da0a…` / `e192c829…` and Docuvia temporal `526b5e65…` / `0c161537…`. For every runner, proposals equal persisted rows, counted exclusions are zero, and silent gap is zero.

### Corrected certification evaluation

The evaluator reused the already-opened label files without creating or requesting any new labels. Each table shows `sites / independent groups / successes / valid contradictions / one-sided 95% lower bound` for the corrected evaluation, the `ffbd59732` baseline, and the metric deltas. Every delta is zero in both tracks.

#### VS Code workbench

| Rule signature             | Current sites / groups / successes / contradictions / LB95 | `ffbd59732` sites / groups / successes / contradictions / LB95 | Delta: sites / groups / successes / contradictions / LB95 |
| -------------------------- | ---------------------------------------------------------: | -------------------------------------------------------------: | --------------------------------------------------------: |
| `q1:named-import:v1`       |                       1,153 / 1,131 / 1,131 / 0 / 0.997355 |                           1,153 / 1,131 / 1,131 / 0 / 0.997355 |                                         0 / 0 / 0 / 0 / 0 |
| `q2:reexport-trace:v1`     |                             299 / 297 / 297 / 0 / 0.989964 |                                 299 / 297 / 297 / 0 / 0.989964 |                                         0 / 0 / 0 / 0 / 0 |
| `q3:super-call:v1`         |                                19 / 19 / 19 / 0 / 0.854131 |                                    19 / 19 / 19 / 0 / 0.854131 |                                         0 / 0 / 0 / 0 / 0 |
| `q3:this-inherited:v1`     |                                          0 / 0 / 0 / 0 / 0 |                                              0 / 0 / 0 / 0 / 0 |                                         0 / 0 / 0 / 0 / 0 |
| `q3:typed-receiver:v1`     |                             320 / 304 / 304 / 0 / 0.990194 |                                 320 / 304 / 304 / 0 / 0.990194 |                                         0 / 0 / 0 / 0 / 0 |
| `q3:new-receiver:v1`       |                             227 / 220 / 220 / 0 / 0.986475 |                                 227 / 220 / 220 / 0 / 0.986475 |                                         0 / 0 / 0 / 0 / 0 |
| `single-candidate-this-v1` |                                          0 / 0 / 0 / 0 / 0 |                                              0 / 0 / 0 / 0 / 0 |                                         0 / 0 / 0 / 0 / 0 |

#### Docuvia temporal

| Rule signature             | Current sites / groups / successes / contradictions / LB95 | `ffbd59732` sites / groups / successes / contradictions / LB95 | Delta: sites / groups / successes / contradictions / LB95 |
| -------------------------- | ---------------------------------------------------------: | -------------------------------------------------------------: | --------------------------------------------------------: |
| `q1:named-import:v1`       |                             502 / 477 / 477 / 0 / 0.993739 |                                 502 / 477 / 477 / 0 / 0.993739 |                                         0 / 0 / 0 / 0 / 0 |
| `q2:reexport-trace:v1`     |                                12 / 12 / 12 / 0 / 0.779078 |                                    12 / 12 / 12 / 0 / 0.779078 |                                         0 / 0 / 0 / 0 / 0 |
| `q3:super-call:v1`         |                                          0 / 0 / 0 / 0 / 0 |                                              0 / 0 / 0 / 0 / 0 |                                         0 / 0 / 0 / 0 / 0 |
| `q3:this-inherited:v1`     |                                          0 / 0 / 0 / 0 / 0 |                                              0 / 0 / 0 / 0 / 0 |                                         0 / 0 / 0 / 0 / 0 |
| `q3:typed-receiver:v1`     |                                   4 / 4 / 4 / 0 / 0.472871 |                                       4 / 4 / 4 / 0 / 0.472871 |                                         0 / 0 / 0 / 0 / 0 |
| `q3:new-receiver:v1`       |                               104 / 95 / 95 / 0 / 0.968958 |                                   104 / 95 / 95 / 0 / 0.968958 |                                         0 / 0 / 0 / 0 / 0 |
| `single-candidate-this-v1` |                                          0 / 0 / 0 / 0 / 0 |                                              0 / 0 / 0 / 0 / 0 |                                         0 / 0 / 0 / 0 / 0 |

Q1 has zero valid contradictions and lower bounds above `0.990` in both tracks, so it qualifies. Q2 and all Q3 signatures remain uncertified; Q2 fails the lower-bound threshold in both tracks, while the Q3 results do not clear the two-track gate. The prior failed attempt's empty Q1/Q2 result is not included as a certification comparison because it had no proof groups and no label-agreement evidence.

### Provenance and active runtime pins

Per task-provided provenance, #570, #576, and #578 were developed without consulting these labels. #578 was found because the amendment-3 evaluation produced zero proofs (a proof-count observation, not a label-agreement observation). The corrected evaluation uses the exact existing VS Code label SHA-256 `0fa6f2facec99ce22f99280747f726f3e57aabca7e8bd7be7c7d4f49a333c66f` and Docuvia label SHA-256 `397626b438267e43320d01ef5a646ccda29060d222b74136d156da033412a2a3`; the task-provided provenance says those implementation changes were developed without consulting them. No new labels were made. The artifact's `labelsOpenedAt` field records when the corrected evaluator loaded the existing label bytes; it does not claim that this was their first opening or a new labeling event.

The active artifact pins implementation `8013b99b1410f1302c576178e557c4484735077a`, current Q1 configuration `96d314c147163bed22286b1116941a43c2065ed6d644bff8f77b2e449e9de728`, and artifact SHA-256 `c81a6de05c1cd954f33238f160ac45cbcf0368fee1efec6fa693f67c825e651f`. The prior artifact remains as superseded evidence. See [amendment-3-aggregate.json](tiered-call-resolution-certification-q1-recert-evidence/amendment-3-aggregate.json) for input hashes, proof-output hashes, parity counts, file-level Q1 rule hashes, full-precision metrics, and the event record of the failed attempt. Raw proof inventories and evaluator outputs remain outside the repository in `/private/tmp/docuvia-q1-recert/amendment-3-corrected/`; no sample-level label data was added.
