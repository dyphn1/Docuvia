# Tiered call resolution certification — temporal track 2

## Result

After the pre-registration independence amendment, `q1:named-import:v1` has 477 independent persisted-proof duplicate groups. Oracle labeling produced 477 successes, zero valid contradictions, and a one-sided 95% Clopper–Pearson lower bound of 0.993739. This exceeds the 0.99 target.

`q3:typed-receiver:v1` has four groups on this track, so it remains underpowered. The other signatures are reported below. This is an evaluation report only: no production certification record was written and no Tier B skip was enabled.

## Pinned source and pre-registration

- Training baseline: `dyphn1/Docuvia` at `204c40fb7080ebded011f65a3dae7d749cce9ed1`.
- Target: `dyphn1/Docuvia` at `113a2afe97d2407d0b6ba19624f42408875831cf` (`feat/559-temporal-certification`, equal to `main`; 189 commits after the baseline).
- License: MIT, as declared by the existing corpus specification and project package metadata.
- Both revisions were materialized with `git archive` under `/private/tmp`. The baseline supplied duplicate-group inventory only; the later snapshot was evaluation-only.
- Temporal novelty uses the existing duplicate-group fingerprint: callee plus whitespace-normalized ±2-line context must be absent from the entire baseline snapshot. The temporal snapshot uses a separate test-split corpus spec because the collector assigns temporal samples to a test family.
- The original source-only collector reported 1,121 temporal sites across 1,032 duplicate groups and made zero oracle invocations.

The baseline snapshot had 714 tracked files, 42,989 call sites, and 36,777 duplicate groups. The target had 911 tracked files, 67,717 call sites, and 59,709 duplicate groups; 4,660 target sites were eligible before temporal filtering.

### Pre-registration amendment 1

**Pre-registration amendment 1, made before any oracle label was opened, reason: independence.** Exclude every sample whose caller path matches `lib/core/src/semantic/call-resolution-*`, `scripts/semantic-corpus/**`, or `test/semantic-corpus/**`. The first pattern removed 174 sites across 154 groups. The other patterns removed zero sites. The amended manifest contains 947 sites across 878 groups.

| Pre-registration artifact                                 | SHA-256                                                            |
| --------------------------------------------------------- | ------------------------------------------------------------------ |
| Source-only corpus spec                                   | `c489bf0badb8d46a26b50418dd8d86f00e5f24ee7af87a4e9c081ca87222abd0` |
| Original temporal manifest, superseded (canonical JSON)   | `2ef09caa48cd875fa3224bd434ee08888717f46f783c312e7a47ea22f192ebf8` |
| Amended temporal manifest (canonical JSON and file bytes) | `0c161537e3d9680b6e2d66c613fba540002cfb1ca88fc50d36fe48006cd64841` |
| Baseline snapshot                                         | `4215e47a3f8328407b36456d8043a0b33b5408887dabec6b9c3abadf2e446341` |
| Target snapshot                                           | `853dc03a873bdb7f7e95ef37a68f2192fe03fbbc6068938ae8661a6ce9d8a24d` |

The amended freeze is [freeze-manifest.json](tiered-call-resolution-certification-temporal-2-evidence/freeze-manifest.json), SHA-256 `526b5e656ed23b00879386cf842e0901530fc3ca3fd450f91aa33a59af5103b5`. It supersedes the original freeze hash `0dde7fbdc9b7e571944b453db133163acd7a81f588c8a6c03dcfedd3721550cb`, preserved byte-for-byte as [freeze-manifest-original.json](tiered-call-resolution-certification-temporal-2-evidence/freeze-manifest-original.json).

## Persisted-proof counts after amendment

The Q1, Q2, and Q3 whole-source runners parsed 907 target files with zero parse failures. They produced 3,347 Q1, 47 Q2, and 1,190 Q3 persisted proof rows. Proofs joined to the frozen sample by exact repository-relative path, line, column, and callee. Group counts below are independent duplicate groups within that proof set.

