# System-1 deterministic query routing and request classification feasibility

## Why this analysis

Every #553 model that tried to guess the target directly failed leave-one-family-out (LOFO) certification. That covers CUA-S1, Laya, the B-4 routing head and the B-5 commit-is-exact router. A router could find 99%-exact subsets in-sample, but the errors were family-specific and certified 0 rows under LOFO. The direction agreed on 2026-10-01 follows #468: the model is a typed decision layer that chooses **which read-only deterministic query to run**, or sends the request to LSP, and the answer comes from the query rather than from the model. This analysis first measures how much the deterministic queries solve on their own (step 1). It then checks whether "which query resolves this request" is a classification that transfers across repository families (step 2).

## Setup and protocol

A query may return only one existing Tier A candidate option. It abstains whenever source resolution, export tracing, call binding or receiver typing is not syntactically certain. No LSP or model resolves a query. Parsing uses the TypeScript compiler API `createSourceFile` only, with no Program, type checker or LSP.

The trusted-label definition follows CUA-S1: `reviewStatus=confirmed`, `oracleStatus=resolved`, and non-conflicting positive and negative targets. Coverage and precision use trusted requests with at least two candidate options. Candidate misses remain Tier A candidate-generation failures and stay in the coverage denominator.

The design pool is train plus calibration, which spans seven repository families. Rules were designed on the pool and frozen by SHA-256. Temporal and test were then run once per frozen rule version as regression checks; this held-out data was already seen in earlier #553 work. The runner materialized one `(repoId, revision)` snapshot at a time with the corpus snapshot helpers, verified its `snapshotHash`, processed all requests for that snapshot and then deleted it. Node heap was capped at 4 GiB, and a memory guard aborted below 25% free memory. Minimum observed free memory was 69% for both pool and held-out runs.

The Tier A comparison replays the saved certified LOFO rank-prior policy at 0.990 (threshold 1.0). Its policy SHA-256 is `8be603caadd75b7fc23495bcddd81604596684e6a8bb134d28ff9c2e7113a3c5`. Fold calibrators were reconstructed from the saved responses and checked against the recorded calibration hashes.

## Rules

Frozen rule source SHA-256: **`06ea3f2f60774ba8dec3634ddfdb24dbdc4f7442f72547f912cb77b3af684013`** (`scripts/semantic-corpus/system1-query-routing-rules.mts`).

- **Q1 import source.** Applies to a direct bare call. The rule verifies the exact caller import binding and resolves a relative source or a configured path alias or base URL. It commits the unique candidate exported by that module whose symbol matches the imported name, and it does not treat a re-export as a declaration.
- **Q2 re-export trace.** Follows named and default aliases and `export *` through resolvable modules, with cycle detection and a depth limit of 16. Any unresolved or ambiguous path abstains.
- **Q3 receiver type.** Handles member calls whose receiver has an explicit class type: `this`, a typed class field or constructor parameter property, an annotated parameter, or a local `const = new C()`. It resolves imported class names and explicit `extends` chains. Generics, unions, inferred bindings, interfaces and unsupported syntax abstain.
- **Same-name guard (all queries).** Tier A disambiguates same-named declarations in one file as `base@L<line>` (C-03). A query builds `path#Symbol` from names, so it cannot tell which of those declarations it proved. If any other candidate shares the committed target's base ID, the query abstains.
- **Cascade.** The fixed order is Q1 → Q2 → Q3, and the first agreeing commit wins. If committed queries disagree, the cascade abstains. No conflicts occurred, and a synthetic test covers the conflict branch.

### Rule revision history

The first frozen version (`844d248d…`) had no same-name guard. It produced 17 wrong commits: 13 in the pool (nestjs/nest, Q1) and 4 in held-out (GitNexus, Q3). Its pool cascade lower bound was 98.70%, below .990. The first write-up described these as a gold/candidate ID-format mismatch. That was wrong.

Request `system1:359c3d92f52f0e62657d1d9d` shows what actually happened. Its options contain both `fake-request.ts#file@L105`, which is `export const file = (…)` and the gold target, and `fake-request.ts#file`, which is a different `file()` declaration and a confirmed negative. The query built `#file` from the export name and committed the wrong declaration. The guard was added because of the 13 pool errors. The held-out run was then repeated once with the new frozen hash. Because the held-out errors had already been seen when the rule changed, the held-out numbers below are a regression check only. The first-version outputs are kept locally under `system1-query-routing-v1-rules-844d248d/`.

