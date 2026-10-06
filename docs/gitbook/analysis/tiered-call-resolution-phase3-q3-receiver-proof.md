# GRPH-008 Phase 3: Q3 receiver proofs

This adds four independently versioned receiver proofs to the existing bounded `this.member()` slice:

- `q3:super-call:v1`: `super.m()` resolves to one concrete, directly declared method on the unique base class.
- `q3:this-inherited:v1`: `this.m()` resolves through a unique `extends` chain of at most 16 classes when the current class does not declare `m`.
- `q3:typed-receiver:v1`: a parameter, field, or constructor parameter property has one explicit class type, locally declared or reached through supported imports and aliases.
- `q3:new-receiver:v1`: `new C().m()` or an unchanged `const x = new C(); x.m()` resolves against that class and its unique `extends` chain.

The resolver abstains on optional chaining, unions and intersections, generic type parameters, interfaces, structural types, unresolved or ambiguous aliases, overloads, abstract members, reassigned locals, mixin or expression-based `extends`, and workspace escapes. JavaScript uses class, `new`, and `extends` syntax only; JSDoc is not read. The caller, every class/type-alias/base file consulted, imports used for type binding, and configured path file when used are included in the proof dependency fingerprint.

ScopeResolver and the candidate generator remain unchanged. Q3 supplies a target while the calls projection retains ScopeResolver's caller. The proof path does not skip Tier B or promote calibration. The Q3 proof precondition uses complete source-bound inventories for the relevant declarations; unrelated files with missing facts do not block a locally complete proof. Duplicate source paths, incomplete relevant owners, and truncated candidate lists still abstain.

## TRAIN and CALIBRATION audit

The source replay covers 31,578 rows: 13,496 TRAIN, 2,966 CALIBRATION, 12,422 TEST, and 2,694 TEMPORAL. Only the 16,462 TRAIN and CALIBRATION label rows were loaded. TEST and TEMPORAL were source-only.

| Split       | Rule signature         |    Proven | ScopeResolver has no target | ScopeResolver has another target | Gold disagreements |
| ----------- | ---------------------- | --------: | --------------------------: | -------------------------------: | -----------------: |
| TRAIN       | `q3:super-call:v1`     |         8 |                           0 |                                8 |                  0 |
| TRAIN       | `q3:this-inherited:v1` |         0 |                           0 |                                0 |                  0 |
| TRAIN       | `q3:typed-receiver:v1` |       560 |                         439 |                              121 |                  0 |
| TRAIN       | `q3:new-receiver:v1`   |       960 |                         954 |                                6 |                  0 |
| CALIBRATION | `q3:super-call:v1`     |         0 |                           0 |                                0 |                  0 |
| CALIBRATION | `q3:this-inherited:v1` |         0 |                           0 |                                0 |                  0 |
| CALIBRATION | `q3:typed-receiver:v1` |        18 |                          18 |                                0 |                  0 |
| CALIBRATION | `q3:new-receiver:v1`   |       575 |                         569 |                                6 |                  0 |
| **Total**   |                        | **2,121** |                   **1,980** |                          **141** |              **0** |

All 2,121 proofs have a positive gold target, and every proven target matches it. The disagreement list is empty. `ScopeResolver has no target` plus `ScopeResolver has another target` accounts for every proof; no proof duplicates the existing target. The inherited-`this` rule has no TRAIN or CALIBRATION corpus examples, but its depth-16 positive, depth-17 abstention, and base-edit invalidation cases are covered by tests.

| Split       | Repository family                                       | Super | Inherited `this` | Typed | New |
| ----------- | ------------------------------------------------------- | ----: | ---------------: | ----: | --: |
| TRAIN       | `dyphn1/Docuvia`                                        |     2 |                0 |    31 | 628 |
| TRAIN       | `nestjs/nest`                                           |     6 |                0 |   374 | 272 |
| TRAIN       | `tirth8205/code-review-graph`                           |     0 |                0 |    29 |   2 |
| TRAIN       | `trailhq/Graft`                                         |     0 |                0 |     0 |  38 |
| TRAIN       | `typescript-language-server/typescript-language-server` |     0 |                0 |   126 |  20 |
| CALIBRATION | `Egonex-AI/Understand-Anything`                         |     0 |                0 |    18 | 575 |

