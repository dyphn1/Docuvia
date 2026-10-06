# GRPH-008 Phase 3: Q2 re-export proof

Q2 adds the strict `q2:reexport-trace:v1` proof for explicit named imports whose in-repository target module re-exports the imported symbol. The candidate generator remains `declared-member-hypothesis-v6`. ScopeResolver is unchanged: a proof supplies only the target, and graph call edges keep ScopeResolver's caller attribution.

The trace follows `(file, symbol)` pairs through named aliases, local re-exports of one imported binding, and export-star chains. It fingerprints the caller, every visited source file, and `tsconfig.json` when a configured alias is used. Cycles, depth greater than 16, dead ends, ambiguous stars or paths, unsupported/default/namespace/type-only branches, incomplete chain facts, candidate truncation, and final same-name collisions abstain. No barrel fallback, Tier B skip, or calibration promotion is used.

## Pinned corpus audit

The audit contains 31,578 source rows: 13,496 TRAIN, 2,966 CALIBRATION, 12,422 TEST, and 2,694 TEMPORAL. It loads labels only for TRAIN and CALIBRATION (16,462 rows). TEST and TEMPORAL labels were not read.

| Split       | Repository family                                       | Import-bound sites | Q2 proven | Different from ScopeResolver |
| ----------- | ------------------------------------------------------- | -----------------: | --------: | ---------------------------: |
| TRAIN       | `dyphn1/Docuvia`                                        |              1,484 |         1 |                            0 |
| TRAIN       | `nestjs/nest`                                           |              3,025 |       164 |                          164 |
| TRAIN       | `tirth8205/code-review-graph`                           |                  8 |         0 |                            0 |
| TRAIN       | `trailhq/Graft`                                         |                835 |        38 |                            0 |
| TRAIN       | `typescript-language-server/typescript-language-server` |                332 |         0 |                            0 |
| CALIBRATION | `403errors/repomind`                                    |              1,204 |         0 |                            0 |
| CALIBRATION | `Egonex-AI/Understand-Anything`                         |              1,018 |         2 |                            0 |
| **Total**   |                                                         |          **7,906** |   **205** |                      **164** |

All 205 proven targets match a positive gold target; there are 0 disagreements and 0 proofs without a gold target. The 164 TRAIN target differences are all in `nestjs/nest`: ScopeResolver points at re-exporting barrel modules while Q2 identifies the uniquely traced function declaration. Every one matches its gold target. The proof produced 0 calibration promotions, and Tier B was not skipped. Q2 fires on both the pinned corpus and this repository, so coverage is non-vacuous.

## Whole-source parity

Compared the same committed source snapshot `d29f0ebf0fab2619b05eb8647eff9eae88c87071` (887 source files) with Q1 enabled and Q2 suppressed versus enabled. The enabled projection persisted all 39 Q2 proofs among 16,222 import-bound call sites. All 39 proven targets already matched ScopeResolver's target, so the graph diff has 0 additions and 0 removals; there are no replaced wrong targets to list. Caller-only changes: 0. Target changes: 0. Nodes and non-call links are unchanged. Peak RSS was 1,865,383,936 bytes.

The proof tests cover named and renamed hops, multi-hop chains, stars, local imported bindings, a uniquely named default function, exactly 16 hops, and abstention for the specified ambiguity and incompleteness cases. Regression tests also prove that `export *` cannot forward a default import and that an already-parsed call-source barrel still expands its downstream chain. Persistence tests cover delete/reparse survival, intermediate-file invalidation, and callback caller attribution.

## Reproduction and hashes

The corpus audit ran with Node `v24.14.1` and TypeScript `5.9.3`; the whole-source parity run used the archived HEAD snapshot above.

```bash
node --max-old-space-size=4096 --import tsx scripts/semantic-corpus/phase3-q2-reexport-proof-audit.mts --out /private/tmp/docuvia-phase3-q2-reexport-proof-audit.json
node --max-old-space-size=4096 --import tsx scripts/semantic-corpus/phase3-q2-reexport-whole-source-parity.mts --snapshot-root /private/tmp/docuvia-q2-source-HEAD-d29f0ebf0fab2619b05eb8647eff9eae88c87071 --out /private/tmp/docuvia-phase3-q2-whole-source-parity.jsonl
```

| Artifact                          | SHA-256                                                            |
| --------------------------------- | ------------------------------------------------------------------ |
| TRAIN/CALIBRATION audit JSON      | `3cbe9c286ed1d88b9a335359f3ccfd6e289186953d6b9fac43cfb46b3597a3d4` |
| Whole-source parity JSONL         | `1f19d19898354dba9cc07bd92f26372d393eb2aef49ef9bac336d27f83409b2d` |
| Whole-source input manifest       | `1f916de93c41ddefc4f54faead613c125d0d360576dfe005bd31838516b4b2e5` |
| Frozen implementation bundle      | `84d59c1e779a38d568c8e876e317f9046bc1da674c614e2f6b8e8502469e8c38` |
| Pinned `callsites.jsonl`          | `b61764cdaa1168ba453689c5e11f6a9b035a05273532068648092c48a0dbd362` |
| Pinned declared-type facts pass A | `ba7b631b36ed05b1f16c6b500b0c17b5e4273acd939a493800848225c4dad14e` |
| TRAIN label records               | `d32a13e929f7678a36f35a86a2a598cd0aa86b23421aea5a70a3562791e4ddcc` |
| CALIBRATION label records         | `b629b3fbab15c1d3bb62c70874e6f20efd518191a214f6bafce974a52e948af9` |