## Query results

Coverage is commits divided by trusted multi-candidate requests or duplicate groups. Precision is exact-set precision against gold. Brackets show the one-sided Clopper–Pearson 95% lower bound (α = 0.05).

| Scope               | Query              | Row commits / eligible | Row coverage | Exact-set precision [one-sided CP 95% lower] | Group commits / eligible | Group coverage | Exact-set precision [one-sided CP 95% lower] |
| ------------------- | ------------------ | ---------------------: | -----------: | -------------------------------------------- | -----------------------: | -------------: | -------------------------------------------- |
| Pool                | Q1 import source   |             292 / 6041 |        4.83% | 100.00% [98.98%]                             |               282 / 5123 |          5.50% | 100.00% [98.94%]                             |
| Pool                | Q2 re-export trace |             615 / 6041 |       10.18% | 100.00% [99.51%]                             |               506 / 5123 |          9.88% | 100.00% [99.41%]                             |
| Pool                | Q3 receiver type   |             544 / 6041 |        9.01% | 100.00% [99.45%]                             |               499 / 5123 |          9.74% | 100.00% [99.40%]                             |
| Pool                | Cascade            |            1448 / 6041 |       23.97% | 100.00% [99.79%]                             |              1284 / 5123 |         25.06% | 100.00% [99.77%]                             |
| Held-out regression | Q1 import source   |            1400 / 4272 |       32.77% | 100.00% [99.79%]                             |              1353 / 3681 |         36.76% | 100.00% [99.78%]                             |
| Held-out regression | Q2 re-export trace |             137 / 4272 |        3.21% | 100.00% [97.84%]                             |               135 / 3681 |          3.67% | 100.00% [97.81%]                             |
| Held-out regression | Q3 receiver type   |             523 / 4272 |       12.24% | 100.00% [99.43%]                             |               390 / 3681 |         10.59% | 100.00% [99.23%]                             |
| Held-out regression | Cascade            |            1928 / 4272 |       45.13% | 100.00% [99.84%]                             |              1748 / 3681 |         47.49% | 100.00% [99.83%]                             |

The pool cascade commits 1,448 rows, or 1,284 duplicate groups, with **0 errors**. Its group lower bound is 99.77%, which clears .990 and .995 but not .999 (that needs at least 2,995 error-free groups). Every pool family has 0 wrong commits; see the per-family tables. The held-out regression cascade also has 0 errors in 1,928 rows. There were no cascade conflicts in any split.

## LSP avoidance: Tier A versus Tier A + queries

Tier A + cascade keeps every accepted Tier A decision and runs the query cascade only where Tier A abstains. Avoidance is accepted trusted rows divided by all trusted rows. The Tier A column reproduces the published 44.00% pool, 78.43% temporal and 39.78% test.

| Split                 | Trusted rows | Tier A commits / avoidance | Tier A + cascade commits / avoidance | Combined precision [CP lower] | Combined groups / avoidance | Additional avoidance |
| --------------------- | -----------: | -------------------------- | ------------------------------------ | ----------------------------- | --------------------------- | -------------------: |
| Pool                  |        16396 | 7214 / 44.00%              | 10057 / 61.34%                       | 100.00% [99.97%]              | 9292 / 63.92%               |            +17.34 pp |
| Train                 |        13430 | 5847 / 43.54%              | 7844 / 58.41%                        | 100.00% [99.96%]              | 7133 / 60.46%               |            +14.87 pp |
| Calibration           |         2966 | 1367 / 46.09%              | 2213 / 74.61%                        | 100.00% [99.86%]              | 2159 / 78.82%               |            +28.52 pp |
| Temporal (regression) |         2694 | 2113 / 78.43%              | 2446 / 90.79%                        | 100.00% [99.88%]              | 2390 / 90.67%               |            +12.36 pp |
| Test (regression)     |        12422 | 4941 / 39.78%              | 9096 / 73.22%                        | 100.00% [99.97%]              | 8344 / 74.80%               |            +33.45 pp |

## Per-family and per-ambiguity-class results

Each cell reads `row coverage / row precision [row CP lower]; group coverage / group precision [group CP lower]`. A request with several ambiguity classes appears in each of them.

### Per-family: Pool (train + calibration)