There were zero proofs without a gold target and zero calibration promotions. Tier B was not skipped.

## Whole-source parity

The same committed source snapshot, `7c51356f2398061ab44a08c4b31b576f4c4bafd7`, was parsed once and persisted with Q3 suppressed and enabled. It has 891 source files and zero parse failures.

| Rule signature         | Proven and persisted |
| ---------------------- | -------------------: |
| `q3:super-call:v1`     |                    8 |
| `q3:this-inherited:v1` |                    0 |
| `q3:typed-receiver:v1` |                  148 |
| `q3:new-receiver:v1`   |                1,012 |
| **Total**              |            **1,168** |

The graph comparison uses collapsed `(source_node_key, target_node_key, link_type)` calls edges. It found 302 added and 10 removed edges; every changed edge has a Q3 proof witness. Caller-only changes: 0. The 10 removed edges replace an existing wrong target. At call-site granularity, 34 proofs replace an existing ScopeResolver target, 92 retain the same target, and the other 1,042 have no existing local target. Node rows, non-call links, Q3 heuristic outputs, and non-Q3 hypothesis outputs are unchanged. No proof has a heuristic selection, and calibration promotions are 0. Peak RSS was 1,941,553,152 bytes.

The 34 replaced targets are listed below; repeated source locations are grouped by target pair.