| Signature                  | Proof sites | Independent groups | Required groups | Pre-registration         |
| -------------------------- | ----------: | -----------------: | --------------: | ------------------------ |
| `q1:named-import:v1`       |         502 |                477 |             299 | Passes count gate (+178) |
| `q2:reexport-trace:v1`     |          12 |                 12 |             299 | Underpowered             |
| `q3:super-call:v1`         |           0 |                  0 |             299 | No in-scope proofs       |
| `q3:this-inherited:v1`     |           0 |                  0 |             299 | No in-scope proofs       |
| `q3:typed-receiver:v1`     |           4 |                  4 |             299 | Underpowered (short 295) |
| `q3:new-receiver:v1`       |         104 |                 95 |             299 | Underpowered             |
| `single-candidate-this-v1` |           0 |                  0 |             299 | No in-scope proofs       |

## Oracle certification results

The frozen 947-site sample was labeled with `typescript-language-server 5.3.0 + tsserver 5.9.3`, using the existing oracle configuration hash `032d80801a24de4e55c32cf1d0c0df189281dfb6f44f0a366be4d76451fd627e` (30-second request timeout, 60-second readiness cap, 500 ms poll interval, and 4,096 MB tsserver memory). All seven project groups became ready. The oracle returned resolved labels for all 947 sites in 947 sample requests; it also made 14 readiness probes. Label and per-site evaluation files remain under `/private/tmp/docuvia-temporal-2/amendment-1/labels/` and are referenced only by hash in the aggregate evidence.

| Signature                  | Sites | Independent groups (n) | Successes | Valid contradictions | One-sided 95% lower bound |
| -------------------------- | ----: | ---------------------: | --------: | -------------------: | ------------------------: |
| `q1:named-import:v1`       |   502 |                    477 |       477 |                    0 |                  0.993739 |
| `q2:reexport-trace:v1`     |    12 |                     12 |        12 |                    0 |                  0.779078 |
| `q3:super-call:v1`         |     0 |                      0 |         0 |                    0 |                         — |
| `q3:this-inherited:v1`     |     0 |                      0 |         0 |                    0 |                         — |
| `q3:typed-receiver:v1`     |     4 |                      4 |         4 |                    0 |                  0.472871 |
| `q3:new-receiver:v1`       |   104 |                     95 |        95 |                    0 |                  0.968958 |
| `single-candidate-this-v1` |     0 |                      0 |         0 |                    0 |                         — |

For each duplicate group, any valid contradiction among its sites makes the group a contradiction; a group succeeds only when every site succeeds. The measured signatures had no inconclusive groups. Only Q1 reaches the requested lower-bound threshold. The aggregate-only result and private artifact hashes are in [docuvia-certification-aggregate.json](tiered-call-resolution-certification-temporal-2-evidence/docuvia-certification-aggregate.json), SHA-256 `323f69ced557c7c02e713ebdb991cbc9cf0c3403f60b05e8f677d77b734c7ebf`.

## Independence and scope limits

The amendment removes all 174 sites in resolver implementation files before labeling, including 71 Q1 proof sites, one typed-receiver proof site, and 74 new-receiver proof sites. No matching samples were found under the semantic-corpus tooling or tests. The remaining Q1 groups still exceed 299. Typed receiver remains underpowered at four groups; the full target had only 151 typed-receiver proof sites before temporal and independence filtering.

Temporal novelty follows the collector’s duplicate-fragment policy, not a per-line Git-diff filter. A selected site has a context fingerprint absent from the baseline; this does not prove the call expression itself lies on a line added after the baseline.

## Freeze and constraints

The amended freeze records the corpus, implementation and tooling hashes, oracle configuration, source exclusion rule, amended manifest hash, proof aggregates, and references to private artifacts. The original freeze is retained as superseded. No Nest samples were reused; GitNexus was not used; no Onyx `ee/` path was inspected. No network access, `.git` write in the Docuvia checkout, production certification record, Tier B skip, or change to `project_files.content_hash` semantics occurred. Temporary snapshot Git metadata was created only under `/private/tmp`.

The independent new-family VS Code pre-registration is in [tiered-call-resolution-certification-vscode.md](tiered-call-resolution-certification-vscode.md). It is not oracle-labeled in this work.
