# Tiered call resolution certification — VS Code new-family track

## Status

VS Code oracle labeling and certification evaluation are complete for the frozen `src/vs/{base,platform,editor}` subset. `q1:named-import:v1` does **not** pass the promotion gate: the lower bound exceeds 0.990, but the evaluator found one valid contradiction. No certification artifact was produced, no runtime loader was added, and no Tier B skip was enabled.

The VS Code source is MIT licensed and pinned to `microsoft/vscode` revision `4f2dfc552c95b9ff4729fa13f109bfda5f886d69`. The track remains separate from the Docuvia temporal track. No GitNexus or Onyx enterprise data was used.

## Pre-label amendment 1 and re-freeze

Before any VS Code oracle label was opened, amendment 1 recorded: **implementation updated to `d325bf3ff32b8326769d116009543ba96143a2c6`; persisted proof gap 0/0/0 for Q1/Q2/Q3; call-site sample unchanged.** The amendment incorporates the #571 persisted-proof projection fix. The original freeze is preserved byte-for-byte as [freeze-manifest-superseded.json](tiered-call-resolution-certification-vscode-evidence/freeze-manifest-superseded.json), SHA-256 `fb7244f94549ed90b5053c81e0c1475fad1eaa3a2d23aa10facf21da0638f0ab`.

The amended freeze is [freeze-manifest.json](tiered-call-resolution-certification-vscode-evidence/freeze-manifest.json), SHA-256 `8292332e7b01110e73cd44e6d670a7c5c6c0d2c135c79a40e91fd4a4d73928a2`. The unchanged source snapshot SHA-256 is `10ee8a0703dc08f2dd2f32148e5dfe0f7261cf5f18edbea81b0da7f7efb68162`; the unchanged prelabel manifest SHA-256 is `808a08f4173f27ae8d2f54be8532b565d671bf170d6e718f4117a3c2bb735944` (46,468 sites / 45,091 groups).

### Persisted proof re-runs

All three runners parsed 3,247 source files with zero parse failures. Service proposals and persisted rows now match exactly:

| Runner          | Service proposals | Persisted | Gap |            Peak RSS | Exit |
| --------------- | ----------------: | --------: | --: | ------------------: | ---: |
| Q1 named import |            10,532 |    10,532 |   0 | 4,477,009,920 bytes |    0 |
| Q2 re-export    |             1,130 |     1,130 |   0 | 4,506,140,672 bytes |    0 |
| Q3 receiver     |             5,429 |     5,429 |   0 | 4,533,338,112 bytes |    1 |

Q3 persisted every proposal. Its command still exits 1 because two separate projection invariants remain false: `callLinksChangedOnlyForQ3Sites=false` and `zeroCallerOnlyChanges=false`. The checks `allQ3ServiceProofsPersisted` and `everyRemovedCallLinkReplacesWrongTarget` are true. Thus Q3 has no persisted-proof gap, but the broader projection parity run is not fully clean. Of its 5,429 persisted Q3 rows, 4,299 join to this subset; 1,130 are outside the frozen population and are excluded by exact scope matching.

The aggregate counts and private artifact hashes are in [proof-run-amendment-1-aggregate.json](tiered-call-resolution-certification-vscode-evidence/proof-run-amendment-1-aggregate.json), SHA-256 `8de6a5c77c463bd5d47327557e7bd0cfdd707061c90986e463ddf7c72a46ddf9`. Per-site proof files remain under `/private/tmp/docuvia-temporal-2/vscode/`.

## Oracle labeling

The same oracle configuration was used: `typescript-language-server 5.3.0 + tsserver 5.9.3`, configuration SHA-256 `032d80801a24de4e55c32cf1d0c0df189281dfb6f44f0a366be4d76451fd627e`, request timeout 30 seconds, readiness cap 60 seconds, and tsserver memory cap 4,096 MB.

Labels opened at `2026-10-07T02:04:59.700Z`. The single `src/tsconfig.json` project became ready in 2.764 seconds. The run issued 46,468 definition requests plus 6 readiness probes; 46,465 sites resolved and 3 were unsupported. Internal elapsed time was 10.771 seconds; process wall time was 13.57 seconds. Peak oracle RSS could not be measured: `/usr/bin/time -l` failed when sandbox permissions denied `sysctl kern.clockrate`. The configured tsserver cap remained 4,096 MB; no memory estimate is substituted for a measurement.

The per-sample labels remain in `/private/tmp/docuvia-temporal-2/vscode/amendment-1/labels/oracle-labels.json` (SHA-256 `0d19b2fb4983f8e2231daa3d02423ef3186e30c21ce3915c560cc1e252eae4d0`). The complete certification evaluation remains in `/private/tmp/docuvia-temporal-2/vscode/amendment-1/certification-results.json` (SHA-256 `8b7cc49f42ef4aad7635dc6679b6df3199510ac1d0378989cd3059f6331c3974`).