| Group                                                 | Trusted multi rows / groups | Q1 row cov / P [CP]; group cov / P [CP]              | Q2 row cov / P [CP]; group cov / P [CP]              | Q3 row cov / P [CP]; group cov / P [CP]              | Cascade row cov / P [CP]; group cov / P [CP]         |
| ----------------------------------------------------- | --------------------------: | ---------------------------------------------------- | ---------------------------------------------------- | ---------------------------------------------------- | ---------------------------------------------------- |
| 403errors/repomind                                    |                     61 / 43 | 45.90% / 100.00% [89.85%]; 62.79% / 100.00% [89.50%] | 0.00% / — [—]; 0.00% / — [—]                         | 0.00% / — [—]; 0.00% / — [—]                         | 45.90% / 100.00% [89.85%]; 62.79% / 100.00% [89.50%] |
| Egonex-AI/Understand-Anything                         |                   531 / 404 | 1.51% / 100.00% [68.77%]; 1.98% / 100.00% [68.77%]   | 0.00% / — [—]; 0.00% / — [—]                         | 10.17% / 100.00% [94.60%]; 13.37% / 100.00% [94.60%] | 11.68% / 100.00% [95.28%]; 15.35% / 100.00% [95.28%] |
| dyphn1/Docuvia                                        |                  1040 / 908 | 7.40% / 100.00% [96.18%]; 7.93% / 100.00% [95.92%]   | 0.00% / — [—]; 0.00% / — [—]                         | 11.54% / 100.00% [97.53%]; 13.00% / 100.00% [97.49%] | 18.94% / 100.00% [98.49%]; 20.93% / 100.00% [98.44%] |
| nestjs/nest                                           |                 4101 / 3485 | 2.90% / 100.00% [97.51%]; 3.36% / 100.00% [97.47%]   | 14.68% / 100.00% [99.50%]; 14.15% / 100.00% [99.39%] | 7.85% / 100.00% [99.07%]; 8.03% / 100.00% [98.94%]   | 25.43% / 100.00% [99.71%]; 25.54% / 100.00% [99.66%] |
| tirth8205/code-review-graph                           |                     12 / 11 | 16.67% / 100.00% [22.36%]; 18.18% / 100.00% [22.36%] | 0.00% / — [—]; 0.00% / — [—]                         | 0.00% / — [—]; 0.00% / — [—]                         | 16.67% / 100.00% [22.36%]; 18.18% / 100.00% [22.36%] |
| trailhq/Graft                                         |                     47 / 47 | 40.43% / 100.00% [85.41%]; 40.43% / 100.00% [85.41%] | 27.66% / 100.00% [79.42%]; 27.66% / 100.00% [79.42%] | 2.13% / 100.00% [5.00%]; 2.13% / 100.00% [5.00%]     | 63.83% / 100.00% [90.50%]; 63.83% / 100.00% [90.50%] |
| typescript-language-server/typescript-language-server |                   249 / 225 | 15.66% / 100.00% [92.61%]; 16.44% / 100.00% [92.22%] | 0.00% / — [—]; 0.00% / — [—]                         | 18.88% / 100.00% [93.82%]; 20.44% / 100.00% [93.70%] | 34.54% / 100.00% [96.58%]; 36.89% / 100.00% [96.46%] |

### Per-family: Held-out regression (temporal + test)

| Group                    | Trusted multi rows / groups | Q1 row cov / P [CP]; group cov / P [CP]              | Q2 row cov / P [CP]; group cov / P [CP]            | Q3 row cov / P [CP]; group cov / P [CP]              | Cascade row cov / P [CP]; group cov / P [CP]         |
| ------------------------ | --------------------------: | ---------------------------------------------------- | -------------------------------------------------- | ---------------------------------------------------- | ---------------------------------------------------- |
| abhigyanpatwari/GitNexus |                 2624 / 2116 | 31.44% / 100.00% [99.64%]; 37.15% / 100.00% [99.62%] | 5.18% / 100.00% [97.82%]; 6.33% / 100.00% [97.79%] | 16.27% / 100.00% [99.30%]; 14.08% / 100.00% [99.00%] | 47.87% / 100.00% [99.76%]; 51.42% / 100.00% [99.73%] |
| onyx-dot-app/onyx        |                 1648 / 1565 | 34.89% / 100.00% [99.48%]; 36.23% / 100.00% [99.47%] | 0.06% / 100.00% [5.00%]; 0.06% / 100.00% [5.00%]   | 5.83% / 100.00% [96.93%]; 5.88% / 100.00% [96.80%]   | 40.78% / 100.00% [99.56%]; 42.17% / 100.00% [99.55%] |

### Per-ambiguity-class: Pool (train + calibration)

