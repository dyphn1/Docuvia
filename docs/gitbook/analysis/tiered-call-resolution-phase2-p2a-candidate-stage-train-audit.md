# GRPH-008 P2-A — TRAIN Candidate and Proposal-Filter Stage Audit

**Status:** Analysis-only TRAIN audit for candidate generator v4. It changes no generator, ranking, threshold, calibration, production resolution, or Tier B behavior. This follows [#559 comment 5969397300](https://github.com/dyphn1/Docuvia/issues/559#issuecomment-5969397300): improve candidate recall/set quality first; unsupported and hard cases continue to LSP.

## Scope and stage meanings

The audit reuses pinned v4 source-only predictions and a TRAIN-only opt-in replay. It compares exact per-call-site sets at each existing candidate/proposal boundary:

1. **Generated keys:** raw `generatedCandidateKeys` returned by the hypothesis index.
2. **Mapped target IDs:** those exact keys resolved through the `(snapshotId, repoId)` scoped facts/oracle map. Ambiguous mappings are not promoted to IDs.
3. **Ordered proposals:** exact target-key sequences after caller visibility, explicit receiver type, peer receiver members, and argument-shape filters, immediately before and after the service's `maxCandidates=25` cap. These are proposal sets, not top-1 estimates.

Recall counts uniquely mapped positive target **occurrences**. Empty-set rates and candidate-size quantiles use all confirmed eligible sites, including rows with no candidates and rows whose positive labels cannot be uniquely mapped. Quantiles use nearest rank (`ceil(p*n)-1`) over all confirmed eligible sites. Group tables also report the number of uniquely mappable positive sites and unscorable eligible sites. The audit does not infer any set from a winner or a count.

## TRAIN results

| Stage                       | Exact set membership total | Unique-mappable targets covered / 12,177 | Candidate recall | Empty stage set / 13,496 eligible sites | Empty mapped target set / 13,496 | Stage set size p50 / p95 / max | Mapped target set size p50 / p95 / max |
| --------------------------- | -------------------------: | ---------------------------------------: | ---------------: | --------------------------------------: | -------------------------------: | -----------------------------: | -------------------------------------: |
| Generated keys              |               137,469 keys |                                   12,170 |         99.9425% |                           468 (3.4677%) |                    833 (6.1722%) |              1 / 64 / 118 keys |                        1 / 35 / 96 IDs |
| Mapped generated target IDs |                 89,589 IDs |                                   12,170 |         99.9425% |                           833 (6.1722%) |                    833 (6.1722%) |                1 / 35 / 96 IDs |                        1 / 35 / 96 IDs |
| Ordered proposals           |       44,060 proposal keys |                                   12,149 |         99.7701% |                           468 (3.4677%) |                    894 (6.6242%) |               1 / 25 / 25 keys |                        1 / 12 / 25 IDs |

All 13,496 TRAIN label rows are confirmed eligible. Their 13,507 positive target occurrences divide into 12,177 uniquely mappable, 861 ambiguous, and 469 unmapped. The recall denominator therefore differs from the all-site denominator by design. Raw generated keys have 89,589 uniquely mapped memberships and 47,880 ambiguous memberships; the 137,469 raw key memberships have no unmapped outcomes. Proposal keys have 31,412 mapped and 12,648 ambiguous memberships out of 44,060.

The 468 rows with no raw generated key split into:

- **461 known-shape, unscorable rows:** Nest bare calls (456) and TypeScript Language Server bare calls (5). Each has a confirmed positive label, but none of its positive target occurrences is uniquely mappable. They remain in the all-site empty-set rate and are excluded from candidate recall. They are not evidence of a generator miss.
- **7 source-position-excluded rows:** all seven have `calleeKind=unmapped`, a uniquely mapped positive target, and no generated key in the pinned replay. Each is a tagged template with `positionStatus=excluded` / `exclusionReason=no-call-at-position`. The production worker emits an exact call-shape fact at each labeled position. A separate direct-service capability probe recovers the gold target in generated keys and proposals for **7/7** requests; these zeros are source-oracle/replay eligibility exclusions. The original batch measurement above is preserved. See the exact source diagnosis below.

Another 365 sites have raw keys but no uniquely mapped target ID; their 485 candidate-key memberships are ambiguous. They are not generator-zero rows. Across all stages, the reported set sizes preserve the difference between raw keys, mapped IDs, and proposals.

## Exact proposal-filter attribution

The replay captured the ordered candidate keys and their snapshot-scoped target mappings at each boundary. It compared every v4 decision field on all 13,496 TRAIN rows; the opt-in capture adds evidence only and leaves ordering, winner/rank/tie state, completeness, truncation, and result reason unchanged. This table separates an empty raw-key set from a non-empty set with no uniquely mapped target ID.

| Exact stage                      | Gold target occurrences covered / 12,177 | Raw-key p50 / p95 / max | Mapped-ID p50 / p95 / max | Raw empty sites / 13,496 | Zero-mapped-ID sites / 13,496 |
| -------------------------------- | ---------------------------------------: | ----------------------: | ------------------------: | -----------------------: | ----------------------------: |
| Generated keys                   |                                   12,170 |            1 / 64 / 118 |               1 / 35 / 96 |                      468 |                           833 |
| Before visibility                |                                   12,170 |            1 / 64 / 118 |               1 / 35 / 96 |                      468 |                           833 |
| After visibility                 |                                   12,170 |            1 / 64 / 116 |               1 / 35 / 96 |                      468 |                           833 |
| After explicit receiver type     |                                   12,168 |            1 / 34 / 116 |               1 / 16 / 96 |                      468 |                           884 |
| After peer receiver members      |                                   12,166 |            1 / 33 / 116 |               1 / 16 / 96 |                      468 |                           885 |
| After argument shape             |                                   12,166 |            1 / 31 / 102 |               1 / 15 / 76 |                      468 |                           894 |
| Immediately before maxCandidates |                                   12,166 |            1 / 31 / 102 |               1 / 15 / 76 |                      468 |                           894 |
| Immediately after maxCandidates  |                                   12,149 |             1 / 25 / 25 |               1 / 12 / 25 |                      468 |                           894 |

The cap keeps exactly the first `min(beforeCount, 25)` proposals. There were 747 truncated sites. These measurements are TRAIN-only and do not change the filter sequence or candidate policy.

The 21 uniquely mappable gold occurrences present in raw generated keys but missing from final proposals first disappear at these boundaries:

| First missing boundary        | Family × call shape | Gold occurrences |
| ----------------------------- | ------------------- | ---------------: |
| Explicit receiver-type filter | Graft × member      |                2 |
| Peer-member filter            | Nest × member       |                2 |
| maxCandidates cap             | Nest × member       |               17 |

Visibility and argument-shape filters removed no additional gold occurrences. Separately, seven original replay zeros are `Nest × unmapped`: the source-position eligibility gate excludes their tagged-template positions even though exact parser facts exist. The direct-service probe establishes candidate availability for all seven; it does not establish selected resolution. The other raw empty rows (461) have no uniquely mappable positive target and count in the all-site zero rate, not as recall misses. The total **468 raw-zero** sites and **833 zero-mapped-ID** sites differ: 365 sites have raw keys but no unique target mapping.

## Family × call-shape results

`Scorable / unscorable sites` is a site count; target counts in the recall columns are occurrences. `Raw key p95/max` and `mapped ID p95/max` use every eligible site in that family/shape. Proposal misses count uniquely mapped positive occurrences present in the raw generated set but absent from the ordered proposals, plus any raw misses.

The `Nest × unmapped` row retains the original replay classification for seven source-position-excluded sites. All seven are scorable positive sites with exact parser facts and direct-service gold candidates. This row describes the pinned position-gated replay, not production syntax support.

| Family × call shape                    | Sites | Scorable / unscorable | Raw recall (covered / targets) | Raw zero keys | Raw key p95 / max | Mapped ID p95 / max | Proposal recall (covered / targets) | Proposal misses | Proposal key p95 / max |
| -------------------------------------- | ----: | --------------------: | -----------------------------: | ------------: | ----------------: | ------------------: | ----------------------------------: | --------------: | ---------------------: |
| Docuvia × arg-chain                    |   169 |              155 / 14 |               100% (155 / 155) |             0 |           15 / 15 |             15 / 15 |                    100% (155 / 155) |               0 |                12 / 13 |
| Docuvia × bare                         | 1,484 |             1,484 / 0 |           100% (1,484 / 1,484) |             0 |           44 / 44 |             16 / 16 |                100% (1,484 / 1,484) |               0 |                25 / 25 |
| Docuvia × member                       | 1,955 |            1,924 / 31 |           100% (1,924 / 1,924) |             0 |           62 / 98 |             27 / 36 |                100% (1,924 / 1,924) |               0 |                25 / 25 |
| Docuvia × this                         |     2 |                 2 / 0 |                   100% (2 / 2) |             0 |           14 / 14 |               4 / 4 |                        100% (2 / 2) |               0 |                14 / 14 |
| Nest × arg-chain                       |   341 |              313 / 28 |               100% (313 / 313) |             0 |            6 / 78 |              6 / 26 |                    100% (313 / 313) |               0 |                 6 / 25 |
| Nest × bare                            | 3,025 |           2,512 / 513 |           100% (2,512 / 2,512) |           456 |            3 / 30 |               3 / 8 |                100% (2,512 / 2,512) |               0 |                 3 / 25 |
| Nest × member                          | 4,430 |           3,906 / 524 |           100% (3,906 / 3,906) |             0 |          78 / 118 |             71 / 96 |            99.5136% (3,887 / 3,906) |              19 |                15 / 25 |
| Nest × this                            |   197 |              114 / 83 |               100% (114 / 114) |             0 |           10 / 31 |             10 / 27 |                    100% (114 / 114) |               0 |                 7 / 25 |
| Nest × unmapped                        |     7 |                 7 / 0 |                     0% (0 / 7) |             7 |             0 / 0 |               0 / 0 |                          0% (0 / 7) |               7 |                  0 / 0 |
| Code Review Graph × bare               |     8 |                 8 / 0 |                   100% (8 / 8) |             0 |             3 / 3 |               3 / 3 |                        100% (8 / 8) |               0 |                  2 / 2 |
| Code Review Graph × member             |    69 |                69 / 0 |                 100% (69 / 69) |             0 |             2 / 6 |               2 / 6 |                      100% (69 / 69) |               0 |                  1 / 5 |
| Graft × bare                           |   835 |               833 / 2 |               100% (833 / 833) |             0 |            1 / 22 |              1 / 15 |                    100% (833 / 833) |               0 |                 1 / 21 |
| Graft × member                         |    53 |                50 / 3 |                 100% (50 / 50) |             0 |            7 / 28 |              7 / 10 |                       96% (48 / 50) |               2 |                  3 / 6 |
| TypeScript Language Server × arg-chain |     7 |                 7 / 0 |                   100% (7 / 7) |             0 |             1 / 1 |               1 / 1 |                        100% (7 / 7) |               0 |                  1 / 1 |
| TypeScript Language Server × bare      |   332 |              236 / 96 |               100% (236 / 236) |             5 |           97 / 97 |               8 / 8 |                    100% (236 / 236) |               0 |                25 / 25 |
| TypeScript Language Server × member    |   580 |              555 / 25 |               100% (555 / 555) |             0 |            9 / 77 |               9 / 9 |                    100% (555 / 555) |               0 |                  2 / 9 |
| TypeScript Language Server × this      |     2 |                 2 / 0 |                   100% (2 / 2) |             0 |             1 / 1 |               1 / 1 |                        100% (2 / 2) |               0 |                  1 / 1 |

The highest raw-key fanout is concentrated in ordinary member calls: Nest member has p95/max 78/118 and Docuvia member 62/98. TypeScript Language Server bare calls have raw-key p95/max 97/97 but mapped-target p95/max 8/8, indicating a large alias ambiguity tail rather than 97 uniquely mapped targets. The candidate generator covers every uniquely mapped TRAIN target in these high-fanout groups.

## Missing evidence and proposal losses

- Original replay raw recall misses: **7 target occurrences**, all caused by source-oracle position exclusions. Exact parser facts exist and direct-service requests recover all seven gold candidates. The corrected capability view has **12,177/12,177** raw coverage; it is a separate measurement from the pinned batch.
- Original replay ordered-proposal misses: **28 target occurrences** total. Seven are source-position exclusions recovered by the direct-service probe. The other **21** were present in raw generated keys but disappeared at identified boundaries: 17 Nest member occurrences at the maxCandidates cap, 2 Nest member occurrences at the peer-member filter, and 2 Graft member occurrences at the explicit receiver-type filter. The corrected capability view at cap 25 has **21** proposal losses.
- Of the raw zero-key rows, 461 have known bare-call shapes but no uniquely mappable positive target, so they remain in the all-site denominator but cannot contribute to positive-target recall. The other seven have uniquely mappable positives and are excluded by source position (`calleeKind=unmapped` in the replay), despite exact parser facts. A further 365 sites have keys whose target aliases cannot be uniquely mapped. These are separate evidence classes; none is silently counted as recall success or as an unsupported syntax form.

The source diagnosis below explains the 17 capped and four filtered occurrences. The seven tagged templates identify a source-oracle/replay eligibility gap; their probe results remain ambiguous and uncalibrated. Any future fix to the evaluation gate must preserve those resolution distinctions. High raw fanout is concentrated in Nest and Docuvia member calls, while TypeScript Language Server bare calls have a large ambiguous-alias tail (raw p95 97 keys versus 8 unique mapped IDs). This audit does not justify loosening any filter or tuning ranking.

## Exact TRAIN source diagnosis and capability probe

This slice uses only pinned v4 source inputs, the committed TRAIN replay/aggregate, and `labelsForSplitIsolated("train", IDs)`. It verifies all **13,496** TRAIN IDs and labels before joining targets. Every affected caller byte hash matches replay evidence; every target byte hash matches the corrected facts in the same `(snapshotId, repoId)` scope. No heldout label outcome or corpus manifest was read. The runtime policy remains unchanged.

Positions in call-site IDs below are **zero based**. Pinned source links point to the corresponding one-based line. Target IDs are exact canonical TRAIN oracle aliases, not top-1 estimates.

### The 21 ordered-proposal losses

| First missing boundary      | Exact call site (0-based position; links use 1-based lines)                                                                                                                                                                                     | Syntax                 | Exact gold target                                                                                       | Gold rank / before-cap keys |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------- | --------------------------- |
| `afterExplicitReceiverType` | [src/blast/blast.ts:423:50](https://github.com/trailhq/Graft/blob/f06070d702b501ce38a2fe0cf7191b9f579888ae/src/blast/blast.ts#L424)                                                                                                             | `member-call`          | `src/blast/modules.ts#conceptOf`                                                                        | absent / 1                  |
| `afterExplicitReceiverType` | [src/blast/blast.ts:467:24](https://github.com/trailhq/Graft/blob/f06070d702b501ce38a2fe0cf7191b9f579888ae/src/blast/blast.ts#L468)                                                                                                             | `member-call`          | `src/blast/modules.ts#conceptOf`                                                                        | absent / 1                  |
| `afterPeerMembers`          | [packages/microservices/test/nest-microservice.spec.ts:245:21](https://github.com/nestjs/nest/blob/b1014b6862c3602e86b5a4c750d26bf25ff4b524/packages/microservices/test/nest-microservice.spec.ts#L246)                                         | `member-call`          | `packages/microservices/nest-microservice.ts#NestMicroservice.close`                                    | absent / 1                  |
| `afterPeerMembers`          | [packages/microservices/test/nest-microservice.spec.ts:265:21](https://github.com/nestjs/nest/blob/b1014b6862c3602e86b5a4c750d26bf25ff4b524/packages/microservices/test/nest-microservice.spec.ts#L266)                                         | `member-call`          | `packages/microservices/nest-microservice.ts#NestMicroservice.close`                                    | absent / 3                  |
| `afterMaxCandidates`        | [packages/microservices/test/server/server-factory.spec.ts:13:27](https://github.com/nestjs/nest/blob/b1014b6862c3602e86b5a4c750d26bf25ff4b524/packages/microservices/test/server/server-factory.spec.ts#L14)                                   | `member-call`          | `packages/microservices/server/server-factory.ts#ServerFactory.create`                                  | 29 / 78                     |
| `afterMaxCandidates`        | [packages/microservices/test/server/server-factory.spec.ts:18:22](https://github.com/nestjs/nest/blob/b1014b6862c3602e86b5a4c750d26bf25ff4b524/packages/microservices/test/server/server-factory.spec.ts#L19)                                   | `member-call`          | `packages/microservices/server/server-factory.ts#ServerFactory.create`                                  | 29 / 78                     |
| `afterMaxCandidates`        | [packages/microservices/test/server/server-factory.spec.ts:25:22](https://github.com/nestjs/nest/blob/b1014b6862c3602e86b5a4c750d26bf25ff4b524/packages/microservices/test/server/server-factory.spec.ts#L26)                                   | `member-call`          | `packages/microservices/server/server-factory.ts#ServerFactory.create`                                  | 29 / 78                     |
| `afterMaxCandidates`        | [packages/microservices/test/server/server-factory.spec.ts:32:22](https://github.com/nestjs/nest/blob/b1014b6862c3602e86b5a4c750d26bf25ff4b524/packages/microservices/test/server/server-factory.spec.ts#L33)                                   | `member-call`          | `packages/microservices/server/server-factory.ts#ServerFactory.create`                                  | 29 / 78                     |
| `afterMaxCandidates`        | [packages/microservices/test/server/server-factory.spec.ts:39:22](https://github.com/nestjs/nest/blob/b1014b6862c3602e86b5a4c750d26bf25ff4b524/packages/microservices/test/server/server-factory.spec.ts#L40)                                   | `member-call`          | `packages/microservices/server/server-factory.ts#ServerFactory.create`                                  | 29 / 78                     |
| `afterMaxCandidates`        | [packages/microservices/test/server/server-factory.spec.ts:52:22](https://github.com/nestjs/nest/blob/b1014b6862c3602e86b5a4c750d26bf25ff4b524/packages/microservices/test/server/server-factory.spec.ts#L53)                                   | `member-call`          | `packages/microservices/server/server-factory.ts#ServerFactory.create`                                  | 29 / 78                     |
| `afterMaxCandidates`        | [packages/microservices/test/server/server-factory.spec.ts:59:22](https://github.com/nestjs/nest/blob/b1014b6862c3602e86b5a4c750d26bf25ff4b524/packages/microservices/test/server/server-factory.spec.ts#L60)                                   | `member-call`          | `packages/microservices/server/server-factory.ts#ServerFactory.create`                                  | 29 / 78                     |
| `afterMaxCandidates`        | [packages/microservices/test/server/server-factory.spec.ts:68:35](https://github.com/nestjs/nest/blob/b1014b6862c3602e86b5a4c750d26bf25ff4b524/packages/microservices/test/server/server-factory.spec.ts#L69)                                   | `member-call`          | `packages/microservices/server/server-factory.ts#ServerFactory.create`                                  | 29 / 78                     |
| `afterMaxCandidates`        | [packages/microservices/test/server/server-factory.spec.ts:79:35](https://github.com/nestjs/nest/blob/b1014b6862c3602e86b5a4c750d26bf25ff4b524/packages/microservices/test/server/server-factory.spec.ts#L80)                                   | `member-call`          | `packages/microservices/server/server-factory.ts#ServerFactory.create`                                  | 29 / 78                     |
| `afterMaxCandidates`        | [packages/microservices/test/server/server-factory.spec.ts:90:35](https://github.com/nestjs/nest/blob/b1014b6862c3602e86b5a4c750d26bf25ff4b524/packages/microservices/test/server/server-factory.spec.ts#L91)                                   | `member-call`          | `packages/microservices/server/server-factory.ts#ServerFactory.create`                                  | 29 / 78                     |
| `afterMaxCandidates`        | [packages/microservices/test/server/server-factory.spec.ts:101:35](https://github.com/nestjs/nest/blob/b1014b6862c3602e86b5a4c750d26bf25ff4b524/packages/microservices/test/server/server-factory.spec.ts#L102)                                 | `member-call`          | `packages/microservices/server/server-factory.ts#ServerFactory.create`                                  | 29 / 78                     |
| `afterMaxCandidates`        | [packages/microservices/test/server/server-factory.spec.ts:112:35](https://github.com/nestjs/nest/blob/b1014b6862c3602e86b5a4c750d26bf25ff4b524/packages/microservices/test/server/server-factory.spec.ts#L113)                                 | `member-call`          | `packages/microservices/server/server-factory.ts#ServerFactory.create`                                  | 29 / 78                     |
| `afterMaxCandidates`        | [packages/microservices/test/server/server-factory.spec.ts:123:35](https://github.com/nestjs/nest/blob/b1014b6862c3602e86b5a4c750d26bf25ff4b524/packages/microservices/test/server/server-factory.spec.ts#L124)                                 | `member-call`          | `packages/microservices/server/server-factory.ts#ServerFactory.create`                                  | 29 / 78                     |
| `afterMaxCandidates`        | [packages/platform-fastify/test/adapters/multipart-option.spec.ts:15:19](https://github.com/nestjs/nest/blob/b1014b6862c3602e86b5a4c750d26bf25ff4b524/packages/platform-fastify/test/adapters/multipart-option.spec.ts#L16)                     | `optional-member-call` | `packages/platform-fastify/adapters/fastify-adapter.ts#FastifyAdapter.close`                            | 31 / 47                     |
| `afterMaxCandidates`        | [packages/websockets/socket-server-provider.ts:44:35](https://github.com/nestjs/nest/blob/b1014b6862c3602e86b5a4c750d26bf25ff4b524/packages/websockets/socket-server-provider.ts#L45)                                                           | `member-call`          | `packages/websockets/factories/server-and-event-streams-factory.ts#ServerAndEventStreamsFactory.create` | 33 / 78                     |
| `afterMaxCandidates`        | [packages/websockets/socket-server-provider.ts:67:35](https://github.com/nestjs/nest/blob/b1014b6862c3602e86b5a4c750d26bf25ff4b524/packages/websockets/socket-server-provider.ts#L68)                                                           | `member-call`          | `packages/websockets/factories/server-and-event-streams-factory.ts#ServerAndEventStreamsFactory.create` | 33 / 78                     |
| `afterMaxCandidates`        | [packages/websockets/test/factories/server-and-event-streams-factory.spec.ts:7:50](https://github.com/nestjs/nest/blob/b1014b6862c3602e86b5a4c750d26bf25ff4b524/packages/websockets/test/factories/server-and-event-streams-factory.spec.ts#L8) | `member-call`          | `packages/websockets/factories/server-and-event-streams-factory.ts#ServerAndEventStreamsFactory.create` | 33 / 78                     |

**Cap losses:** thirteen ordinary static `ServerFactory.create(...)` calls retain the gold at rank **29/78**; three `ServerAndEventStreamsFactory.create(...)` calls retain it at **33/78**. Their exact worker facts have `receiverBinding=null` for the imported class identifiers, so the existing member candidate pool remains broad. The optional `adapter?.close()` call has `receiverText="?."` and `receiverBinding=null`, and retains `FastifyAdapter.close` at **31/47**. These are cap losses with binding limitations visible in the source facts; changing the cap would not repair those limitations.

**Peer-member losses:** both `instance.close()` calls use a local `instance = createInstance()`, whose factory returns `new NestMicroservice(...)`. Their exact peer lists are `["enableShutdownHooks", "setIsTerminated"]` and `["enableShutdownHooks"]`. The gold class inventory is complete for direct members and contains `close` and `setIsTerminated`, but omits inherited `enableShutdownHooks`. [NestMicroservice extends NestApplicationContext](https://github.com/nestjs/nest/blob/b1014b6862c3602e86b5a4c750d26bf25ff4b524/packages/microservices/nest-microservice.ts#L38), which [declares enableShutdownHooks](https://github.com/nestjs/nest/blob/b1014b6862c3602e86b5a4c750d26bf25ff4b524/packages/core/nest-application-context.ts#L343). The peer filter requires every peer name in that direct inventory, so both gold occurrences disappear.

**Explicit-type losses:** `index.conceptOf(p)` and `modules.conceptOf(hit.path)` have exact parameter bindings annotated `ModuleIndex`. The gold alias `src/blast/modules.ts#conceptOf` refers to the arrow-valued field in the anonymous object [returned by moduleIndex](https://github.com/trailhq/Graft/blob/f06070d702b501ce38a2fe0cf7191b9f579888ae/src/blast/modules.ts#L49). The gold owner has `kind=object`, `name=null`, and no owner-level type relation. The filter retains the separate `ModuleIndex.conceptOf` interface declaration because its owner name matches the receiver type, and drops the returned-object implementation. This is a structural return-type/owner association gap.

### Seven tagged-template positions: exclusion, exact facts, and direct capability

All seven original source rows have `positionStatus=excluded` and `exclusionReason=no-call-at-position`. For **each row**, a worker fact matches the exact `(startLine, startColumn, calleeName)` tuple, and hashing that fact together with the original source row reproduces the recorded `callSiteInputHash`. The fact is not merely another call with the same name in the file. All seven facts are bare imported callees.

The exclusion happens in `processPhase2Snapshot` in `scripts/semantic-corpus/phase2-tiered-call-resolution-source.mts`: `if (!callSite || source.positionStatus !== "unique")` emits `observationWithoutCall` before the service is called. `positionStatus` is corpus/source-oracle replay metadata, not a field in the production hypothesis request. The production worker emits call-shape facts for these tagged templates; describing these seven rows as parser fact absence or proven unsupported syntax was incorrect.

The capability probe reconstructs the original pinned Nest workspace fingerprint and configuration and verifies **8,000/8,000 original TRAIN Nest decisions** before making seven direct requests. It bypasses the replay eligibility check only by passing each existing exact worker fact directly to the unchanged service. Each request returns **one generated key, one before-cap key, and one final proposal**, with the uniquely mapped gold in all three sets. All seven results are **`ambiguous` / `uncalibrated-signature`**, `truncated=false`, `candidateSetComplete=false`, and are not selected/proven resolutions. Candidate availability does not certify tagged-template argument semantics or automatic resolution.

| Exact source position (0-based; links use 1-based lines)                                                                                                                                                                    | Tagged-template callee        | Exact TRAIN target                                             | Generated / proposals | Gold in both |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- | -------------------------------------------------------------- | --------------------- | ------------ |
| [packages/core/errors/exceptions/invalid-class-scope.exception.ts:12:10](https://github.com/nestjs/nest/blob/b1014b6862c3602e86b5a4c750d26bf25ff4b524/packages/core/errors/exceptions/invalid-class-scope.exception.ts#L13) | `INVALID_CLASS_SCOPE_MESSAGE` | `packages/core/errors/messages.ts#INVALID_CLASS_SCOPE_MESSAGE` | 1 / 1                 | yes          |
| [packages/core/errors/exceptions/invalid-class.exception.ts:5:10](https://github.com/nestjs/nest/blob/b1014b6862c3602e86b5a4c750d26bf25ff4b524/packages/core/errors/exceptions/invalid-class.exception.ts#L6)               | `INVALID_CLASS_MESSAGE`       | `packages/core/errors/messages.ts#INVALID_CLASS_MESSAGE`       | 1 / 1                 | yes          |
| [packages/core/injector/instance-loader.ts:56:26](https://github.com/nestjs/nest/blob/b1014b6862c3602e86b5a4c750d26bf25ff4b524/packages/core/injector/instance-loader.ts#L57)                                               | `MODULE_INIT_MESSAGE`         | `packages/core/helpers/messages.ts#MODULE_INIT_MESSAGE`        | 1 / 1                 | yes          |
| [packages/microservices/server/server-kafka.ts:450:31](https://github.com/nestjs/nest/blob/b1014b6862c3602e86b5a4c750d26bf25ff4b524/packages/microservices/server/server-kafka.ts#L451)                                     | `NO_EVENT_HANDLER`            | `packages/microservices/constants.ts#NO_EVENT_HANDLER`         | 1 / 1                 | yes          |
| [packages/microservices/server/server-rmq.ts:319:25](https://github.com/nestjs/nest/blob/b1014b6862c3602e86b5a4c750d26bf25ff4b524/packages/microservices/server/server-rmq.ts#L320)                                         | `RMQ_NO_MESSAGE_HANDLER`      | `packages/microservices/constants.ts#RMQ_NO_MESSAGE_HANDLER`   | 1 / 1                 | yes          |
| [packages/microservices/server/server-rmq.ts:359:30](https://github.com/nestjs/nest/blob/b1014b6862c3602e86b5a4c750d26bf25ff4b524/packages/microservices/server/server-rmq.ts#L360)                                         | `RMQ_NO_EVENT_HANDLER`        | `packages/microservices/constants.ts#RMQ_NO_EVENT_HANDLER`     | 1 / 1                 | yes          |
| [packages/microservices/server/server.ts:232:31](https://github.com/nestjs/nest/blob/b1014b6862c3602e86b5a4c750d26bf25ff4b524/packages/microservices/server/server.ts#L233)                                                 | `NO_EVENT_HANDLER`            | `packages/microservices/constants.ts#NO_EVENT_HANDLER`         | 1 / 1                 | yes          |

### Original replay and corrected capability views

The pinned v4 batch summary stays byte-identical at raw **12,170/12,177** and proposal **12,149/12,177**. A separately labeled corrected capability view replaces only the seven empty sequences with the actual direct-service sequences. It yields raw **12,177/12,177 (100%)** and cap-25 proposals **12,156/12,177 (99.8275%)**. This merged capability accounting is not the original v4 batch decision output and does not turn ambiguous proposals into accepted resolutions.

The seven replacements add exactly **7 raw keys, 7 mapped raw memberships, 7 proposal keys, and 7 mapped proposal memberships** across the same 13,496 eligible sites. Raw key-zero sites change **468→461**, raw mapped-zero sites **833→826**, proposal key-zero sites **468→461**, and proposal mapped-zero sites **894→887**. Every size-frequency change is **−7 at size 0 / +7 at size 1**; p50/p95/max remain unchanged.

### TRAIN cap sensitivity, with both accounting views

The sweep uses exact prefixes of the existing `beforeMaxCandidates` order. Earlier filters and ranking remain fixed. Ambiguous keys still consume cap slots; mapped sizes count unique target IDs per site. Sizes and nearest-rank quantiles use all 13,496 confirmed eligible sites; recall uses 12,177 uniquely mappable target occurrences. No runtime cap is changed.

| Cap | Original replay coverage / 12,177 | Corrected capability coverage / 12,177 | Original key / mapped memberships | Corrected key / mapped memberships | Added original key / mapped memberships vs 25 | Key p50 / p95 / max | Mapped p50 / p95 / max |
| --: | --------------------------------: | -------------------------------------: | --------------------------------: | ---------------------------------: | --------------------------------------------: | ------------------: | ---------------------: |
|  25 |                 12,149 (99.7701%) |                      12,156 (99.8275%) |                   44,060 / 31,412 |                    44,067 / 31,419 |                                         0 / 0 |         1 / 25 / 25 |            1 / 12 / 25 |
|  26 |                 12,149 (99.7701%) |                      12,156 (99.8275%) |                   44,807 / 31,690 |                    44,814 / 31,697 |                                     747 / 278 |         1 / 26 / 26 |            1 / 12 / 26 |
|  27 |                 12,149 (99.7701%) |                      12,156 (99.8275%) |                   45,549 / 31,969 |                    45,556 / 31,976 |                                   1,489 / 557 |         1 / 27 / 27 |            1 / 12 / 27 |
|  28 |                 12,149 (99.7701%) |                      12,156 (99.8275%) |                   46,291 / 32,180 |                    46,298 / 32,187 |                                   2,231 / 768 |         1 / 28 / 28 |            1 / 12 / 28 |
|  29 |                 12,162 (99.8768%) |                      12,169 (99.9343%) |                   47,029 / 32,462 |                    47,036 / 32,469 |                                 2,969 / 1,050 |         1 / 29 / 29 |            1 / 12 / 29 |
|  30 |                 12,162 (99.8768%) |                      12,169 (99.9343%) |                   47,721 / 32,807 |                    47,728 / 32,814 |                                 3,661 / 1,395 |         1 / 30 / 30 |            1 / 13 / 30 |
|  31 |                 12,163 (99.8850%) |                      12,170 (99.9425%) |                   48,413 / 33,097 |                    48,420 / 33,104 |                                 4,353 / 1,685 |         1 / 31 / 31 |            1 / 14 / 31 |
|  32 |                 12,163 (99.8850%) |                      12,170 (99.9425%) |                   49,031 / 33,265 |                    49,038 / 33,272 |                                 4,971 / 1,853 |         1 / 31 / 32 |            1 / 14 / 32 |
|  33 |                 12,166 (99.9097%) |                      12,173 (99.9672%) |                   49,649 / 33,434 |                    49,656 / 33,441 |                                 5,589 / 2,022 |         1 / 31 / 33 |            1 / 14 / 33 |

Cap 29 restores the thirteen `ServerFactory.create` gold occurrences; cap 31 adds the optional `close`; cap 33 adds the three websocket factory occurrences. Thus 25→33 restores **17** targets (**+0.1396 percentage points**) while adding **5,589 proposal key memberships (+12.7%)** and **2,022 unique mapped memberships (+6.4%)**, with key p95 **25→31**. In the corrected capability view the same increase covers **12,173/12,177**, leaving the four source-filter losses. Neither cap changes the seven direct requests’ ambiguous status.

**Recommendation: keep `maxCandidates=25` in this slice.** Both accounting views already exceed the useful approximately 90% candidate coverage discussed in #559. The measured gain from 33 is small relative to the extra candidate memberships; no runtime-cost or precision measurement here supports expanding the policy. The exact imported/optional receiver, inherited peer, and structural-return cases provide narrower targets for later investigation. This is a TRAIN-informed recommendation, not heldout certification.

Complete computed size frequencies for the original replay at caps 25 and 33 follow. Each column sums to 13,496. For the corrected capability view, subtract seven from each size-zero count and add seven to each size-one count; all other counts are identical.

| Set size | Cap 25 key sites | Cap 33 key sites | Cap 25 mapped sites | Cap 33 mapped sites |
| -------: | ---------------: | ---------------: | ------------------: | ------------------: |
|        0 |              468 |              468 |                 894 |                 894 |
|        1 |            10119 |            10119 |                9901 |                9901 |
|        2 |              501 |              501 |                 507 |                 507 |
|        3 |              414 |              414 |                 435 |                 435 |
|        4 |              283 |              283 |                 313 |                 312 |
|        5 |              122 |              122 |                 108 |                 108 |
|        6 |              142 |              142 |                 128 |                 124 |
|        7 |               32 |               32 |                 117 |                 117 |
|        8 |               51 |               51 |                 148 |                  58 |
|        9 |               56 |               56 |                  48 |                  52 |
|       10 |               50 |               50 |                  85 |                  77 |
|       11 |               55 |               55 |                  76 |                  73 |
|       12 |              131 |              131 |                 148 |                 147 |
|       13 |                3 |                3 |                   0 |                   0 |
|       14 |               20 |               20 |                  32 |                  17 |
|       15 |               43 |               43 |                 125 |                  37 |
|       16 |                1 |                1 |                 125 |                 176 |
|       17 |                3 |                3 |                  12 |                  64 |
|       18 |                7 |                7 |                  22 |                  47 |
|       19 |               29 |               29 |                  72 |                  76 |
|       20 |                4 |                4 |                  31 |                  28 |
|       21 |               71 |               71 |                  67 |                  67 |
|       22 |               44 |               44 |                  25 |                  92 |
|       23 |               64 |               64 |                   0 |                   0 |
|       24 |                4 |                4 |                  58 |                   8 |
|       25 |              779 |               32 |                  19 |                   3 |
|       26 |                0 |                5 |                   0 |                   6 |
|       27 |                0 |                0 |                   0 |                   4 |
|       28 |                0 |                4 |                   0 |                   0 |
|       29 |                0 |               46 |                   0 |                   0 |
|       30 |                0 |                0 |                   0 |                   0 |
|       31 |                0 |               74 |                   0 |                  43 |
|       32 |                0 |                0 |                   0 |                   7 |
|       33 |                0 |              618 |                   0 |                  16 |

### Pinned source bytes and reproduction

The report’s source joins inspect only the affected TRAIN caller/target files and the inherited peer declaration. The capability probe additionally reconstructs the already pinned Nest TRAIN source workspace to require an identical service fingerprint. The following caller/target source hashes are verified against replay/facts before inspection.

| Snapshot | Pinned caller/target file                                                     | SHA-256                                                            |
| -------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| graft    | `src/blast/blast.ts`                                                          | `d2b73166f8af434f95df1c2e7740350580ebb06e9512962f18a5eeac6e0ccea3` |
| graft    | `src/blast/modules.ts`                                                        | `7f85971324a98168051edb3da01dce7b78b63da7818007df2089e321c251b05c` |
| nest     | `packages/core/errors/exceptions/invalid-class-scope.exception.ts`            | `ea6b34802f1e2a84b2772cbcfda47e9642fae25f3f6983da02d41e1e6f5f6cc9` |
| nest     | `packages/core/errors/exceptions/invalid-class.exception.ts`                  | `93148edff6b1e6f30278ad7ad123ca32a0e128be0f126b476b48517c944f2656` |
| nest     | `packages/core/errors/messages.ts`                                            | `2d99bc16964089ae686f76cb18cc43738c0c6461cf4855c14945c85a4c91b5a0` |
| nest     | `packages/core/helpers/messages.ts`                                           | `26c5764c7d342f73b18ab5ecc4fe29e06decc97c08336bd4c6f9be30d45677ac` |
| nest     | `packages/core/injector/instance-loader.ts`                                   | `927b75fef5d1c38ed6a6244dc6969a205715596a4a0ef0e86b9fd40dfd865660` |
| nest     | `packages/core/nest-application-context.ts`                                   | `a6fc58685167e5f9a3af68bc24d8eb851043de3f91000045f83ad8429d3b2f7e` |
| nest     | `packages/microservices/constants.ts`                                         | `954464d59345a04990aa3ecf2f1ec2249a237a9d1495f4edfc8537ac810f48c7` |
| nest     | `packages/microservices/nest-microservice.ts`                                 | `8d852590dcf40a2a8458d5bebbe584c6223f5a96338760855686d7917de396c7` |
| nest     | `packages/microservices/server/server-factory.ts`                             | `80ef7ff4b15d45fb275b1d62b44b2afab61c0213bec85b41da65347b1c2ea050` |
| nest     | `packages/microservices/server/server-kafka.ts`                               | `d6b9834e284445aa94e25d3e0d252c2512b6a773cda54defd0ae6140747c058d` |
| nest     | `packages/microservices/server/server-rmq.ts`                                 | `bcbc0b40d3463c29f044cf0340680fa7c5b4e496f2712eebe65481ac7faf4c6a` |
| nest     | `packages/microservices/server/server.ts`                                     | `0e9b308777431e0e468ed4799c659cfe285f57398c2ce2d139a378cdcd3438e5` |
| nest     | `packages/microservices/test/nest-microservice.spec.ts`                       | `c14a1cd091f1ffc3f6fa0dd86a8787095771e7372fa658ddc92d32476c1d0ec9` |
| nest     | `packages/microservices/test/server/server-factory.spec.ts`                   | `52db4ba6298b55d92b0f2036746fea71121ec6b4fdf135aad000b160d09c8682` |
| nest     | `packages/platform-fastify/adapters/fastify-adapter.ts`                       | `e3a76dde0c490b8d7f6cc5dc87d42da1396a94a91565747d54b06bf5e52df22b` |
| nest     | `packages/platform-fastify/test/adapters/multipart-option.spec.ts`            | `a17fbbdbb97b8818734c365f8d41398587d22a397647ac97382e8d87a3c612a4` |
| nest     | `packages/websockets/factories/server-and-event-streams-factory.ts`           | `2491020c20347fd14a315febcd09a57b91d925d7d8138f4c1ef67e5efce880cd` |
| nest     | `packages/websockets/socket-server-provider.ts`                               | `a5dec226bf6a13fd796f0b27e7af7193f7bdb25567fe49bd739f9e1329666e02` |
| nest     | `packages/websockets/test/factories/server-and-event-streams-factory.spec.ts` | `c1ba9520e7e75ff4cffe592d27e05555f16a054a1a6e8a6b07d7ea814202ad57` |

Run with Node `v24.14.1`:

```sh
PATH=/Users/daniel.chang/.nvm/versions/node/v24.14.1/bin:$PATH pnpm exec tsx scripts/semantic-corpus/phase2-tiered-call-resolution-train-miss-source-audit.mts
```

Output remains ignored at `evaluate/results/semantic-corpus/v1/phase2-p2a-v4-train-miss-source-audit/train-miss-source-summary.json`. It contains all 28 exact source cases and callsite-input hashes, all seven direct request key sequences/results, both raw/cap accounting views, complete size frequencies, and input/configuration provenance. The sweep does not rewrite the pinned predictions, replay, committed aggregate, or production policy.

| New evidence                                                           | SHA-256 / value                                                    |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Source-audit output                                                    | `c5afdc377c53ac6d5cd071a44e69901929e5d231d0555ab0cba8d3bc597d9cc1` |
| Audit script                                                           | `b2f7854d6e3a15f5f919b54e6194ac39a702a12aaabf3926fa91cb8337180927` |
| Reconstructed Nest workspace                                           | `ad22aecb58e4575ba6e16973d875fe129a815899e51569f01a78b69e78863e85` |
| Configuration                                                          | `e09018b7f5abca2e246fd1b6a9c7e078d6972b0a66fa54b67c2eeabc17437fdd` |
| TRAIN label hash                                                       | `4983b8bd52ca2c8048fd5fc9a5f4b8efdb6f7d48843740044e097e7901f9f62a` |
| Original TRAIN rows / exact affected callsite hashes / direct requests | `8,000/8,000` / `28/28` / `7/7`                                    |

Focused source-audit and ordered-stage tests passed **9/9**; full build/typecheck, lint, repository formatting, and `git diff --check` passed. The quality gate passed at **215/7,287** weak assertions (ceiling 220), with category failures unchanged at **234/234**. Commit/push gates are recorded with the handoff.

## Provenance and reproduction

The TRAIN stage replay used pinned v4 predictions; source call sites were restricted to the 13,496 TRAIN sample IDs, with pinned source facts reused for `(snapshotId, repoId)` mapping. The original candidate-stage replay has `labelsRead=false`; this evaluator parsed only TRAIN labels using `labelsForSplitIsolated("train", ids)`. No calibration, test, temporal, or System One heldout label/evaluator path was invoked.

| Input / result                                                                                                                                                 | SHA-256                                                            |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| V4 source predictions (local ignored result)                                                                                                                   | `6d99b1b940d470cbeb94e2bd55527a8e372d2c30c26b56b7d51fc9d773c0e622` |
| [Pinned v4 source prediction manifest](tiered-call-resolution-phase2-p2a-direct-import-alias-evidence/final-source-reproduction-manifest.json)                 | `de7dc8ec977ac316addce6263fcdb9e3190ceed84a4cc8b7e7506f2a04f5ad9e` |
| [TRAIN stage replay manifest](tiered-call-resolution-phase2-p2a-candidate-stage-train-audit-evidence/train-candidate-stage-replay-manifest.json)               | `cf3587e63067a3475ed969d4b3e81817cb15559c998e2158329f9b3cfbf544c3` |
| TRAIN per-site candidate-stage evidence JSONL (earlier replay)                                                                                                 | `3806b5f555f2873747fab6a1f0943141f749995ab2cd139df4c05cea348f070a` |
| [Proposal-filter replay manifest](tiered-call-resolution-phase2-p2a-proposal-filter-stage-train-evidence/proposal-filter-stage-replay-manifest.json)           | `3c276df3fbc46b6c53d6987257e1bc030ec3e5adee1ff6b065feccbcf1b1c809` |
| TRAIN per-site ordered-filter evidence JSONL (local ignored result)                                                                                            | `ef6fbacd478a841a2330a892c4076452ea9a8e6b16fba0f9d1a09b03fc716d52` |
| TRAIN sample-ID list                                                                                                                                           | `83d1f36810abcb10306b15d2579afa4e113419f91a45c0fa59aab704aa6b20b6` |
| TRAIN label rows                                                                                                                                               | `4983b8bd52ca2c8048fd5fc9a5f4b8efdb6f7d48843740044e097e7901f9f62a` |
| `callsites.jsonl`                                                                                                                                              | `b61764cdaa1168ba453689c5e11f6a9b035a05273532068648092c48a0dbd362` |
| Corrected declared facts                                                                                                                                       | `ba7b631b36ed05b1f16c6b500b0c17b5e4273acd939a493800848225c4dad14e` |
| V4 candidate generator implementation                                                                                                                          | `f51c86da6dc003082a3dc5e4015d45e60e25696fa694912e782d92b57b247182` |
| Snapshot-scoped oracle mapping                                                                                                                                 | `3088674bee530052f7b7c5575f0714f217b4774074b92de2b169fe813d89ec81` |
| Proposal-filter replay implementation hash                                                                                                                     | `e19ac6a08adcabfae697703458223d30208e664c693f59a9d9f54d555e4ebb01` |
| Proposal-filter evaluator / runner implementation hash                                                                                                         | `75e4b530c9afa5ae638a5822e7d11ceeb26ef0f018818bee98c7c115d9a10977` |
| [TRAIN aggregate proposal-stage summary JSON](tiered-call-resolution-phase2-p2a-proposal-filter-stage-train-evidence/proposal-filter-stage-train-summary.json) | `10cc41ce63b114f2df2075463fc36aba93a71b91e8f657d9216b05db75e0af18` |
| Proposal-stage input fingerprint                                                                                                                               | `b2564d8d12c07dd3ed24c50fb07493fac7fa52dd754d78dd5f46480106555448` |

The per-site replay evidence and working aggregate remain in the ignored `evaluate/results` tree. Byte-identical copies of the replay manifest and aggregate are linked in the evidence table above. They can be reproduced with Node `v24.14.1`:

```sh
PATH=/Users/daniel.chang/.nvm/versions/node/v24.14.1/bin:$PATH pnpm exec tsx scripts/semantic-corpus/phase2-tiered-call-resolution-proposal-filter-stage-evaluation-runner.mts
```

The runner validates the pinned prediction/replay/source hashes, records `labelSplitsRead=["train"]`, and writes `evaluate/results/semantic-corpus/v1/phase2-p2a-v4-train-proposal-filter-stage-evaluation/proposal-filter-stage-train-summary.json`. It does not regenerate predictions, reopen other label splits, change any rule, or update a calibration threshold.

## Validation

### Ordered-filter trace update

- Replay command (Node `v24.14.1`):
  `PATH=/Users/daniel.chang/.nvm/versions/node/v24.14.1/bin:$PATH pnpm exec tsx scripts/semantic-corpus/phase2-tiered-call-resolution-candidate-stage-replay.mts --capture-proposal-filter-stages --out evaluate/results/semantic-corpus/v1/phase2-p2a-v4-train-proposal-filter-stage-replay`
  completed with **13,496/13,496** TRAIN decision rows equivalent and `labelSplitsRead=[]` / `labelsRead=false`.
- TRAIN-only evaluator command (Node `v24.14.1`):
  `PATH=/Users/daniel.chang/.nvm/versions/node/v24.14.1/bin:$PATH pnpm exec tsx scripts/semantic-corpus/phase2-tiered-call-resolution-proposal-filter-stage-evaluation-runner.mts`
  completed with **13,496** observed source rows and **12,177** unique-mappable positive target occurrences. It reads only TRAIN labels. The seven raw zeros are now attributed to source-position exclusions by the direct-service probe above; the 21 raw-present proposal losses first disappear as **17 cap / 2 peer-member / 2 explicit-receiver** occurrences.
- Focused command:
  `PATH=/Users/daniel.chang/.nvm/versions/node/v24.14.1/bin:$PATH pnpm exec vitest run test/semantic-corpus/phase2-tiered-call-resolution-proposal-filter-stage-evaluation.unit.test.ts test/semantic-corpus/phase2-tiered-call-resolution-proposal-filter-stage-evidence.unit.test.ts lib/core/src/semantic/call-resolution-hypothesis.service.integration.test.ts`
  passed **34/34 tests**. This includes the exact 26→25 cap case and rejects 26→24; the validator requires exactly `min(beforeCount, 25)` keys in original order.
- Full `pnpm run build` passed (including root typecheck and all 11 workspace package builds); full `pnpm run lint` passed; repository-wide `pnpm exec prettier --check .` passed; `git diff --check` passed.
- `bash scripts/test-quality-gate.sh`: passed its static and category-ratchet gates. Weak assertions were **215/7,255** against the ceiling of **220**. Category failures remained **234**, unchanged from base `f7eb3434923bc7cdefd1788db9f284991320d01f` to the current working tree (base 336 files, head 337); the ratchet passed with no increase.
- Replay evidence SHA-256: `ef6fbacd478a841a2330a892c4076452ea9a8e6b16fba0f9d1a09b03fc716d52`; replay manifest SHA-256: `3c276df3fbc46b6c53d6987257e1bc030ec3e5adee1ff6b065feccbcf1b1c809`; aggregate summary SHA-256: `10cc41ce63b114f2df2075463fc36aba93a71b91e8f657d9216b05db75e0af18`. Tracked JSON copies are kept byte-identical to runner output and excluded from Prettier rewriting.
- Full repository pre-push/build status and remote checks will be recorded after that gate completes.

### Initial candidate-stage evaluator (previous audit)

- RED: the focused evaluator test failed on exact site count (`0` vs expected `2`) and failure to reject non-TRAIN input.
- GREEN: evaluator + candidate-stage evidence + scoped oracle audit tests passed **17/17** with:
  `pnpm exec vitest run test/semantic-corpus/phase2-tiered-call-resolution-candidate-stage-evaluation.unit.test.ts test/semantic-corpus/phase2-tiered-call-resolution-candidate-stage-evidence.unit.test.ts test/semantic-corpus/phase2-tiered-call-resolution-candidate-audit.unit.test.ts --testTimeout=120000 --hookTimeout=120000`.
- `pnpm run typecheck` and `pnpm run lint`: passed.
- `pnpm exec prettier --check` on the evaluator, runner, tests, and linked report/index files: passed; `git diff --check`: passed.
- `bash scripts/test-quality-gate.sh`: passed. Weak assertions were **215/7,219** against the ceiling of 220; category ratchet was **234/234** (base `7d7dd939`, head 234 across 336 files), with no net category debt.
- The generated TRAIN aggregate matched **13,496** replayed sites and **12,177** unique-mappable positive target occurrences. Its aggregate category is `missing-call-shape-evidence`; the later exact source audit identifies these seven cases as source-position exclusions despite existing parser facts, with zero proven unsupported syntax cases. The source generator and all v4 decision fields remain unchanged.
- `docuvia query` returned keyword context; `docuvia impact filterCandidates` and `docuvia impact CallResolutionHypothesisService` reported medium risk. The graph is stale at `79a6c3d` while HEAD is `e2063d3`. `docuvia review origin/main` reports a PR-wide CRITICAL (170 changed files, 601 dependents); the top affected files are existing contract/LSP modules, not this analysis-only slice.
- The standard Node `v24.14.1` pre-push hook result and remote CI status will be recorded on the resulting PR commit.

This audit is descriptive TRAIN evidence, not calibration, certification, or a claim that all eligible calls resolve. Any later candidate-policy change should preserve LSP fallback for unresolved/unsupported cases and account for the exact source facts for the 17 capped and four source-filtered gold occurrences. This measurement alone does not authorize a behavior change.