| Source call site(s)                                                                                                               | ScopeResolver target                                                                    | Q3 target                                                                                                                  |
| --------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `lib/core/src/graph/default-import-graph-parity.integration.test.ts:185` `persist`                                                | `...default-import-graph-parity.integration.test.ts#persist`                            | `lib/core/src/graph/phase393-graph-persister.ts#GraphPersisterService.persist`                                             |
| `lib/core/src/graph/persist-ast-graph.incoming-edges.unit.test.ts:99` `persist`                                                   | `...persist-ast-graph.incoming-edges.unit.test.ts#persist`                              | `lib/core/src/graph/persist-ast-graph.ts#GraphPersisterService.persist`                                                    |
| `lib/core/src/graph/phase393-graph-persister.ts:25` `persist`                                                                     | `...phase393-graph-persister.ts#GraphPersisterService.persist`                          | `lib/core/src/graph/phase6-graph-persister.ts#GraphPersisterService.persist`                                               |
| `lib/core/src/graph/phase6-graph-persister.ts:72` `persist`                                                                       | `...phase6-graph-persister.ts#GraphPersisterService.persist`                            | `lib/core/src/graph/persist-ast-graph.ts#GraphPersisterService.persist`                                                    |
| `lib/core/src/impact/phase393-impact.service.ts:24` `getBlastRadius`                                                              | `...phase393-impact.service.ts#ImpactService.getBlastRadius`                            | `lib/core/src/impact/phase6-impact.service.ts#ImpactService.getBlastRadius`                                                |
| `lib/core/src/impact/phase6-impact.service.ts:25` `getBlastRadius`                                                                | `...phase6-impact.service.ts#ImpactService.getBlastRadius`                              | `lib/core/src/impact/impact.service.ts#ImpactService.getBlastRadius`                                                       |
| `lib/core/src/semantic/call-resolution-hypothesis.service.integration.test.ts:63` `indexWorkspace`                                | `...call-resolution-hypothesis.service.integration.test.ts#indexWorkspace`              | `lib/core/src/semantic/call-resolution-hypothesis.service.ts#CallResolutionHypothesisService.indexWorkspace`               |
| `lib/core/src/semantic/call-resolution-hypothesis.service.integration.test.ts:194,296,442,495,550,601,1426,1467` `indexWorkspace` | `...call-resolution-hypothesis.service.integration.test.ts#indexWorkspace`              | `lib/core/src/semantic/call-resolution-hypothesis.service.ts#CallResolutionHypothesisService.indexWorkspace`               |
| `lib/core/src/semantic/call-resolution-reexport-proof.integration.test.ts:143` `hypothesize`                                      | `...call-resolution-reexport-proof.integration.test.ts#hypothesize`                     | `lib/core/src/semantic/call-resolution-hypothesis.service.ts#CallResolutionHypothesisService.hypothesize`                  |
| `scripts/semantic-corpus/checker.mts:447,448` `moduleOf`                                                                          | `...checker.mts#moduleOf`                                                               | `scripts/semantic-corpus/checker.mts#SyntaxTables.moduleOf`                                                                |
| `scripts/semantic-corpus/phase2-default-import-graph-parity.mts:225` `initialize`                                                 | `...phase2-default-import-graph-parity.mts#initialize`                                  | `lib/core/src/ast/ast-worker-pool.ts#AstWorkerPool.initialize`                                                             |
| `scripts/semantic-corpus/phase2-default-import-graph-parity.mts:226` `parse`                                                      | `...phase2-default-import-graph-parity.mts#parse`                                       | `lib/core/src/ast/ast-worker-pool.ts#AstWorkerPool.parse`                                                                  |
| `scripts/semantic-corpus/phase2-default-import-graph-parity.mts:227` `terminate`                                                  | `...phase2-default-import-graph-parity.mts#terminate`                                   | `lib/core/src/ast/ast-worker-pool.ts#AstWorkerPool.terminate`                                                              |
| `scripts/semantic-corpus/phase2-tiered-call-resolution-configured-alias-impact.mts:171` `indexWorkspace`                          | `...configured-alias-impact.mts#FeatureTraceService.indexWorkspace`                     | `lib/core/src/semantic/call-resolution-hypothesis.service.ts#CallResolutionHypothesisService.indexWorkspace`               |
| `scripts/semantic-corpus/phase2-tiered-call-resolution-train-miss-source-audit.mts:79` `indexWorkspace`                           | `...train-miss-source-audit.mts#PositionProbeService.indexWorkspace`                    | `lib/core/src/semantic/call-resolution-hypothesis.service.ts#CallResolutionHypothesisService.indexWorkspace`               |
| `scripts/semantic-corpus/phase3-q1-named-import-proof-audit.mts:156` `indexWorkspace` and `:160` `hypothesize`                    | `...phase3-q1-named-import-proof-audit.mts#Q1AuditService.{indexWorkspace,hypothesize}` | `lib/core/src/semantic/call-resolution-hypothesis.service.ts#CallResolutionHypothesisService.{indexWorkspace,hypothesize}` |
| `scripts/semantic-corpus/phase3-q1-named-import-whole-source-parity.mts:444` `initialize`, `:445` `parse`, `:446` `terminate`     | Same-file helpers                                                                       | `lib/core/src/ast/ast-worker-pool.ts#AstWorkerPool.{initialize,parse,terminate}`                                           |
| `scripts/semantic-corpus/phase3-q2-reexport-proof-audit.mts:169` `indexWorkspace` and `:173` `hypothesize`                        | `...phase3-q2-reexport-proof-audit.mts#Q2AuditService.{indexWorkspace,hypothesize}`     | `lib/core/src/semantic/call-resolution-hypothesis.service.ts#CallResolutionHypothesisService.{indexWorkspace,hypothesize}` |
| `scripts/semantic-corpus/phase3-q2-reexport-whole-source-parity.mts:447` `initialize`, `:448` `parse`, `:449` `terminate`         | Same-file helpers                                                                       | `lib/core/src/ast/ast-worker-pool.ts#AstWorkerPool.{initialize,parse,terminate}`                                           |
| `scripts/semantic-corpus/system1-syntax.mts:243` `build`                                                                          | `...system1-syntax.mts#System1SnapshotSyntax.build`                                     | `lib/core/src/semantic/system1/system1-syntax.ts#System1SnapshotSyntax.build`                                              |

## Tests and remaining Phase 3 gaps

The 32 Q3 integration tests cover direct and inherited proof cases, imports and aliases, overload/abstract/collision abstentions, unions, intersections, generics, optional chaining, mutation, mixins, workspace escapes, unbound type names, aliases to interfaces, depth 16/17, base-file invalidation, unrelated incomplete workspace facts, and anonymous-callback caller projection.