| Group                                        | Trusted multi rows / groups | Q1 row cov / P [CP]; group cov / P [CP]            | Q2 row cov / P [CP]; group cov / P [CP]              | Q3 row cov / P [CP]; group cov / P [CP]              | Cascade row cov / P [CP]; group cov / P [CP]         |
| -------------------------------------------- | --------------------------: | -------------------------------------------------- | ---------------------------------------------------- | ---------------------------------------------------- | ---------------------------------------------------- |
| (none)                                       |                     48 / 47 | 0.00% / — [—]; 0.00% / — [—]                       | 0.00% / — [—]; 0.00% / — [—]                         | 0.00% / — [—]; 0.00% / — [—]                         | 0.00% / — [—]; 0.00% / — [—]                         |
| alias/renamed import                         |                       1 / 1 | 0.00% / — [—]; 0.00% / — [—]                       | 0.00% / — [—]; 0.00% / — [—]                         | 0.00% / — [—]; 0.00% / — [—]                         | 0.00% / — [—]; 0.00% / — [—]                         |
| barrel/re-export                             |                   929 / 784 | 0.32% / 100.00% [36.84%]; 0.38% / 100.00% [36.84%] | 66.20% / 100.00% [99.51%]; 64.54% / 100.00% [99.41%] | 0.00% / — [—]; 0.00% / — [—]                         | 66.20% / 100.00% [99.51%]; 64.54% / 100.00% [99.41%] |
| fluent/chained call                          |                   744 / 599 | 0.00% / — [—]; 0.00% / — [—]                       | 0.00% / — [—]; 0.00% / — [—]                         | 32.93% / 100.00% [98.78%]; 34.72% / 100.00% [98.57%] | 32.93% / 100.00% [98.78%]; 34.72% / 100.00% [98.57%] |
| framework convention                         |                    104 / 76 | 0.00% / — [—]; 0.00% / — [—]                       | 0.00% / — [—]; 0.00% / — [—]                         | 79.81% / 100.00% [96.46%]; 78.95% / 100.00% [95.13%] | 79.81% / 100.00% [96.46%]; 78.95% / 100.00% [95.13%] |
| generated wrapper/facade                     |                   908 / 806 | 4.19% / 100.00% [92.42%]; 4.71% / 100.00% [92.42%] | 0.00% / — [—]; 0.00% / — [—]                         | 17.73% / 100.00% [98.16%]; 18.61% / 100.00% [98.02%] | 21.92% / 100.00% [98.51%]; 23.33% / 100.00% [98.42%] |
| generic factory                              |                     20 / 20 | 0.00% / — [—]; 0.00% / — [—]                       | 0.00% / — [—]; 0.00% / — [—]                         | 0.00% / — [—]; 0.00% / — [—]                         | 0.00% / — [—]; 0.00% / — [—]                         |
| other/plain                                  |                 3021 / 2558 | 7.12% / 100.00% [98.62%]; 8.05% / 100.00% [98.56%] | 0.00% / — [—]; 0.00% / — [—]                         | 7.35% / 100.00% [98.66%]; 8.37% / 100.00% [98.61%]   | 14.47% / 100.00% [99.32%]; 16.42% / 100.00% [99.29%] |
| overloads                                    |                   832 / 726 | 2.16% / 100.00% [84.67%]; 2.48% / 100.00% [84.67%] | 13.58% / 100.00% [97.38%]; 14.19% / 100.00% [97.13%] | 8.53% / 100.00% [95.87%]; 9.37% / 100.00% [95.69%]   | 24.28% / 100.00% [98.53%]; 26.03% / 100.00% [98.43%] |
| path alias                                   |                   914 / 755 | 2.63% / 100.00% [88.27%]; 3.05% / 100.00% [87.79%] | 63.57% / 100.00% [99.49%]; 62.52% / 100.00% [99.37%] | 0.00% / — [—]; 0.00% / — [—]                         | 66.19% / 100.00% [99.51%]; 65.56% / 100.00% [99.40%] |
| unresolved receiver with small candidate set |                    112 / 99 | 0.00% / — [—]; 0.00% / — [—]                       | 0.00% / — [—]; 0.00% / — [—]                         | 0.00% / — [—]; 0.00% / — [—]                         | 0.00% / — [—]; 0.00% / — [—]                         |

### Per-ambiguity-class: Held-out regression (temporal + test)

