# Tiered call resolution Q1 recertification

## Decision

`q1:named-import:v1` passes the two-track promotion gate under implementation `ffbd59732bf423c292ac5ea91e55df059f2af7b6`: both tracks have zero valid contradictions and a one-sided 95% group Clopper–Pearson lower bound above `.990`. The evidence directory contains a candidate artifact. It is not wired into any runtime path, so this work makes no runtime behavior change and enables no Tier B skip.

No other signature passes both tracks. In particular, `q3:typed-receiver:v1` passes the new-family numeric threshold but has only four independent groups in the Docuvia temporal track.

## New-family pre-registration and frozen slice

- **Repository and revision:** MIT-licensed `microsoft/vscode` at `4f2dfc552c95b9ff4729fa13f109bfda5f886d69`.
- **Caller population:** `src/vs/workbench/api/**` and `src/vs/workbench/common/**` TypeScript source.
- **Caller exclusions:** declaration files; `node_modules`, test, tests, `__tests__`, fixture, fixtures, and `__fixtures__` path segments; and `.test.ts` / `.spec.ts` files.
- **Resolution support:** `src/vs/base/**` and `src/vs/platform/**` outside test/fixture paths, with all `src/vs/platform/agentHost/**` excluded; `src/tsconfig*.json`, `src/typings/**`, `src/vscode-dts/**`, `src/vs/amdX.ts`, `src/vs/nls.ts`, and `src/vs/monaco.d.ts`.
- **Burned-path separation:** no caller samples came from `src/vs/base/**`, `src/vs/platform/**`, or `src/vs/editor/**`. The first two appear only as resolution support. The previously labeled base/platform/editor sample was not reused.
- **Freeze:** amendment 1 freeze SHA-256 `3282da0abb1f045685648898a14b804493ed02181aadb427591af178e8648d02`, made before proof counts and oracle labels. It supersedes freeze `74a9190d2d6b3667d4962465ab025558a3435d275acb208bd08faba3b5ca00a8`: the first support slice exceeded the 4,096 MB heap cap during Q1 parity before any labels were opened. The caller population did not change in amendment 1; the resolution-only support was narrowed to fit the cap.
- **Frozen population:** 6,397 sample sites / 6,219 duplicate groups; source snapshot SHA-256 `850a548733820aa4159cb93c71aab702b94ef88fee3143777dd3e8cf8780fe5a`; prelabel manifest SHA-256 `e192c82979bf26cb6033a0034bd9d740bb58f07489a2e1165ac969f1c4222692`.
- **Implementation:** `ffbd59732bf423c292ac5ea91e55df059f2af7b6`, frozen with Q1 rule configuration SHA-256 `046ee416f509b9ea3c039da70a91fcfb4390232d54760ae56761fbf2e5720f3b`.

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

Current-implementation Q1/Q2/Q3 parity parsed all 907 target files with zero parse failures. The runners share source-manifest SHA-256 `ea844871fb9c8e272fd16a811457bf73ee63f8f5ddc629aa16d878c55f623d70`; proposal counts were 3,347 / 47 / 1,190, with all proposals persisted, zero counted exclusions, and zero silent gap. Re-evaluation against the existing labels produced the same sites, groups, successes, contradictions, and bounds as amendment 1 for every signature. No Docuvia result changed.

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

The evidence-only candidate is [q1-named-import-candidate-certification.json](tiered-call-resolution-certification-q1-recert-evidence/q1-named-import-candidate-certification.json), SHA-256 `f7d37887e989a9db6b91db9f28dc3b85164c2a75b67f30a56fd0e3515a143a05`. It uses schema `docuvia-call-resolution-certification/v1`, binds the implementation, Q1 rule configuration, both track identities and split hashes, oracle configuration, and a combined corpus manifest digest. The digest is SHA-256 of the compact UTF-8 JSON object `{"newFamily":"e192c82979bf26cb6033a0034bd9d740bb58f07489a2e1165ac969f1c4222692","temporal":"0c161537e3d9680b6e2d66c613fba540002cfb1ca88fc50d36fe48006cd64841"}` (property order as shown), yielding `597e2415b5d15d4098daadc072f6c128633dd3780e8ba54f552efc26ce64bdd2`. It contains only `q1:named-import:v1`.

The artifact records `frozenAt` `2026-10-07T04:34:09.000Z`, `labelsOpenedAt` `2026-10-07T04:47:59.662Z`, and `resultsRecordedAt` `2026-10-07T04:59:08.000Z`. The artifact-level `labelsOpenedAt` denotes the fresh VS Code label batch. The Docuvia labels were already open under the earlier implementation; amendment 2 re-evaluated those labels with the current implementation without consulting them during the fix. The original Docuvia label-run aggregate does not record its opening timestamp, so the candidate does not claim both label sets were newly opened after one shared freeze.

The file-loading test invokes the existing `loadCallResolutionCertificationArtifact` validator and confirms that only Q1 is certified. The candidate remains under the docs evidence directory and is not loaded by a runtime path. No production record was written, no Tier B policy was changed, and no skip or canary behavior changed.

## Evidence and verification

The evidence directory contains the current freeze and an aggregate with parity counts, signature outcomes, and hashes. The superseded OOM freeze is retained under `/private/tmp` and referenced by its SHA-256 in the aggregate. Per-sample manifests, proofs, labels, and full evaluator outputs remain in `/private/tmp`; the repository contains no per-sample artifacts. The temporal freeze and aggregate-only results remain in [the temporal-2 evidence directory](tiered-call-resolution-certification-temporal-2-evidence/).

Verification results:

- `pnpm --filter @workspace/core exec vitest run`: 126 files passed; 1,289 tests passed and 1 skipped (1,290 total).
- `pnpm --filter @workspace/ui-core exec vitest run`: 4 files passed; 141 tests passed, including the five artifact-file integration tests.
- `pnpm exec vitest run test/semantic-corpus`: 28 files passed; 160 tests passed. The first default-parallel attempt exited with SIGSEGV; a default-parallel retry and a one-worker run both passed.
- `pnpm run typecheck` and `pnpm run lint`: passed.
- `pnpm exec prettier --check .`: passed after formatting the report and aggregate evidence.

No GitNexus or Onyx `ee/` data was used. No network access, Docuvia checkout `.git` write, `project_files.content_hash` semantic change, or runtime Tier B change was made.