## Certification evaluation

`certification-evaluate` ran for every configured signature. `n` counts independent duplicate groups; lower bounds are one-sided 95% Clopper–Pearson values.

| Signature                  |  Sites |      n | Successes | Valid contradictions | Lower bound |
| -------------------------- | -----: | -----: | --------: | -------------------: | ----------: |
| `q1:named-import:v1`       | 10,532 | 10,312 |    10,311 |                    1 |    0.999540 |
| `q2:reexport-trace:v1`     |  1,130 |  1,117 |     1,117 |                    0 |    0.997322 |
| `q3:super-call:v1`         |     35 |     35 |        35 |                    0 |    0.917968 |
| `q3:this-inherited:v1`     |      0 |      0 |         0 |                    0 |    0.000000 |
| `q3:typed-receiver:v1`     |  3,094 |  3,034 |     3,034 |                    0 |    0.999013 |
| `q3:new-receiver:v1`       |  1,170 |  1,122 |     1,122 |                    0 |    0.997334 |
| `single-candidate-this-v1` |      0 |      0 |         0 |                    0 |    0.000000 |

The sole contradiction is:

- Site: `src/vs/platform/agentHost/node/claude/claudeModelSelection.ts:85:8`, callee `toSdkModelId`
- Proof target: `src/vs/platform/agentHost/node/claude/claudeModelId.ts#toSdkModelId@L169`
- Oracle target: `src/vs/platform/agentHost/node/claude/claudeModelId.ts#toSdkModelId`

The proof key's zero-based `@L169` location points to the object method at source line 170 (`toSdkModelId: () => formatModelId(...)`). The oracle target is the exported `toSdkModelId()` implementation at source line 61. These are distinct declarations with the same name, so the evaluator's valid contradiction is substantive and must be fixed before Q1 can satisfy the zero-contradiction gate.

Root cause: the amendment-1 implementation includes the #571 projection change, which maps an ambiguous same-name target to the last function node in source order. Here the file has three `toSdkModelId` overload declarations at lines 59–61 plus a later object-literal property `toSdkModelId: () => ...`, so the last node is the object property. Before #571 this site was dropped as an ambiguous target mapping; #571 turned that silent drop into a wrong persisted target. The projection must instead select the node that matches the proof's declaration (or keep failing closed). Because this labeled VS Code sample has now been observed, it cannot be reused to recertify Q1 after that fix; recertification needs a fresh, unseen new-family sample.

## Cross-track promotion decision

The Docuvia temporal Q1 result is 502 sites / 477 groups / 477 successes / 0 contradictions / lower bound `0.993739`. VS Code Q1 has 10,532 sites / 10,312 groups / 10,311 successes / 1 contradiction / lower bound `0.999540`. Although both lower bounds exceed 0.990, Q1 fails the required zero-contradiction condition on VS Code. It is not promoted. `q3:typed-receiver:v1` also cannot be promoted: VS Code has 3,034 successful groups, but Docuvia temporal has only 4 groups and lower bound `0.472871`.

Because Q1 did not pass both tracks, no candidate certification JSON was generated. The existing validator was not used on a nonexistent candidate, and no artifact test was added. The existing loader is `loadCallResolutionCertificationArtifact()` in `lib/ui-core/src/workflows/analyze/call-resolution-certification.ts`; there is currently no production call site loading artifact bytes. Runtime adoption would require loading and validating the pinned bytes, then passing its trusted decision through `AnalyzeWorkflow.executeTierBBatch()` / `buildTierBBatchDeps()` in `analyze-workflow.ts` to `TierBBatchDeps.callResolutionCanary` in `run-tier-b-batch.ts`, which passes policy to `tier-b-edge-resolution-orchestrator.ts`.

If a valid artifact were later loaded there, `isCertifiedNonCanaryCallSite()` would keep a current, proven, source-hash-matching, non-quarantined site on its certified result outside the deterministic default 10% per-signature canary; canary sites would still be scheduled for Tier B. Stale, unproven, quarantined, or uncertified signatures would continue through Tier B. No such runtime behavior changed in this task.

The hashes and aggregate results are in [vscode-certification-aggregate.json](tiered-call-resolution-certification-vscode-evidence/vscode-certification-aggregate.json), SHA-256 `d9b6e7b4b02e71295a3231c30adcff211ccc433f806e7f47fd6616ec58ed876f`. Per-sample proofs, labels, and evaluation rows remain outside the repository under `/private/tmp`.

## Constraints

No GitNexus dataset or Onyx enterprise path was used. No network access, `.git` writes, `project_files.content_hash` semantic changes, production certification record, runtime loader, or Tier B skip was introduced.