| Group                                        | Trusted multi rows / groups | Q1 row cov / P [CP]; group cov / P [CP]              | Q2 row cov / P [CP]; group cov / P [CP]              | Q3 row cov / P [CP]; group cov / P [CP]              | Cascade row cov / P [CP]; group cov / P [CP]         |
| -------------------------------------------- | --------------------------: | ---------------------------------------------------- | ---------------------------------------------------- | ---------------------------------------------------- | ---------------------------------------------------- |
| (none)                                       |                       8 / 3 | 0.00% / — [—]; 0.00% / — [—]                         | 0.00% / — [—]; 0.00% / — [—]                         | 0.00% / — [—]; 0.00% / — [—]                         | 0.00% / — [—]; 0.00% / — [—]                         |
| alias/renamed import                         |                       9 / 9 | 0.00% / — [—]; 0.00% / — [—]                         | 0.00% / — [—]; 0.00% / — [—]                         | 0.00% / — [—]; 0.00% / — [—]                         | 0.00% / — [—]; 0.00% / — [—]                         |
| barrel/re-export                             |                   934 / 898 | 22.91% / 100.00% [98.61%]; 23.61% / 100.00% [98.60%] | 14.67% / 100.00% [97.84%]; 15.03% / 100.00% [97.81%] | 0.00% / — [—]; 0.00% / — [—]                         | 23.45% / 100.00% [98.64%]; 24.16% / 100.00% [98.63%] |
| fluent/chained call                          |                   704 / 424 | 0.00% / — [—]; 0.00% / — [—]                         | 0.00% / — [—]; 0.00% / — [—]                         | 45.88% / 100.00% [99.08%]; 48.58% / 100.00% [98.56%] | 45.88% / 100.00% [99.08%]; 48.58% / 100.00% [98.56%] |
| generated wrapper/facade                     |                     45 / 45 | 55.56% / 100.00% [88.71%]; 55.56% / 100.00% [88.71%] | 37.78% / 100.00% [83.84%]; 37.78% / 100.00% [83.84%] | 4.44% / 100.00% [22.36%]; 4.44% / 100.00% [22.36%]   | 60.00% / 100.00% [89.50%]; 60.00% / 100.00% [89.50%] |
| other/plain                                  |                 1900 / 1659 | 37.79% / 100.00% [99.58%]; 40.99% / 100.00% [99.56%] | 0.00% / — [—]; 0.00% / — [—]                         | 10.47% / 100.00% [98.51%]; 11.03% / 100.00% [98.38%] | 48.26% / 100.00% [99.67%]; 52.02% / 100.00% [99.65%] |
| overloads                                    |                       5 / 5 | 0.00% / — [—]; 0.00% / — [—]                         | 0.00% / — [—]; 0.00% / — [—]                         | 0.00% / — [—]; 0.00% / — [—]                         | 0.00% / — [—]; 0.00% / — [—]                         |
| path alias                                   |                 1242 / 1186 | 40.74% / 100.00% [99.41%]; 42.07% / 100.00% [99.40%] | 0.08% / 100.00% [5.00%]; 0.08% / 100.00% [5.00%]     | 0.00% / — [—]; 0.00% / — [—]                         | 40.82% / 100.00% [99.41%]; 42.16% / 100.00% [99.40%] |
| unresolved receiver with small candidate set |                     84 / 78 | 0.00% / — [—]; 0.00% / — [—]                         | 0.00% / — [—]; 0.00% / — [—]                         | 0.00% / — [—]; 0.00% / — [—]                         | 0.00% / — [—]; 0.00% / — [—]                         |

Small families have wide bounds even at 100% precision. Per-family certification at .990 needs at least 299 independent error-free groups, and only nestjs/nest (pool) and GitNexus/onyx (held-out) are that large. The classes no query covers are `unresolved receiver with small candidate set`, `generic factory` and `alias/renamed import`. These, together with plain calls whose receivers are inferred, are where LSP or a richer deterministic query is still needed.

## Step 2: is "which query resolves it" transferable?

Labels are independent events. Qk is positive when Qk commits the exact gold set, and `no-query-resolves` is positive when none of the queries does. The classifier is four independent logistic BCE heads with no softmax, trained LOFO over the seven pool families. Inputs exclude labels, query outcomes, gold IDs, request IDs, family, duplicate groups and ambiguity-class metadata. The second variant adds aggregate Tier A candidate features. Each cell shows BCE / AUROC / AP.

