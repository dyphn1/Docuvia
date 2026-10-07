# Tiered call resolution certification — VS Code pre-registration

## Status

VS Code is a new-family, MIT-licensed pre-registration track, pinned to local `microsoft/vscode` HEAD `4f2dfc552c95b9ff4729fa13f109bfda5f886d69`. The final deterministic scope contains 46,468 eligible sample sites across 45,091 independent duplicate groups. The source-only persisted-proof inventory has 10,244 `q1:named-import:v1` groups and 3,016 `q3:typed-receiver:v1` groups, both above the 299-group count threshold.

**No VS Code oracle labels were opened and `certification-evaluate` was not run.** This document freezes sample and proof scope only; it makes no certification or promotion claim. No production certification record was written and no Tier B skip was enabled.

## Source and frozen population

- Local checkout: `/Users/daniel.chang/Desktop/GitHub/vscode`; branch `main`; clean at the pinned revision.
- License: MIT, verified in `LICENSE.txt`; license file SHA-256 is `cce33203a80863c22499035b1cfb6aba5df5f02e4ea2669cf5bc5730c1864236`.
- The existing pinned training corpus specification contains no `microsoft/vscode` family.
- The corpus population was pre-registered as tracked TypeScript caller files under `src/**`, excluding `node_modules`, test directories, fixture directories, and test/spec filenames. The full `src/` tree has 9,561 tracked TypeScript files before exclusions; the path rule retained 7,068 before checker eligibility.
- Full-source extraction did not fit the 4,096 MB Node heap. The final deterministic subset is `src/vs/base/**`, `src/vs/platform/**`, and `src/vs/editor/**`, with shared `src/tsconfig*.json`, `src/typings/**`, `src/vscode-dts/**`, and the required `src/vs` support declarations included for the checker. The sample population excludes those support inputs and every source path outside the three selected directories.
- The final subset contains 3,048 sample-population TypeScript files, 3,255 tracked snapshot files, 63,526 Tier A nodes, 80,625 edges, and 133,269 call sites. The TypeScript 5.9.3 checker loaded one program and marked 46,468 sites eligible. The frozen manifest has 45,091 independent groups and zero split drops.

The source snapshot SHA-256 is `10ee8a0703dc08f2dd2f32148e5dfe0f7261cf5f18edbea81b0da7f7efb68162`. The compact pre-label manifest is stored only under `/private/tmp/docuvia-temporal-2/vscode/prelabel-core3/`; its canonical JSON and file SHA-256 is `808a08f4173f27ae8d2f54be8532b565d671bf170d6e718f4117a3c2bb735944` (32,824,173 bytes).

### Memory-driven scope selection

The whole repository and full `src` subtree both exceeded the 4,096 MB Node heap during Tier A analysis, before any manifest or labels were produced. A `src/vs/workbench`-only trial completed Tier A but had zero checker programs because the shared config was outside that subtree. A four-directory scope that included workbench produced a source-only manifest, but its Q1 whole-source proof runner exceeded the configured heap before emitting an inventory. The final base/platform/editor subset completed pre-label collection and all three proof inventories. The full attempt history and unlabelled intermediate artifacts are retained under `/private/tmp`; hashes and aggregate counts are in the repository evidence.

## Persisted-proof groups by signature

Proof inventories were joined to the frozen sample on repository-relative path, line, column, and callee. The table counts only persisted inventory rows; service-only proposals that did not persist are excluded.

| Signature                  | Persisted proof sites in sample | Independent groups | Required groups | Pre-registration   |
| -------------------------- | ------------------------------: | -----------------: | --------------: | ------------------ |
| `q1:named-import:v1`       |                          10,462 |             10,244 |             299 | Passes count gate  |
| `q2:reexport-trace:v1`     |                           1,124 |              1,111 |             299 | Passes count gate  |
| `q3:super-call:v1`         |                              35 |                 35 |             299 | Underpowered       |
| `q3:this-inherited:v1`     |                               0 |                  0 |             299 | No in-scope proofs |
| `q3:typed-receiver:v1`     |                           3,076 |              3,016 |             299 | Passes count gate  |
| `q3:new-receiver:v1`       |                           1,168 |              1,120 |             299 | Passes count gate  |
| `single-candidate-this-v1` |                               0 |                  0 |             299 | No in-scope proofs |

The Q1, Q2, and Q3 whole-source parity runners parsed 3,247 TypeScript files with zero parse failures. Each emitted persisted proof rows but returned a nonzero status because not every service proposal appeared in its persisted projection: Q1 10,532 service sites versus 10,462 persisted (70 missing); Q2 1,130 versus 1,124 (6 missing); Q3 5,429 versus 5,404 (25 missing). The table uses the emitted persisted rows only and exact-joins them to the frozen sample. Peak runner RSS was 4.15 GiB for Q1, 4.03 GiB for Q2, and 4.38 GiB for Q3; Node's V8 heap was capped at 4,096 MB. These parity gaps must be resolved before any later oracle certification.

The current freeze manifest is [freeze-manifest.json](tiered-call-resolution-certification-vscode-evidence/freeze-manifest.json), SHA-256 `fb7244f94549ed90b5053c81e0c1475fad1eaa3a2d23aa10facf21da0638f0ab`. Its [proof-run aggregate](tiered-call-resolution-certification-vscode-evidence/proof-run-aggregate.json), SHA-256 `0ebeaa50cc382d737955974c38222a18f88cfef1412ef55a6e2846ceb6c8e8d5`, stores only hashes, aggregate counts, and runner diagnostics. Per-sample manifest and proof rows remain in `/private/tmp` and are referenced by hashes.

## Estimated labeling cost

No VS Code timing probe was run because a definition request on a sampled site would open its label. If the full frozen sample is labeled later, the collector will issue 46,468 definition requests in one `src/tsconfig.json` project group. The same oracle configuration labeled 947 Docuvia sites in 5.671 seconds, about 6.0 seconds per 1,000 requests including readiness work. A simple cross-track throughput estimate is about 4.6 minutes for 46,468 requests, plus up to the configured 60-second readiness cap and shutdown overhead. This is a planning estimate only; VS Code project load and request latency were not measured. Any later TypeScript server process must retain the 4,096 MB memory cap; actual VS Code server RSS is unknown.

## Freeze and constraints

The oracle configuration is the existing `typescript-language-server 5.3.0 + tsserver 5.9.3` setup, hash `032d80801a24de4e55c32cf1d0c0df189281dfb6f44f0a366be4d76451fd627e`, with a 30-second request timeout, 60-second readiness cap, 500 ms readiness poll, and 4,096 MB tsserver memory limit. It was recorded but never invoked on VS Code.

GitNexus was not used. No Nest samples were reused, no Onyx `ee/` path was inspected, and no network access occurred. The Docuvia and VS Code checkout `.git` directories were not written; temporary snapshot metadata and all per-sample artifacts stayed under `/private/tmp`. No production record, Tier B skip, or `project_files.content_hash` semantic change was made. No repository tooling or production code changed, so no tooling tests were added.