### Existing safety-contract reconciliation

Three earlier abstention expectations were superseded only where the input now satisfies the explicit Q3 contract. The “type name alone” case declares `class Logger` in the same file and annotates `logger: Logger`; Q3 checks that unique declaration and hashes the caller file. The alias case resolves `LoggerAlias` to that same unique class, and the inheritance case resolves an explicitly annotated `Logger` through one same-file `extends` chain to `Base.close`. The graph-persister case likewise annotates `other: Service` where `Service` is a same-file class, so it now records a typed-receiver proof. The prior abstention intent remains covered by negatives for an unbound name, an alias to an interface, a same-name declaration collision, an unsupported typed re-export, and an interface-typed parameter; the graph projection keeps the legacy edge for the interface case.

The configured-path candidate fingerprint expectation is computed after removing the Q3-only `q3ReceiverFacts` and `receiverOptional` sidecars. Those parser inputs changed with Q3, while candidate identity intentionally excludes them, so the candidate source fingerprint remains stable without a new hash literal.

The focused reviewer regression run passed 91 tests across the Q3 service, graph-persister, configured-path-alias, and Q3 receiver integration files. The separate Phase 2 source-helper run passed 8 tests.

The inherited-`this` rule has no pinned TRAIN/CALIBRATION observations. All signatures remain uncalibrated and Tier B still runs. Inferred/factory returns, structural typing, interface dispatch, JSDoc, and broader language coverage remain outside these rules. The Phase 3 exit gate and certification requirements remain open; this is not authority to skip verification or certify a signature.

## Reproduction and hashes

Run with Node `v24.14.1` and TypeScript `5.9.3`:

```bash
node --max-old-space-size=4096 --import tsx scripts/semantic-corpus/phase3-q3-receiver-proof-audit.mts --out /private/tmp/docuvia-phase3-q3-receiver-proof-audit.json
node --max-old-space-size=4096 --import tsx scripts/semantic-corpus/phase3-q3-receiver-proof-whole-source-parity.mts --snapshot-root /private/tmp/docuvia-q3-source-HEAD-7c51356f2398061ab44a08c4b31b576f4c4bafd7 --out /private/tmp/docuvia-phase3-q3-whole-source-parity.jsonl
```

The audit JSON and implementation-and-regression file-set hashes were refreshed after the safety-contract test reconciliation. Corpus counts and proof behavior are unchanged; the audited input set includes the Q3 integration test file.

| Artifact or input                         | SHA-256                                                            |
| ----------------------------------------- | ------------------------------------------------------------------ |
| TRAIN/CALIBRATION audit JSON              | `5b374b8924973285efa587e637104ce78a19b8dcb5ca069b6149affcbe14e837` |
| Whole-source parity JSONL                 | `3fd6b07322a4435e2a8fa617e18c124da5d23424b76c6cb5cc5d26a22e0506c7` |
| Whole-source input manifest               | `56e6f7b7584ac897d1f8e10b1b2f4e2d266c9fd581b8cb934592de364d3c17f0` |
| Q3 implementation and regression file set | `7151b13c5e250ca18744ab31ca67e442a971e67ae1f7d2474eec45c74a466c2a` |
| Pinned `callsites.jsonl`                  | `b61764cdaa1168ba453689c5e11f6a9b035a05273532068648092c48a0dbd362` |
| Pinned declared-type facts pass A         | `ba7b631b36ed05b1f16c6b500b0c17b5e4273acd939a493800848225c4dad14e` |
| Candidate prediction manifest             | `de7dc8ec977ac316addce6263fcdb9e3190ceed84a4cc8b7e7506f2a04f5ad9e` |
| TRAIN label records                       | `d32a13e929f7678a36f35a86a2a598cd0aa86b23421aea5a70a3562791e4ddcc` |
| CALIBRATION label records                 | `b629b3fbab15c1d3bb62c70874e6f20efd518191a214f6bafce974a52e948af9` |