| Independent label | Prevalence | State in-sample BCE / AUROC / AP | State LOFO OOF BCE / AUROC / AP | State+TierA in-sample BCE / AUROC / AP | State+TierA LOFO OOF BCE / AUROC / AP |
| ----------------- | ---------: | -------------------------------- | ------------------------------- | -------------------------------------- | ------------------------------------- |
| q1                |      0.048 | 0.124/0.966/0.510                | 0.148/0.906/0.314               | 0.116/0.970/0.534                      | 0.140/0.936/0.377                     |
| q2                |      0.102 | 0.135/0.979/0.777                | 0.497/0.575/0.115               | 0.124/0.986/0.853                      | 0.492/0.583/0.116                     |
| q3                |      0.090 | 0.240/0.872/0.482                | 0.271/0.764/0.309               | 0.236/0.875/0.501                      | 0.271/0.763/0.318                     |
| no-query-resolves |      0.760 | 0.418/0.835/0.927                | 0.501/0.751/0.878               | 0.405/0.847/0.932                      | 0.498/0.750/0.872                     |

Q1 transfers reasonably well (LOFO AUROC 0.906, or 0.936 with Tier A features). Q3 transfers partially (0.764). Q2 does not transfer at all: AUROC falls from 0.979 in-sample to 0.575 under LOFO. That is the same family-specific pattern seen in the target-guessing models.

## Query cost

Running all three queries plus the cascade on one request, with the snapshot already materialized, took the following:

| Split       | Requests | Mean / p50 / p95 / max (ms)    |
| ----------- | -------: | ------------------------------ |
| Train       |    13489 | 0.217 / 0.074 / 0.855 / 19.106 |
| Calibration |     2966 | 0.158 / 0.082 / 0.457 / 11.766 |
| Temporal    |     2694 | 0.402 / 0.186 / 1.454 / 37.490 |
| Test        |    12422 | 0.186 / 0.117 / 0.552 / 21.141 |

The state-only classifier costs about 0.03 ms per request. Because running every query is already well under a millisecond, a learned router cannot save meaningful query cost. Its only possible value would be predicting `no-query-resolves` so the request goes to LSP early, and with LOFO AUROC 0.75 that is not reliable enough to certify.

## Interpretation

- **Deterministic queries deliver what the learned scorers could not.** Tier A + queries raises measured LSP avoidance from 44.00% to 61.34% (pool), 39.78% to 73.22% (test) and 78.43% to 90.79% (temporal), with 0 wrong commits in every split. The learned target scorers added 0 certified avoidance under the same rule.
- **The answer comes from deterministic evidence.** Every commit is a syntactic proof over the source snapshot and is restricted to an existing Tier A candidate. This is the "classify the request, then answer with a deterministic query" direction, and here even the classification step is unnecessary for cost.
- **A model has a narrower role than first planned.** It is not needed to choose among cheap queries. What remains open is (a) deciding early that no query will resolve a request, (b) the request classes no query covers today (unresolved receivers, generic factories, inferred receivers), and (c) the cross-language or non-TypeScript cases. Any of these must pass the same LOFO certification before use.
- **Certification status.** The query cascade itself clears .990 and .995 on pool groups with zero errors, but it was designed on the pool. A fresh confirmation needs data that was not seen while designing the rules, such as new families or a new temporal slice.

## Limitations

- Rules were designed on the pool, and held-out data was already seen in earlier work, including the first-version errors, so held-out results are regression checks.
- The parser has no type checker. Q3 handles only the listed explicit syntax, and everything else abstains.
- Classifier LOFO uses seven uneven families, with nestjs/nest supplying most rows.
- Latency uses warm per-snapshot caches and is not a production LSP comparison.

## Artifacts

- Aggregates, per-split, per-family and per-class tables, latency and classifier results are in `evaluate/results/semantic-corpus/v1/system1-query-routing-v1/results.json`, and per-request outcomes are in `pool-outcomes.json` and `held-out-outcomes.json` in the same directory. These are local and gitignored.
- Code:
  - [system1-query-routing-rules.mts](../../../scripts/semantic-corpus/system1-query-routing-rules.mts)
  - [system1-query-routing.mts](../../../scripts/semantic-corpus/system1-query-routing.mts) (stages `pool`, `held-out` and `finalize`, which refuse to overwrite and check the rule hash)
  - [system1-query-routing-classifier.py](../../../scripts/semantic-corpus/system1-query-routing-classifier.py)
- Tests: [system1-query-routing-rules.test.ts](../../../test/system1-query-routing-rules.test.ts), 16 passing, including the same-name guard.
