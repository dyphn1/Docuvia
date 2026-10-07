# Tiered call resolution Q1 recertification

## Decision

The earlier `q1:named-import:v1` evidence passed both-track thresholds under implementation `ffbd59732bf423c292ac5ea91e55df059f2af7b6`. Amendment 3 reran the proof runners and evaluator on the current implementation at `7df7d9335d289e6a14f71a213d645e38d7c85b8b`, using the same frozen samples and already-opened labels. Both tracks produced zero Q1 proof sites, so there are no trials and the evaluator's lower-bound sentinel is `0`; the `.990` gate is not met. The current Q1 rule hash is `fa63092fc95326ebfe3cf796caf2452efb43fa84d6f77fc17241ab4555a514ab`, while the shipped artifact remains pinned to `046ee416f509b9ea3c039da70a91fcfb4390232d54760ae56761fbf2e5720f3b`. Runtime certification remains rejected and every site continues through Tier B. The current hash is recomputed by the unit guard from the seven files in the freeze manifest.

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

The historical candidate is [q1-named-import-candidate-certification.json](tiered-call-resolution-certification-q1-recert-evidence/q1-named-import-candidate-certification.json), SHA-256 `f7d37887e989a9db6b91db9f28dc3b85164c2a75b67f30a56fd0e3515a143a05`. It uses schema `docuvia-call-resolution-certification/v1` and binds implementation `ffbd59732bf423c292ac5ea91e55df059f2af7b6`, Q1 rule hash `046ee416f509b9ea3c039da70a91fcfb4390232d54760ae56761fbf2e5720f3b`, both track identities and split hashes, oracle configuration, and a combined corpus manifest digest. The digest is SHA-256 of the compact UTF-8 JSON object `{"newFamily":"e192c82979bf26cb6033a0034bd9d740bb58f07489a2e1165ac969f1c4222692","temporal":"0c161537e3d9680b6e2d66c613fba540002cfb1ca88fc50d36fe48006cd64841"}` (property order as shown), yielding `597e2415b5d15d4098daadc072f6c128633dd3780e8ba54f552efc26ce64bdd2`. It remains the packaged historical artifact, but amendment 3 did not qualify a replacement, so this artifact is rejected for the current implementation.

The artifact records `frozenAt` `2026-10-07T04:34:09.000Z`, `labelsOpenedAt` `2026-10-07T04:47:59.662Z`, and `resultsRecordedAt` `2026-10-07T04:59:08.000Z`. The artifact-level `labelsOpenedAt` denotes the fresh VS Code label batch. The Docuvia labels were already open under the earlier implementation; amendment 2 re-evaluated those labels with the current implementation without consulting them during the fix. The original Docuvia label-run aggregate does not record its opening timestamp, so the candidate does not claim both label sets were newly opened after one shared freeze.

The runtime ships a byte-identical copy at `lib/ui-core/src/workflows/analyze/q1-named-import-candidate-certification.json`; the CLI build copies it to `dist/q1-named-import-candidate-certification.json`, included by the package's `files: ["dist"]` rule. Runtime trust uses the existing `loadCallResolutionCertificationArtifact` validator with source-pinned artifact, implementation, Q1 rule-configuration, oracle, corpus, and track inputs. The normal canary policy can skip only proven, source-current Q1 sites outside its deterministic sample. Quarantine remains authoritative. Each Tier B batch records whether certification is `trusted`, `rejected`, or `missing` in `.docuvia/logs/analyze.log`; see the [analyze guide](../user-guide/cli/analyze.md) for how to inspect it.

## Evidence and verification

The evidence directory contains the current freeze and an aggregate with parity counts, signature outcomes, and hashes. The superseded OOM freeze is retained under `/private/tmp` and referenced by its SHA-256 in the aggregate. Per-sample manifests, proofs, labels, and full evaluator outputs remain in `/private/tmp`; the repository contains no per-sample artifacts. The temporal freeze and aggregate-only results remain in [the temporal-2 evidence directory](tiered-call-resolution-certification-temporal-2-evidence/).

Verification results:

- `pnpm --filter @workspace/core exec vitest run`: 126 files passed; 1,289 tests passed and 1 skipped (1,290 total).
- `pnpm --filter @workspace/ui-core exec vitest run`: 4 files passed; 141 tests passed, including the five artifact-file integration tests.
- `pnpm exec vitest run test/semantic-corpus`: 28 files passed; 160 tests passed. The first default-parallel attempt exited with SIGSEGV; a default-parallel retry and a one-worker run both passed.
- `pnpm run typecheck` and `pnpm run lint`: passed.
- `pnpm exec prettier --check .`: passed after formatting the report and aggregate evidence.

No GitNexus or Onyx `ee/` data was used. No network access, Docuvia checkout `.git` write, `project_files.content_hash` semantic change, or runtime Tier B change was made.

## Amendment 3: current-implementation recertification

Amendment 3 ran the Q1, Q2, and Q3 whole-source parity runners on both frozen source snapshots, then ran `certification-evaluate` against the unchanged, already-opened label files. The frozen sample and prelabel hashes remained `3282da0a…` / `e192c829…` for VS Code and `526b5e65…` / `0c161537…` for Docuvia temporal. No oracle labels were opened or generated. Runner source-manifest hashes matched the prior reruns: `81064f33…` (1,455 files) and `ea844871…` (907 files); all six runner passes had zero parse failures.

