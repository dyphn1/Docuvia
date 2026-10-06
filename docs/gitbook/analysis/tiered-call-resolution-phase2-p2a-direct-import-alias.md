# GRPH-008 P2-A — Direct Import Alias Candidates

**Status:** Bounded candidate enrichment is implemented and measured as candidate generator v4. The rule adds direct named relative-import aliases only when parser facts bind the caller’s callee to that import and a single hash-matched target file exports exactly one supported callable declaration. Candidate generation remains source-only. This slice does not change ranking, thresholds, confidence, strict proof, `candidateSetComplete`, or Tier B execution/skip behavior.

This follows [#559 comment 5969397300](https://github.com/dyphn1/Docuvia/issues/559#issuecomment-5969397300): candidate recall comes before ranking; hard or unsupported cases continue to LSP. It is not a module resolver or a second TypeScript checker.

## Rule boundary

- Only direct named imports with a different local alias and a relative module path are considered. The destination must resolve to one source-facts path and one file whose content hash matches the pinned facts.
- Parser facts must show one direct named export of the imported name, and the indexed target must identify exactly one top-level function or function-valued declaration.
- The caller must have a same-source-hash call-site whose lexical binding is that import. Parameters, local shadows, duplicate imports, stale source, and absent/legacy binding facts fail closed.
- Type-only imports, defaults, namespaces/wildcards, path aliases, package imports, re-export chains, ambiguous `.js` destinations, unsupported declarations, and tagged templates do not gain candidates. These cases remain on the existing LSP/Tier B path.
- Generator version is `declared-member-hypothesis-v4`; the change invalidates v3 signatures. All 31,578 output rows still have `candidateSetComplete=false`; no row becomes `likely` or `proven`, and no candidate result authorizes a Tier B skip.

## Candidate recall and zero-candidate results

The v3 comparison is the frozen candidate output `3c3ff5…`, evaluated under the same corrected `(snapshotId, repoId)` oracle mapping, facts, and labels as v4. The unique-mappable positive-target denominator is separate from all eligible call-site rows. Ambiguous and unmapped positive target occurrences are shown separately. All-site zero-candidate and candidate-size measures include every eligible row.

| Split       | All eligible sites | Unique-mappable positive targets | Ambiguous / unmapped positive occurrences | Covered unique positives, v3 → v4 |        Recall, v3 → v4 | All-site zero candidates, v3 → v4 | Candidate size p50 / p95 / max, v3 = v4 |
| ----------- | -----------------: | -------------------------------: | ----------------------------------------: | --------------------------------: | ---------------------: | --------------------------------: | --------------------------------------: |
| Train       |             13,496 |                           12,177 |                                 861 / 469 |                   12,167 → 12,170 |  99.91788% → 99.94251% |         471 → 468 (3.49% → 3.47%) |                            1 / 64 / 118 |
| Calibration |              2,966 |                            2,766 |                                  13 / 187 |                     2,749 → 2,750 |  99.38539% → 99.42155% |         194 → 193 (6.54% → 6.51%) |                             1 / 23 / 35 |
| Test        |             12,422 |                           11,547 |                                 521 / 354 |                   11,492 → 11,508 |  99.52369% → 99.66225% |         336 → 320 (2.71% → 2.58%) |                            1 / 32 / 305 |
| Temporal    |              2,694 |                            2,651 |                                    7 / 36 |                     2,644 → 2,651 | 99.73595% → 100.00000% |           29 → 22 (1.08% → 0.82%) |                            1 / 28 / 137 |

Positive-target counts are occurrences; multiple positives can belong to one site. Candidate recall uses only unique-mappable positive targets. The all-site columns retain rows with ambiguous or unmapped labels, missing call shapes, and zero candidates.

A source-row comparison keyed on `sampleId` found exactly 27 added candidate memberships and zero removals across 31,578 rows (v3: 172,442 memberships; v4: 172,469). All 27 added sites are `bare` calls. The split/family distribution is:

| Split       | Added memberships by family | Call shapes with additions |
| ----------- | --------------------------- | -------------------------- |
| Train       | Docuvia 2; Nest 1           | bare: 3                    |
| Calibration | Repomind 1                  | bare: 1                    |
| Test        | GitNexus 16                 | bare: 16                   |
| Temporal    | GitNexus 7                  | bare: 7                    |

No additions occurred for Onyx, Understand-Anything, code-review-graph, Graft, or typescript-language-server. The test/temporal labels were already exposed; those fixed candidate-only results are descriptive regression data, not rule-selection evidence, unseen confirmation, or certification. The earlier 27 train/cal miss audit had seven tagged-template rows; this rule leaves them unsupported. P2-B/System One heldout evaluation was not invoked.

The full per-family and per-call-shape distributions, zero-candidate rates, size percentiles, label-denominator counts, and per-site set delta are in the machine-readable [evidence directory](tiered-call-resolution-phase2-p2a-direct-import-alias-evidence/).

The follow-up [TRAIN candidate-stage audit](tiered-call-resolution-phase2-p2a-candidate-stage-train-audit.md) separates raw generated keys, mapped target IDs, and ordered proposals. It finds 7 raw generator misses where call-shape evidence is missing (`calleeKind=unmapped`) and 21 additional uniquely mappable targets lost before the final proposal set; it does not change candidate or ranking behavior.

## Source cost and provenance

The metric-producing source-only runner processed ten snapshots and 31,578 rows in 60.594 seconds. It parsed 3,426 call-site files and 22 additional unique import-target files, with zero parse failures. The additional targets were Nest (1), Docuvia (2), GitNexus July snapshot (6), and GitNexus September snapshot (13). Combined parser wall time was 11.714 seconds; an isolated per-target timing was not recorded. Hypothesis/index work was 21.129 seconds; measured per-call hypothesis p50/p95 was 0.378/2.304 ms. These are corpus-run timings, not end-to-end request latency or memory measurements.

The metric-producing prediction manifest records `labelsRead=false`, Node `v24.14.1`, schema 2, mapping scope `(snapshotId, repoId)`, corrected facts hash `ba7b631b36ed05b1f16c6b500b0c17b5e4273acd939a493800848225c4dad14e`, and call-site hash `b61764cdaa1168ba453689c5e11f6a9b035a05273532068648092c48a0dbd362`. The prediction bytes hash to `6d99b1b940d470cbeb94e2bd55527a8e372d2c30c26b56b7d51fc9d773c0e622`; the metric-producing generator implementation hash is `65ae84bdec86272ecfeb8739af8b957702d809c89f6cd3707c4c8051826b281c`; snapshot-scoped oracle mapping hash is `3088674bee530052f7b7c5575f0714f217b4774074b92de2b169fe813d89ec81`.

After the final helper refactor and type-only-import base-candidate preservation, a source-only reproduction processed the same 31,578 rows in 61.233 seconds with `labelsRead=false`. It emitted byte-identical prediction JSONL (`6d99b1b940d470cbeb94e2bd55527a8e372d2c30c26b56b7d51fc9d773c0e622`) under final generator implementation hash `f51c86da6dc003082a3dc5e4015d45e60e25696fa694912e782d92b57b247182`. The existing split metrics remain tied to the earlier measured prediction manifest; their input prediction bytes are identical. No test or temporal labels were read again.

## Reproduction

Run from the repository root with Node `v24.14.1`. Source prediction generation did not read labels. Each evaluator command opened only its named split. Test and temporal were evaluated once, after the source predictions and generator version were frozen; do not use them to choose or change rules.

```sh
PATH=/Users/daniel.chang/.nvm/versions/node/v24.14.1/bin:$PATH node --import tsx scripts/semantic-corpus/phase2-tiered-call-resolution-runner.mts --predictions-only --out evaluate/results/semantic-corpus/v1/phase2-p2a-direct-import-alias-attempt-1

# Final-code source-only reproduction; labels are not loaded by this mode.
PATH=/Users/daniel.chang/.nvm/versions/node/v24.14.1/bin:$PATH node --import tsx scripts/semantic-corpus/phase2-tiered-call-resolution-runner.mts --predictions-only --out evaluate/results/semantic-corpus/v1/phase2-p2a-direct-import-alias-final-source-reproduction

PATH=/Users/daniel.chang/.nvm/versions/node/v24.14.1/bin:$PATH node --import tsx scripts/semantic-corpus/phase2-tiered-call-resolution-candidate-evaluation.mts --predictions evaluate/results/semantic-corpus/v1/phase2-p2a-direct-import-alias-attempt-1/predictions.jsonl --split train --out evaluate/results/semantic-corpus/v1/phase2-p2a-direct-import-alias-attempt-1/candidate-recall-train.json

PATH=/Users/daniel.chang/.nvm/versions/node/v24.14.1/bin:$PATH node --import tsx scripts/semantic-corpus/phase2-tiered-call-resolution-candidate-evaluation.mts --predictions evaluate/results/semantic-corpus/v1/phase2-p2a-direct-import-alias-attempt-1/predictions.jsonl --split calibration --out evaluate/results/semantic-corpus/v1/phase2-p2a-direct-import-alias-attempt-1/candidate-recall-calibration.json

PATH=/Users/daniel.chang/.nvm/versions/node/v24.14.1/bin:$PATH node --import tsx scripts/semantic-corpus/phase2-tiered-call-resolution-candidate-evaluation.mts --predictions evaluate/results/semantic-corpus/v1/phase2-p2a-direct-import-alias-attempt-1/predictions.jsonl --split test --out evaluate/results/semantic-corpus/v1/phase2-p2a-direct-import-alias-attempt-1/candidate-recall-test.json

PATH=/Users/daniel.chang/.nvm/versions/node/v24.14.1/bin:$PATH node --import tsx scripts/semantic-corpus/phase2-tiered-call-resolution-candidate-evaluation.mts --predictions evaluate/results/semantic-corpus/v1/phase2-p2a-direct-import-alias-attempt-1/predictions.jsonl --split temporal --out evaluate/results/semantic-corpus/v1/phase2-p2a-direct-import-alias-attempt-1/candidate-recall-temporal.json
```

## Artifact hashes

| Tracked evidence artifact                                                                                                                         | SHA-256                                                            |
| ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| [Candidate prediction manifest](tiered-call-resolution-phase2-p2a-direct-import-alias-evidence/candidate-prediction-manifest.json)                | `dbf87ff8a48ad5b724e976856f908df1f5651580388f132fbb8c565b37dc1275` |
| [Train candidate recall](tiered-call-resolution-phase2-p2a-direct-import-alias-evidence/candidate-recall-train.json)                              | `36499989f81c9015fd30063e140da912df108f03f211cd75e41fa9465bd12846` |
| [Calibration candidate recall](tiered-call-resolution-phase2-p2a-direct-import-alias-evidence/candidate-recall-calibration.json)                  | `a7635c145c2dc4bbb3319a79da197eadcf57f922bac491b54858a15fe6d9b3e4` |
| [Test candidate recall (locked regression)](tiered-call-resolution-phase2-p2a-direct-import-alias-evidence/candidate-recall-test.json)            | `a6223e2e4f4af868d07865409de4c25229778c9e41a050635effead968edb31b` |
| [Temporal candidate recall (locked regression)](tiered-call-resolution-phase2-p2a-direct-import-alias-evidence/candidate-recall-temporal.json)    | `4224c5caba3ab63e2115b6c650ad4404e1cb4b0b27aa0496d0bb98962e1ad4c9` |
| [Final source-only reproduction manifest](tiered-call-resolution-phase2-p2a-direct-import-alias-evidence/final-source-reproduction-manifest.json) | `de7dc8ec977ac316addce6263fcdb9e3190ceed84a4cc8b7e7506f2a04f5ad9e` |
| [V3→v4 candidate membership diff](tiered-call-resolution-phase2-p2a-direct-import-alias-evidence/candidate-membership-diff.json)                  | `b40742557c32f720ad380aad3e0a9740ffe5e0dea2658ec83ea46c8a28921cb6` |

The full predictions JSONL stays in the local ignored `evaluate/results` tree; its SHA-256 is recorded above and in the tracked manifest. No score is treated as a probability, and no calibration-quality metric is reported for this candidate-only slice.

## Validation

All implementation checks ran under Node v24.14.1:

- Focused parser, call-shape, and hypothesis-service tests: 3 files / 62 tests passed.
- pnpm run build: root TypeScript build plus all 11 workspace builds passed.
- pnpm run lint: passed with zero findings.
- Scoped pnpm exec prettier --check passed; git diff --check passed.
- bash scripts/test-quality-gate.sh: exit 0; weak assertions were 215/7,159 against the 220 ceiling, and the category ratchet stayed at the unchanged 234/234 baseline.

The standard Node 24 pre-push hook runs the full repository suite before publishing the commit; its terminal result and remote CI status are tracked on PR #562. No Tier B scheduling, ranking threshold, production confidence, or strict-proof gate was changed.