| Track             | Q1 proposals / persisted / counted exclusions / silent gap | Q2 proposals / persisted / counted exclusions / silent gap | Q3 proposals / persisted / counted exclusions / silent gap | Relevant abstentions                                          |
| ----------------- | ---------------------------------------------------------- | ---------------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------- |
| VS Code workbench | 0 / 0 / 0 / 0                                              | 0 / 0 / 0 / 0                                              | 2,130 / 2,130 / 0 / 0                                      | 8,477 import-bound calls abstained as `incomplete-inventory`  |
| Docuvia temporal  | 0 / 0 / 0 / 0                                              | 0 / 0 / 0 / 0                                              | 1,190 / 1,190 / 0 / 0                                      | 16,821 import-bound calls abstained as `incomplete-inventory` |

`proposals = persisted`, zero counted exclusions, and zero silent gap hold for every runner. The Q1/Q2 zero counts do not provide positive certification evidence: the current implementation abstained on every import-bound call because the candidate inventory was incomplete.

The tables show current results beside the earlier `ffbd59732` evaluation. Each cell is `sites / independent groups / successful groups / valid contradictions / one-sided 95% lower bound`. The zero lower bound for an empty signature is the evaluator's no-trials sentinel.

### VS Code workbench track

| Rule signature             | Amendment 3                    | `ffbd59732` baseline                 |
| -------------------------- | ------------------------------ | ------------------------------------ |
| `q1:named-import:v1`       | 0 / 0 / 0 / 0 / 0              | 1,153 / 1,131 / 1,131 / 0 / 0.997355 |
| `q2:reexport-trace:v1`     | 0 / 0 / 0 / 0 / 0              | 299 / 297 / 297 / 0 / 0.989964       |
| `q3:super-call:v1`         | 19 / 19 / 19 / 0 / 0.854131    | 19 / 19 / 19 / 0 / 0.854131          |
| `q3:this-inherited:v1`     | 0 / 0 / 0 / 0 / 0              | 0 / 0 / 0 / 0 / 0                    |
| `q3:typed-receiver:v1`     | 320 / 304 / 304 / 0 / 0.990194 | 320 / 304 / 304 / 0 / 0.990194       |
| `q3:new-receiver:v1`       | 227 / 220 / 220 / 0 / 0.986475 | 227 / 220 / 220 / 0 / 0.986475       |
| `single-candidate-this-v1` | 0 / 0 / 0 / 0 / 0              | 0 / 0 / 0 / 0 / 0                    |

### Docuvia temporal track

| Rule signature             | Amendment 3                  | `ffbd59732` baseline           |
| -------------------------- | ---------------------------- | ------------------------------ |
| `q1:named-import:v1`       | 0 / 0 / 0 / 0 / 0            | 502 / 477 / 477 / 0 / 0.993739 |
| `q2:reexport-trace:v1`     | 0 / 0 / 0 / 0 / 0            | 12 / 12 / 12 / 0 / 0.779078    |
| `q3:super-call:v1`         | 0 / 0 / 0 / 0 / 0            | 0 / 0 / 0 / 0 / 0              |
| `q3:this-inherited:v1`     | 0 / 0 / 0 / 0 / 0            | 0 / 0 / 0 / 0 / 0              |
| `q3:typed-receiver:v1`     | 4 / 4 / 4 / 0 / 0.472871     | 4 / 4 / 4 / 0 / 0.472871       |
| `q3:new-receiver:v1`       | 104 / 95 / 95 / 0 / 0.968958 | 104 / 95 / 95 / 0 / 0.968958   |
| `single-candidate-this-v1` | 0 / 0 / 0 / 0 / 0            | 0 / 0 / 0 / 0 / 0              |

The only evaluation differences are the Q1 and Q2 proof populations disappearing: VS Code Q1 changed by −1,153 sites / −1,131 groups and Q2 by −299 / −297; Docuvia Q1 changed by −502 / −477 and Q2 by −12 / −12. No valid contradictions appeared, and all Q3 signature counts and bounds match the prior evaluation. Q1 nevertheless fails the gate because both tracks have zero groups and lower-bound sentinel `0`, below `.990`.

Per task-provided provenance, the `#570` and `#576` implementation work was developed without access to these labels and was unrelated to the frozen certification samples. The repository records merge timestamps after the VS Code labels-opened time (`2026-10-07T04:47:59.662Z`); merge timestamps alone do not establish when the implementation work occurred or an individual's label access. This amendment reused the existing label bytes unchanged and opened no new labels.

The aggregate, runner output hashes, parity counts, and per-signature comparisons are recorded in [amendment-3-aggregate.json](tiered-call-resolution-certification-q1-recert-evidence/amendment-3-aggregate.json). Full proof inventories and evaluator outputs remain in the local `/private/tmp/docuvia-q1-recert/amendment-3/` run directory; no sample-level label data was added to the repository. The runtime pins and product resource were not changed, and the bundled CLI continues to record `certificationStatus: "rejected"` with no certified signatures.
