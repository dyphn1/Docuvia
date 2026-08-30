# Changelog

All notable changes to `docuvia` are documented in this file. Versions before 0.1.0 were backfilled from the roadmap's shipped items (see docs/gitbook/analysis/roadmap-and-open-items.md).

## [1.5.1](https://github.com/dyphn1/Docuvia/compare/v1.5.0...v1.5.1) (2026-08-30)

### Bug Fixes

- **test:** stop --testTimeout=30000 clamping the per-project budgets ([#274](https://github.com/dyphn1/Docuvia/issues/274)) ([25684c5](https://github.com/dyphn1/Docuvia/commit/25684c58b8380c102b4a3dc1d1d3ed3adacecd8b)), closes [#272](https://github.com/dyphn1/Docuvia/issues/272)

# [1.5.0](https://github.com/dyphn1/Docuvia/compare/v1.4.4...v1.5.0) (2026-08-30)

### Features

- **ci:** PR comment-triggered analysis (closes [#241](https://github.com/dyphn1/Docuvia/issues/241)) ([#242](https://github.com/dyphn1/Docuvia/issues/242)) ([f87204b](https://github.com/dyphn1/Docuvia/commit/f87204bd17807708420e071f2382dd96de703aae))

## [1.4.4](https://github.com/dyphn1/Docuvia/compare/v1.4.3...v1.4.4) (2026-08-30)

### Bug Fixes

- **test:** one constant for every real-subprocess timeout ([#272](https://github.com/dyphn1/Docuvia/issues/272)) ([1868cb0](https://github.com/dyphn1/Docuvia/commit/1868cb0bba49d204ef9a16cb54cdc1dcfeb9c4b7))

## [1.4.3](https://github.com/dyphn1/Docuvia/compare/v1.4.2...v1.4.3) (2026-08-30)

### Bug Fixes

- **#230:** honest call-resolution metric + barrel-receiver method resolution ([#245](https://github.com/dyphn1/Docuvia/issues/245)) ([e30746b](https://github.com/dyphn1/Docuvia/commit/e30746b6aac09644987e69bdc24cdfb95b91c582)), closes [#230](https://github.com/dyphn1/Docuvia/issues/230)

## [1.4.2](https://github.com/dyphn1/Docuvia/compare/v1.4.1...v1.4.2) (2026-08-29)

### Bug Fixes

- **husky:** skip pre-push verification suite for delete-only pushes ([b504976](https://github.com/dyphn1/Docuvia/commit/b504976803e0e2ea863f3b895b8d61d860205e5b))

## [1.4.1](https://github.com/dyphn1/Docuvia/compare/v1.4.0...v1.4.1) (2026-08-29)

### Bug Fixes

- **ast-core:** resolve tech debt [#227](https://github.com/dyphn1/Docuvia/issues/227) and [#228](https://github.com/dyphn1/Docuvia/issues/228) ([#251](https://github.com/dyphn1/Docuvia/issues/251)) ([11c57b5](https://github.com/dyphn1/Docuvia/commit/11c57b58422b2f2d149b8cef8942dec377907113))
- **git-local:** add path traversal protection to collectDirectoryFiles (issue [#244](https://github.com/dyphn1/Docuvia/issues/244)) ([#249](https://github.com/dyphn1/Docuvia/issues/249)) ([e341b6d](https://github.com/dyphn1/Docuvia/commit/e341b6d98dc02320e68da20f09e60993d8fa4ec2))
- **git-local:** wrap child.stdin.end() in try/catch to handle synchronous throws ([#258](https://github.com/dyphn1/Docuvia/issues/258)) ([c473087](https://github.com/dyphn1/Docuvia/commit/c4730870daa215605330257d45d28f235ab97c17))
- **ui-core:** move isDiscoverableSourceFile to contracts (issue [#243](https://github.com/dyphn1/Docuvia/issues/243)) ([#250](https://github.com/dyphn1/Docuvia/issues/250)) ([16b93d4](https://github.com/dyphn1/Docuvia/commit/16b93d4e61069538ca55634d3f64d755ad995618))
- **ui-core:** pass PAT directly to sync() instead of storing in memory ([#260](https://github.com/dyphn1/Docuvia/issues/260)) ([9ec0eb1](https://github.com/dyphn1/Docuvia/commit/9ec0eb11e83dca7e1e062826b54511c876470953))

# [1.4.0](https://github.com/dyphn1/Docuvia/compare/v1.3.2...v1.4.0) (2026-08-27)

### Bug Fixes

- **core,schema,contracts:** decompose callee evidence + member-call resolution (issue [#192](https://github.com/dyphn1/Docuvia/issues/192) root cause) ([359243b](https://github.com/dyphn1/Docuvia/commit/359243b57076dd0fdbf5ac433cc14b4c3d4f2082))
- **hooks:** improve post-commit logging + pre-push tier-b check ([b251fcc](https://github.com/dyphn1/Docuvia/commit/b251fcc2e89ab20481d7d6d156ed3a5bc752f57a))
- **schema:** add Windows-safe cleanup retry for temp SQLite dirs ([3ccdbfc](https://github.com/dyphn1/Docuvia/commit/3ccdbfc398986ada7f002e4b09c6c6eed1008169))

### Features

- **doctor:** call-graph resolution counters + call_graph_resolution diagnostic (issue [#221](https://github.com/dyphn1/Docuvia/issues/221) P1) ([2c16b26](https://github.com/dyphn1/Docuvia/commit/2c16b2667d1ba4ed7873b3f7922543e49e42a9e5))
- **impact,doctor:** low-resolution empty-result note + canary self-test (issue [#221](https://github.com/dyphn1/Docuvia/issues/221) P2'+P3) ([84b8c3c](https://github.com/dyphn1/Docuvia/commit/84b8c3ccd5f21fcc979cc8b3c103c2f6e56ca142))

## [1.3.2](https://github.com/dyphn1/Docuvia/compare/v1.3.1...v1.3.2) (2026-08-25)

### Bug Fixes

- **lsp:** basename-allowlist the --version spawn probe (issue [#207](https://github.com/dyphn1/Docuvia/issues/207)) ([8fc0a7f](https://github.com/dyphn1/Docuvia/commit/8fc0a7f7014df29c885962be6341632015e3e765))

## [1.3.1](https://github.com/dyphn1/Docuvia/compare/v1.3.0...v1.3.1) (2026-08-25)

### Bug Fixes

- **ast-core:** surface query-compile failures instead of silently falling back ([8e4b6d1](https://github.com/dyphn1/Docuvia/commit/8e4b6d198fc0c6dbbd9dfe4a3fbdf651b09990f0))
- **ci:** stop swallowing the eval summary's PR-comment failures ([b1592d0](https://github.com/dyphn1/Docuvia/commit/b1592d02c5ccbd917eb698fdacca1a6a19cbab14))

# [1.3.0](https://github.com/dyphn1/Docuvia/compare/v1.2.0...v1.3.0) (2026-08-25)

### Features

- **impact:** ast_call_sites reverse lookup as blast-radius fallback (issue [#217](https://github.com/dyphn1/Docuvia/issues/217)) ([3f6a06a](https://github.com/dyphn1/Docuvia/commit/3f6a06a39284d0e5a506714158f8c5de04423687)), closes [#218](https://github.com/dyphn1/Docuvia/issues/218) [#192](https://github.com/dyphn1/Docuvia/issues/192)

# [1.2.0](https://github.com/dyphn1/Docuvia/compare/v1.1.0...v1.2.0) (2026-08-25)

### Features

- **ast:** index exported consts + resolve barrel re-export chains ([#192](https://github.com/dyphn1/Docuvia/issues/192) gaps 1+2) ([5b2369b](https://github.com/dyphn1/Docuvia/commit/5b2369b0bffd596ca6938bf5108428fe47bde212)), closes [#217](https://github.com/dyphn1/Docuvia/issues/217)
- **impact:** UNKNOWN risk for empty results + impact-accuracy eval corpus/harness ([#192](https://github.com/dyphn1/Docuvia/issues/192)) ([f42e0d8](https://github.com/dyphn1/Docuvia/commit/f42e0d843bb84faa369145a66497fb0aae90e1ae)), closes [#217](https://github.com/dyphn1/Docuvia/issues/217)

# [1.1.0](https://github.com/dyphn1/Docuvia/compare/v1.0.0...v1.1.0) (2026-08-24)

### Bug Fixes

- **core:** contain workspace-relative fs access behind safe-fs helpers (issue [#208](https://github.com/dyphn1/Docuvia/issues/208)) ([f50ec93](https://github.com/dyphn1/Docuvia/commit/f50ec939c0a7fa5141efcae5f341f8dc4687cf86))
- **git-local:** surface fast-import stdin write errors instead of discarding them (issue [#186](https://github.com/dyphn1/Docuvia/issues/186)) ([a30e4a2](https://github.com/dyphn1/Docuvia/commit/a30e4a27da1f8c994795f910bb625a4988588f36))

### Features

- **core,cli:** surface l3 write-path provenance in the query read path ([#68](https://github.com/dyphn1/Docuvia/issues/68)) ([1114924](https://github.com/dyphn1/Docuvia/commit/1114924151c61a5a74250f0abc391fc1695f6101)), closes [190/#199](https://github.com/dyphn1/Docuvia/issues/199)
- **git-local,schema,ui-core:** blame-based L3 validity pass at sync-knowledge ([#68](https://github.com/dyphn1/Docuvia/issues/68)) ([c5a0fa5](https://github.com/dyphn1/Docuvia/commit/c5a0fa5cda2742d9d268e4c9b1a2161b0fd4ccf8))
- **schema,ui-core:** capture region anchors from diff hunks at L3 write time ([#68](https://github.com/dyphn1/Docuvia/issues/68)) ([f7ccc53](https://github.com/dyphn1/Docuvia/commit/f7ccc530b71ac4aedcb855de25d1f0c4fa234aec))
- **ui-core:** flush-time writer-side L3 contradiction warning ([#68](https://github.com/dyphn1/Docuvia/issues/68)) ([9973c42](https://github.com/dyphn1/Docuvia/commit/9973c42c9d716d9173c3d1b4eb4cec8890cecfe5))

# 1.0.0 (2026-08-23)

### Bug Fixes

- **agents,cli:** apply issue [#53](https://github.com/dyphn1/Docuvia/issues/53) review follow-ups ([e4270a3](https://github.com/dyphn1/Docuvia/commit/e4270a307b55ff7a642e2315edf05b6937b7e087))
- **analyze,doctor:** hard-fail Tier B on an unready LSP environment instead of silently degrading ([548eb2b](https://github.com/dyphn1/Docuvia/commit/548eb2b8ca61b533a958c97d2c6c3a3cceb43233))
- **analyze:** attribute runParseAndPersist's JSONL lines to the calling workflow's own log ([bd9b18a](https://github.com/dyphn1/Docuvia/commit/bd9b18a8972aebb25cbb8b26b1df25626a04b898)), closes [#12](https://github.com/dyphn1/Docuvia/issues/12)
- **analyze:** guard delta ingestion against backward-moving HEAD ([8600a9f](https://github.com/dyphn1/Docuvia/commit/8600a9faa948dea0d275598365fef6a7ad213693))
- **analyze:** populate Tier B queue on full ingestion and for added files ([f5293b0](https://github.com/dyphn1/Docuvia/commit/f5293b04577c4f923392ea57815791d929328cd1))
- **analyze:** surface a note when the sha fast-path skips a dirty working tree ([06910a5](https://github.com/dyphn1/Docuvia/commit/06910a529686029612aafeb225fcf52cb9bc5bb6))
- **analyze:** surface Tier B runtime degradation in exit code and logs ([c507a27](https://github.com/dyphn1/Docuvia/commit/c507a270b13ccf2fb6f82bd3094550dc9410bbe3))
- **ast-core,ui-core:** validate TOML parse output and enforce path boundary in collectSourceFiles ([#168](https://github.com/dyphn1/Docuvia/issues/168), [#162](https://github.com/dyphn1/Docuvia/issues/162)) ([b7cdccf](https://github.com/dyphn1/Docuvia/commit/b7cdccfc088630ca7c40cdafeb19f84c6f8ea28e))
- **ast-core:** declare js-yaml, smol-toml, web-tree-sitter as runtime deps ([085d44e](https://github.com/dyphn1/Docuvia/commit/085d44e4a2e71e2bc0c613265f8bcb790e7d5f8e))
- **ast-core:** declare js-yaml, smol-toml, web-tree-sitter as runtime deps ([#15](https://github.com/dyphn1/Docuvia/issues/15)) ([3ef74f5](https://github.com/dyphn1/Docuvia/commit/3ef74f5012aa2b0d2f0330f77af56ae1ad25a45a))
- **ast-core:** match semantic-diff boundaries spanning sibling nodes ([0891722](https://github.com/dyphn1/Docuvia/commit/089172296e86977db24fd930c37486fd89b16f50))
- **ast-core:** replace any cast with typed PathItemObject in parseOpenApiSpec (issue [#143](https://github.com/dyphn1/Docuvia/issues/143)) ([92b86dc](https://github.com/dyphn1/Docuvia/commit/92b86dc708eeb2822cdcf9ab08e59950279d9065))
- **ast-core:** replace AstEvent [key: string]: any with strict discriminated union (issue [#166](https://github.com/dyphn1/Docuvia/issues/166)) ([164f23d](https://github.com/dyphn1/Docuvia/commit/164f23d4f0b0fc5fcf764300eb41752ff0b8c1a1))
- **ast:** capture cross-file inheritance edges for blast-radius accuracy ([2dd9fa6](https://github.com/dyphn1/Docuvia/commit/2dd9fa6497ffd160e06080592424c7c7d43c4824))
- **ast:** move default registry + language configs into ast-core (issues [#117](https://github.com/dyphn1/Docuvia/issues/117), [#118](https://github.com/dyphn1/Docuvia/issues/118)) ([7ca643f](https://github.com/dyphn1/Docuvia/commit/7ca643fc19d749975d9aa2fe817987e7d6e4b149))
- **build:** declare contracts project reference in ast-core and plugins-ast (issue [#30](https://github.com/dyphn1/Docuvia/issues/30)) ([4f1926f](https://github.com/dyphn1/Docuvia/commit/4f1926f3bc4717f63428b861638f5272315e1fbb))
- **ci:** make OpenCodeReview job actually review PRs ([#38](https://github.com/dyphn1/Docuvia/issues/38)) ([0135989](https://github.com/dyphn1/Docuvia/commit/0135989de319a54365b03a95440e4ec6c25e5f1a))
- **ci:** relink docuvia CLI bin before graph-knowledge job's npx calls (issue [#138](https://github.com/dyphn1/Docuvia/issues/138)) ([3b9dd57](https://github.com/dyphn1/Docuvia/commit/3b9dd57924c17e2245a29b399e3bf44530a70314))
- **ci:** render knowledge-graph PR comment for humans, not agents ([#200](https://github.com/dyphn1/Docuvia/issues/200)) ([9683174](https://github.com/dyphn1/Docuvia/commit/96831747f639a4396348570c419d3e8ab7f42088))
- **cli,contracts:** implement IFCE-002 — remove the --global flag entirely ([fd3a71d](https://github.com/dyphn1/Docuvia/commit/fd3a71d4728222d5bc0c28a24108e88e8de5d643)), closes [#3](https://github.com/dyphn1/Docuvia/issues/3)
- **cli,core,ui-core:** fix silent-failure bugs found during CLI test-gap verification ([1460a73](https://github.com/dyphn1/Docuvia/commit/1460a73835a3560a3223f8aeec4f0556cc725568))
- **cli,core:** fix dist build packaging, AST node_key collisions, and init/status data loss ([5249da9](https://github.com/dyphn1/Docuvia/commit/5249da9c05aa14a61801dcc7a95bae14a8bfb455))
- **cli,hooks:** neutralize shell injection in docuvia-hook.js context injection (issue [#51](https://github.com/dyphn1/Docuvia/issues/51)) ([ad3b8f4](https://github.com/dyphn1/Docuvia/commit/ad3b8f4224e4cf23f5a36269f3d2219e518c3c55)), closes [#42](https://github.com/dyphn1/Docuvia/issues/42)
- **cli,ui-core:** never persist LLM API key to docuviaMemory (issue [#109](https://github.com/dyphn1/Docuvia/issues/109)) ([930b348](https://github.com/dyphn1/Docuvia/commit/930b3486ca1ea09dc542c2a21d7adc503db871d1))
- **cli:** close MCP docuvia_init's bypass of PLAT-006's single-flight lock ([6a51ead](https://github.com/dyphn1/Docuvia/commit/6a51eadd34c35edeb3e62187450f1f0e0c8f01bf))
- **cli:** explicitly close the readline interface in readStdin (issue [#72](https://github.com/dyphn1/Docuvia/issues/72)) ([44ca6eb](https://github.com/dyphn1/Docuvia/commit/44ca6ebf8049d116820fd3f099bdf2387b81956b))
- **cli:** extract export-topology success-message formatting ([1722814](https://github.com/dyphn1/Docuvia/commit/1722814c18bb0ff4b7eb0f1059cc729018b1bf11))
- **cli:** honest export-topology density, full uninstall teardown, richer query context ([e1a07c3](https://github.com/dyphn1/Docuvia/commit/e1a07c3bfe4a1c6dfefea64d4e5cc16957961e8f))
- **cli:** parse DOCUVIA_LSP_ARGS quote-aware, with JSON array form (issue [#74](https://github.com/dyphn1/Docuvia/issues/74)) ([e976c2d](https://github.com/dyphn1/Docuvia/commit/e976c2de52d1ffcdb079fdcc5ba166f9d6b96599))
- **cli:** propagate agent-authored stage-and-flush mandate into init-templates ([e666364](https://github.com/dyphn1/Docuvia/commit/e6663643975cdc3f0efd8914c5d90b2b0fd3b3b0)), closes [#42](https://github.com/dyphn1/Docuvia/issues/42)
- **cli:** remove redundant registration import in MCP init tool (issue [#110](https://github.com/dyphn1/Docuvia/issues/110)) ([4c73e41](https://github.com/dyphn1/Docuvia/commit/4c73e41fea08973d38488d99f7364a2d798c8241))
- **cli:** replace console.error with structured logger in MCP server ready message (issue [#146](https://github.com/dyphn1/Docuvia/issues/146)) ([47d561b](https://github.com/dyphn1/Docuvia/commit/47d561b1b9b35a210b5704e98ade40bac801b6da))
- **cli:** resolve NaN vulnerability and add validation for lspProcesses ([d90d56f](https://github.com/dyphn1/Docuvia/commit/d90d56fa1b3d03ae7fa4d6a0a609f9861d9d4a6f)), closes [#26](https://github.com/dyphn1/Docuvia/issues/26) [#27](https://github.com/dyphn1/Docuvia/issues/27) [#28](https://github.com/dyphn1/Docuvia/issues/28)
- **cli:** split analyzeCommand's --agent-authored dispatch out to stay under the complexity budget ([257a04a](https://github.com/dyphn1/Docuvia/commit/257a04a34f3212a3760ad43f9c9b5a69f726fd7b))
- **cli:** stop ANSI codes leaking into piped output, fix stale status test ([efc728a](https://github.com/dyphn1/Docuvia/commit/efc728a8b7c3aa63d1b8ae44529096bc8edb39fd))
- **cli:** stop l3-distribution test racing its own pre-push hook ([27fda0d](https://github.com/dyphn1/Docuvia/commit/27fda0da0299da5296ee4798876433da2c4475b2))
- **cli:** stop tsc --build from clobbering tsup's dist/cli.js bundle ([a489345](https://github.com/dyphn1/Docuvia/commit/a489345b87c15611bfbe8062d0f74d35b6dc6753))
- **cli:** stop uninstall from writing Claude Desktop's global config ([a31d0cb](https://github.com/dyphn1/Docuvia/commit/a31d0cb3f45c3ae7569bbcf7f7090d23ccd92a72))
- **cli:** use async fs APIs in export-topology (issue [#71](https://github.com/dyphn1/Docuvia/issues/71)) ([1f64b75](https://github.com/dyphn1/Docuvia/commit/1f64b75fa99d0b9777ece8b0429415fff269cf57))
- **cli:** validate output path boundary in export-topology to prevent path traversal (issue [#179](https://github.com/dyphn1/Docuvia/issues/179)) ([200d3b9](https://github.com/dyphn1/Docuvia/commit/200d3b9e346c8264e7fffa1fbd374ec485a0cd2e)), closes [#181](https://github.com/dyphn1/Docuvia/issues/181)
- **contracts,ast-core,core,ui-core:** move isSupportedSourceFile to contracts as single source of truth (issue [#147](https://github.com/dyphn1/Docuvia/issues/147)) ([48c6bf6](https://github.com/dyphn1/Docuvia/commit/48c6bf688f8f3cc4302d4419453b2d5e5b4db187))
- **contracts,libgit2,core,ui-core:** honor core.hooksPath (husky included) when installing/reading Docuvia's git hooks ([240f96e](https://github.com/dyphn1/Docuvia/commit/240f96ee1648e2b81033951f149b77920faaf5ce))
- **contracts:** apply prettier formatting to source-files.ts ([08560f3](https://github.com/dyphn1/Docuvia/commit/08560f39bce9f969cbb8f2d4c8bd72068400e84d))
- **contracts:** handle transient Windows file lock errors and centralize fs constants ([59990ae](https://github.com/dyphn1/Docuvia/commit/59990ae4d14a1d4f9a2b8e11809338eace3aa6be))
- **contracts:** move GitConstants and parseSourceTrailer into @workspace/contracts ([c8bfae2](https://github.com/dyphn1/Docuvia/commit/c8bfae25241934b11810ae25ced06f9cde2af734)), closes [#114](https://github.com/dyphn1/Docuvia/issues/114)
- **core,ci:** install rust-analyzer in CI and make Rust preflight probe real spawnability (issue [#31](https://github.com/dyphn1/Docuvia/issues/31)) ([a8f4b51](https://github.com/dyphn1/Docuvia/commit/a8f4b5138869399ff0a9050afe87e2c20a682f87))
- **core,contracts:** validate workspaceRoot to prevent path traversal (issue [#141](https://github.com/dyphn1/Docuvia/issues/141)) ([62b2f50](https://github.com/dyphn1/Docuvia/commit/62b2f50a3e2f0e9d4476145ce3d0b78b94055ff3))
- **core,lsp:** add LSP cold-start settle so rust-analyzer cross-file refs aren't dropped (issue [#31](https://github.com/dyphn1/Docuvia/issues/31)) ([8dc8f9b](https://github.com/dyphn1/Docuvia/commit/8dc8f9bc174745febfa3dcd16e955a491be36722))
- **core,lsp:** align Rust Tier B method node_keys with Tier A via Object-kind impl containment ([97c30d9](https://github.com/dyphn1/Docuvia/commit/97c30d9743553055c24576151ffe9574fab6c61e)), closes [#31](https://github.com/dyphn1/Docuvia/issues/31)
- **core,lsp:** extract settleColdStart helper to keep runBatch complexity within budget; run complexity check fail-fast in pre-push and CI ([13b440d](https://github.com/dyphn1/Docuvia/commit/13b440deac3f1d4fecadc48dbadd7e9b8210ea9b))
- **core,lsp:** harden topology collapse across multi-hop containment; verify GRPH-006 Go stays false ([d2072ce](https://github.com/dyphn1/Docuvia/commit/d2072ced9694f482945133984185f4c9c6c56c91))
- **core,lsp:** surface friendly binary-unresolvable reason for npx-fallback languages (Closes [#32](https://github.com/dyphn1/Docuvia/issues/32)) ([2e51886](https://github.com/dyphn1/Docuvia/commit/2e51886eaea9d4abbef846c0bdf53d66fca1491a))
- **core,schema,contracts:** make vscode-scale persist atomic/FTS-cheap, restore correct Disposable resolution ([89384e3](https://github.com/dyphn1/Docuvia/commit/89384e389dd3748e05db6785172cc5f543e3fc25))
- **core,schema:** fix query FTS ranking from 51.9% to 100% self-test accuracy (item 25) ([6085f45](https://github.com/dyphn1/Docuvia/commit/6085f45806ce3109de3c96fe204313851d4f61cb))
- **core,ui-core,cli:** guard hydration against destructive rebuild after a pack failure ([3cd9401](https://github.com/dyphn1/Docuvia/commit/3cd9401f5734ebacb478db581534cfc193b656e7))
- **core,ui-core,cli:** keep post-commit hook alive with nohup + hook log; doctor post_commit_ingestion check + status Tier C queue (issue [#58](https://github.com/dyphn1/Docuvia/issues/58)) ([36b2938](https://github.com/dyphn1/Docuvia/commit/36b293851394b6420128eae9ffb28c020dc00d3d))
- **core:** add cross-batch zero-progress watchdog to the Tier B re-queue (issue [#22](https://github.com/dyphn1/Docuvia/issues/22) split 2) ([67a470d](https://github.com/dyphn1/Docuvia/commit/67a470dc5d1ab31a24327012b9bd7401cbfae328))
- **core:** align Go Tier B method node_keys with Tier A via normalizeSymbolName ([c5f76cd](https://github.com/dyphn1/Docuvia/commit/c5f76cd896e07a5afb2d4d1ae3a2f31bcbd3accb)), closes [#20](https://github.com/dyphn1/Docuvia/issues/20) [#11](https://github.com/dyphn1/Docuvia/issues/11)
- **core:** bound Tier B LSP batches to a fixed number of simultaneously-open documents ([90ab36a](https://github.com/dyphn1/Docuvia/commit/90ab36a7445d01292d2304735db529d80d9af7e2))
- **core:** capture LSP child-process stderr instead of discarding it ([d3aef52](https://github.com/dyphn1/Docuvia/commit/d3aef5275ca08c7e58ba70c09ef65a873b1f0085))
- **core:** close probe-opened files in PRJ-007 readiness poll ([c5ef195](https://github.com/dyphn1/Docuvia/commit/c5ef1957d6ef2ec0373e8784ad2f3af47af442bd))
- **core:** default LSP child processes to a minimal allowlist env (issue [#165](https://github.com/dyphn1/Docuvia/issues/165)) ([2c8c9b9](https://github.com/dyphn1/Docuvia/commit/2c8c9b97823b41678a6cfb1a244d0e7ac8109344))
- **core:** guard Tier B LSP edge resolution against out-of-workspace refs and unbounded open-document growth ([efea870](https://github.com/dyphn1/Docuvia/commit/efea870d7a2bb7576095a81578464145c972c0f4))
- **core:** invalidate stale dev-mode AstWorkerPool compile cache on source change ([08db0c3](https://github.com/dyphn1/Docuvia/commit/08db0c3201ff5d99012d9282e1faee75dee65a32))
- **core:** log worker.terminate() failures instead of silently swallowing (issue [#116](https://github.com/dyphn1/Docuvia/issues/116)) ([e41e1d7](https://github.com/dyphn1/Docuvia/commit/e41e1d7bc82ab3a58921be225bac8733127ed1c4))
- **core:** make L2 snapshot output deterministic across ingestion runs ([05a8dc1](https://github.com/dyphn1/Docuvia/commit/05a8dc1040f1a2397637dac8beca79dc74e12000))
- **core:** make temp-file path assertions platform-independent ([1e4ef1b](https://github.com/dyphn1/Docuvia/commit/1e4ef1ba0d07c7a3667b3265a0db3506b855ebd2)), closes [#156](https://github.com/dyphn1/Docuvia/issues/156) [#141](https://github.com/dyphn1/Docuvia/issues/141)
- **core:** pack real content onto the knowledge branch on first init/analyze ([f92928b](https://github.com/dyphn1/Docuvia/commit/f92928baf77118714d3a5d6d7a37e056257db334))
- **core:** raise typescript-language-server's heap ceiling (item 28) ([06641d3](https://github.com/dyphn1/Docuvia/commit/06641d31fa0201962db415ece7c1a2c91acec68d))
- **core:** reach tsserver's real heap flag via initializationOptions (item 28) ([1410f46](https://github.com/dyphn1/Docuvia/commit/1410f46b26ac6dbbd0d2951685799beb66407d74))
- **core:** remove GitConstants re-export shim, import directly from contracts (issue [#149](https://github.com/dyphn1/Docuvia/issues/149)) ([d32dd47](https://github.com/dyphn1/Docuvia/commit/d32dd472e8df45e562c09ca66a6fec811098a594))
- **core:** remove parseSourceTrailer re-export shim (issue [#150](https://github.com/dyphn1/Docuvia/issues/150)) ([a9873a5](https://github.com/dyphn1/Docuvia/commit/a9873a53624fc4e57f9f2bb03cdb49d22690b568))
- **core:** resolve Go same-package, no-import cross-file calls (item 19) ([0b87ce3](https://github.com/dyphn1/Docuvia/commit/0b87ce3badbb65b1c715d8a4f90aa41656a0fd90))
- **core:** spawn typescript-language-server safely on Windows .cmd shims ([bbb08d0](https://github.com/dyphn1/Docuvia/commit/bbb08d09b54e4ebebfc7fb63fe505cb9ac31557f))
- **core:** split oversized topology-builder test to satisfy complexity budget ([46ccd21](https://github.com/dyphn1/Docuvia/commit/46ccd219271cb9bf03bf4fec12776ed7ba365ab2)), closes [#5](https://github.com/dyphn1/Docuvia/issues/5)
- **core:** stack-safe edge merge + l2 node_key lookup index (issue [#11](https://github.com/dyphn1/Docuvia/issues/11), uncapped batch crash fixes) ([375e29a](https://github.com/dyphn1/Docuvia/commit/375e29a1a7553c94948acc3dc8426761885d9373))
- **core:** stop re-queuing permanently-failed files on every Tier B batch ([3e6dd97](https://github.com/dyphn1/Docuvia/commit/3e6dd9740e1dc5d408df96763b130ad968274489)), closes [#22](https://github.com/dyphn1/Docuvia/issues/22)
- **core:** treat a knowledge branch missing on origin as first-push, not offline ([a122863](https://github.com/dyphn1/Docuvia/commit/a122863b7cf87aa7dabac01301b6489f1df2a524))
- **core:** unmask DB_OPEN_FAILED and add sqlite ABI drift diagnostic (dogfooding findings) ([a8b1a8c](https://github.com/dyphn1/Docuvia/commit/a8b1a8cae1cdb3488b671996d275ce260f28e348))
- **docs:** fail-closed calibrate harness -- DB validation + explicit phase failures ([b1c506e](https://github.com/dyphn1/Docuvia/commit/b1c506e3da660e3bd11e3dc43d7c558602086da0))
- **docs:** remove stale --local flag and old-Docuvia boilerplate from agent specs ([be4f36d](https://github.com/dyphn1/Docuvia/commit/be4f36d7ce679f583bd633f9792c6a62faf45a06))
- **git-local:** force stable C locale on git shell-outs so localized stderr can't break error parsing ([bd17a87](https://github.com/dyphn1/Docuvia/commit/bd17a87ce8dfe71b68cad3a58c55c0c7048c347e))
- **git-local:** kill fast-import child that outlives its timeout (issue [#100](https://github.com/dyphn1/Docuvia/issues/100)) ([b2f170c](https://github.com/dyphn1/Docuvia/commit/b2f170c8b72a7b7be4c09dcf843aa0d1585c47f7))
- **git-local:** pass --no-verify to knowledge-branch pushRef ([62ea40e](https://github.com/dyphn1/Docuvia/commit/62ea40e9f91ad4c67c43857147e3893440b52761))
- **git-local:** raise maxBuffer on ls-files discovery calls to 64MB ([1921568](https://github.com/dyphn1/Docuvia/commit/19215685aca1398b116a3c52155c00cdc3fcc1c2))
- **graph:** detect worker_threads spawns as depends_on edges ([033a461](https://github.com/dyphn1/Docuvia/commit/033a461c943dfaf5f95bd3210797f0a94c510209))
- **graph:** keep resolveCallableName under the complexity budget ([3ad7279](https://github.com/dyphn1/Docuvia/commit/3ad72791f335a01443296cf818670bd4738e4cb8))
- **husky:** unset ambient git env vars in pre-commit/pre-push ([#14](https://github.com/dyphn1/Docuvia/issues/14)) ([5f6a532](https://github.com/dyphn1/Docuvia/commit/5f6a532109748f2b53792bc0f80b04a54970b6b7)), closes [#10](https://github.com/dyphn1/Docuvia/issues/10)
- **init:** skip re-ingestion when a populated graph already exists ([#43](https://github.com/dyphn1/Docuvia/issues/43)) ([fca0ab0](https://github.com/dyphn1/Docuvia/commit/fca0ab06b0542db3dd5fdfbfb7ea88ab083f9313))
- **libgit2:** bound fetchRef/pushRef with a 30s timeout so a stalled remote fails fast ([1672ff3](https://github.com/dyphn1/Docuvia/commit/1672ff3791c1740c33a7910e11b83815bad940a2))
- **libgit2:** resolve hooks dir and knowledge lock via git-dir/git-common-dir ([faaf846](https://github.com/dyphn1/Docuvia/commit/faaf846f19b82622bd083c320d0dd092f1977eca))
- **llm-api:** stop doubling /v1 in the chat-completions URL ([5c05e20](https://github.com/dyphn1/Docuvia/commit/5c05e20f6c728de1ecf3cf74dfbb5b93aa45870d))
- **lsp,analyze:** preserve partial progress when a Tier B batch times out ([edc6023](https://github.com/dyphn1/Docuvia/commit/edc60238aea50d0516fb04fa4c55e2e7c2b5c4c5))
- **lsp,git:** fix Go Tier B LSP resolution and knowledge-branch pack-step crash ([58f2ae4](https://github.com/dyphn1/Docuvia/commit/58f2ae46886586eced16c080250b6109aa6728a2))
- **lsp,graph:** share node_key disambiguation between Tier A and Tier B, fix collision handling ([2e4176d](https://github.com/dyphn1/Docuvia/commit/2e4176d17413324b9a473ebe2f830316ce2a87d1))
- **lsp:** assign node_key by line position, not by discovery order ([c04f077](https://github.com/dyphn1/Docuvia/commit/c04f07704d6442a14c7d7ec9e999c2389c8fe08a))
- **lsp:** fall back to well-known install dirs when a language server isn't on PATH ([063ddb0](https://github.com/dyphn1/Docuvia/commit/063ddb0210abed74e1788d9763e315cec161563a))
- **lsp:** fix Windows npx-preflight false-negative, share the shell-wrapper fix across languages ([18640d7](https://github.com/dyphn1/Docuvia/commit/18640d71a212491d104f0cdf4e7bb880eb8b0f4e))
- **lsp:** mock binary resolution at the right boundary in preflight tests ([b5f6f96](https://github.com/dyphn1/Docuvia/commit/b5f6f96969cb4364134ed40ea9901e66ca679832))
- **lsp:** Polyglot readiness gate and symbol naming paths ([6298979](https://github.com/dyphn1/Docuvia/commit/6298979a2cc3effd8e891dee55aa9f4e4ed18481))
- **lsp:** recognize .slnx solutions, fix flaky csharp-ls preflight mock ([f816706](https://github.com/dyphn1/Docuvia/commit/f816706b596aab15f4cf14fd718b474602754fbf))
- **plugins-ast:** bind function/class query captures to definition node, not name identifier ([f3e1b64](https://github.com/dyphn1/Docuvia/commit/f3e1b643970d26ce7df43022bc39a1b4102058ca))
- **plugins-ast:** extract TypeScript abstract class declarations ([99934dd](https://github.com/dyphn1/Docuvia/commit/99934dd9d5c19359948d925906a4cf7206acaaa0))
- **release:** disable github plugin issue comments/labels that fail validation ([af47a5b](https://github.com/dyphn1/Docuvia/commit/af47a5b922fd26864fde73add4e813eae0419cec))
- **release:** set NODE_AUTH_TOKEN so setup-node's generated .npmrc resolves a token ([bded73b](https://github.com/dyphn1/Docuvia/commit/bded73b3393aafea09c365092e40175a9a17fb60))
- **schema,ui-core:** harden findNodeByName ranking and quiet an expected-fallback log ([394bb0d](https://github.com/dyphn1/Docuvia/commit/394bb0d9b40a5e7ba88f420127f414fe6471ae9d))
- **schema,ui-core:** serialize concurrent init to fix migration crash and duplicate project rows ([aedbdaf](https://github.com/dyphn1/Docuvia/commit/aedbdaf0e87afbacef5b18e227ce4e05384a60fb))
- **schema:** Correct column names in findNodeByName order matching query ([f2b3995](https://github.com/dyphn1/Docuvia/commit/f2b39958409fa3a164fac7b64721133147094d4d))
- **tasks:** repair broken npm/pnpm CLI register-unregister tasks ([dcdbc64](https://github.com/dyphn1/Docuvia/commit/dcdbc645851ad30196b52c4a4b15e670089cb741))
- **test:** add try-catch fallback for worktree path normalization on Windows CI ([a0da6a8](https://github.com/dyphn1/Docuvia/commit/a0da6a834cb14571766b623676935936212796d6))
- **test:** address Windows CI test failures for windows-latest matrix (issue [#175](https://github.com/dyphn1/Docuvia/issues/175)) ([7eb2d58](https://github.com/dyphn1/Docuvia/commit/7eb2d58a6673c7b1dc7d40317714a9d0972370f5))
- **test:** consistent path resolution strategy for worktree comparison ([c26d331](https://github.com/dyphn1/Docuvia/commit/c26d3317a609cccc919651f8242a81a2dfc7087f))
- **test:** isolate tier-c-drain unit tests from real system load (issue [#129](https://github.com/dyphn1/Docuvia/issues/129)) ([3989043](https://github.com/dyphn1/Docuvia/commit/3989043b504cc45c0ef678aedbed94367affa813))
- **test:** normalize forward slashes to native before realpathSync on Windows ([72e3d65](https://github.com/dyphn1/Docuvia/commit/72e3d6561f9c3efc119585661d493d7e3680b17b))
- **test:** robust Windows CI path normalization and LSP resilience (issue [#175](https://github.com/dyphn1/Docuvia/issues/175)) ([431169f](https://github.com/dyphn1/Docuvia/commit/431169f0d7e6b50c8721fb01dfaf473264830e60))
- **test:** soften worktree main-entry assertion for Windows CI junction resolution ([b95d92a](https://github.com/dyphn1/Docuvia/commit/b95d92a4cae60341507d65b8fa1bb58b75cbed5e))
- **test:** use branch + suffix matching for worktree assertions on Windows CI ([7efa08f](https://github.com/dyphn1/Docuvia/commit/7efa08fed9765d14e967dc6dcf3a9243a503f5b5))
- **ui-core,cli:** detect the empty (never-ingested) graph — doctor graph_empty diagnostic + flush advice (issue [#57](https://github.com/dyphn1/Docuvia/issues/57)) ([37c5273](https://github.com/dyphn1/Docuvia/commit/37c52737ec2099fef8038cd44c5dab16e98d39dc))
- **ui-core,cli:** refuse agent-authored L3 decisions anchored to non-source files (roadmap [#37](https://github.com/dyphn1/Docuvia/issues/37)) ([dcf1d9b](https://github.com/dyphn1/Docuvia/commit/dcf1d9be04008048f592019f0dd99b8306895cce)), closes [#30](https://github.com/dyphn1/Docuvia/issues/30)
- **ui-core,contracts,core:** route importL3Cards through IHydrationService factory token (issue [#148](https://github.com/dyphn1/Docuvia/issues/148)) ([96a79dd](https://github.com/dyphn1/Docuvia/commit/96a79ddd0c0cb4d888c5ab1c0fce6da6cd7ee463))
- **ui-core,core,schema,cli:** add Tier B full-resync + scale impact risk thresholds to repo size ([4013d79](https://github.com/dyphn1/Docuvia/commit/4013d799972f9b11cc694238a2c33e4b63ee5e3b))
- **ui-core:** doctor git-hook diagnostics recognize post-commit/pre-push upgrade markers (issue [#48](https://github.com/dyphn1/Docuvia/issues/48)) ([381fe33](https://github.com/dyphn1/Docuvia/commit/381fe3381fdacca70e5edd56282509eaebc8a880)), closes [pre-#42](https://github.com/pre-/issues/42)
- **ui-core:** evict permanently-failing Tier C queue items instead of blocking forever ([9c31722](https://github.com/dyphn1/Docuvia/commit/9c31722546e9a06d81b34c12dc05068d7208add9))
- **ui-core:** make doctor --fix upgrade stale post-commit/pre-push hooks in place (issue [#133](https://github.com/dyphn1/Docuvia/issues/133)) ([a7c0d6e](https://github.com/dyphn1/Docuvia/commit/a7c0d6ec0c1ea6d7efbd32eb075baa82c2e2552d))
- **ui-core:** pin loadThreshold in tier-c-drain test helper to prevent flaky CI failures ([592adf2](https://github.com/dyphn1/Docuvia/commit/592adf260d4e5c0f9e0bc817c5b6327e74064486))
- **ui-core:** probe docuvia resolvability for the pre-push hook diagnostic too; link the docuvia bin at the workspace root ([1430827](https://github.com/dyphn1/Docuvia/commit/1430827209da1fcde47c94ba040e910ded691fff))
- **ui-core:** queue init's initial parse for Tier B, matching analyze's full ingestion ([4232439](https://github.com/dyphn1/Docuvia/commit/4232439f3633a82c8c76d0b7ea297af4ca5e4882))
- **ui-core:** resolve Tier B coverage hint via ITierBCoverageHintProvider token (issue [#115](https://github.com/dyphn1/Docuvia/issues/115)) ([14b9764](https://github.com/dyphn1/Docuvia/commit/14b9764b608a01dbd4d001cd9f38bd7b26f563b8))
- **ui-core:** scope degraded to meaningful buckets, un-suppress zero-progress watchdog on stray degradation (Closes [#33](https://github.com/dyphn1/Docuvia/issues/33)) ([cc86e91](https://github.com/dyphn1/Docuvia/commit/cc86e9199acebca75a9920946380d9545f610e62))
- **ui-core:** scope Tier B LSP gate to queued languages only ([4e28ae1](https://github.com/dyphn1/Docuvia/commit/4e28ae1c01569a49d65c84f3fcd9ae80fb6543bc))
- **ui-core:** skip to next item on bridge-unreachable instead of stopping drain loop (issue [#145](https://github.com/dyphn1/Docuvia/issues/145)) ([e07a47e](https://github.com/dyphn1/Docuvia/commit/e07a47ed3a1233cfa674d480a442b81c60ccd34f))
- **ui-core:** treat Tier C commit messages as untrusted data (issue [#111](https://github.com/dyphn1/Docuvia/issues/111)) ([570a296](https://github.com/dyphn1/Docuvia/commit/570a296c493eebf7ef05a38d962010f5eb627943))

### Features

- **agents:** wire docuvia knowledge-graph hooks into claude and copilot ([285d5cf](https://github.com/dyphn1/Docuvia/commit/285d5cfab4bd448cfe058d99b68865d8c5907286))
- **analyze:** implement Tier B batch processing and LSP escalation ([0b7daf7](https://github.com/dyphn1/Docuvia/commit/0b7daf77af8db0d652936f0d4614d203b1176020)), closes [hi#precision](https://github.com/hi/issues/precision)
- **analyze:** implement Tier C budgeted async LLM decision queue ([daa7bfd](https://github.com/dyphn1/Docuvia/commit/daa7bfd4cc441f79aceff24afcf2fa735b45eff4))
- **ci,docs:** extend Type B directionality locks to all Tech Providers (issue [#30](https://github.com/dyphn1/Docuvia/issues/30)) ([e24ac86](https://github.com/dyphn1/Docuvia/commit/e24ac863567b34167dfb0b680270a9d4538b4051))
- **cli,core,contracts,schema,libgit2:** migrate clean/status/sync/analyze/query/review/impact/export-topology/snapshot to Virtual Contracts architecture ([624fad5](https://github.com/dyphn1/Docuvia/commit/624fad5a05ae4d1c7520d4c0269669b25a1359f1))
- **cli,core,contracts:** single-flight lock for init, close remaining concurrent-init races (PLAT-006) ([93d59ff](https://github.com/dyphn1/Docuvia/commit/93d59ff927f1ea8fb92cef396b6b8e0bd3990f1c))
- **cli,core,ui-core,llm-api:** PLAT-007 Slice 5 — doctor reliability checks ([cc19aa2](https://github.com/dyphn1/Docuvia/commit/cc19aa205d18e5634104c89d4c64060e831bfe24))
- **cli:** add --format=json to query/impact/review (issue [#52](https://github.com/dyphn1/Docuvia/issues/52), roadmap item 31) ([e1de7c4](https://github.com/dyphn1/Docuvia/commit/e1de7c49d22d57449cc9918b9dec8da4ad2d0df4))
- **cli:** add --help/--version and make --interactive opt-in ([0361cd5](https://github.com/dyphn1/Docuvia/commit/0361cd527fea32f829b98f40b3cfc581173d0a42))
- **cli:** add doctor and uninstall commands, enhance AI platforms ([407eeb4](https://github.com/dyphn1/Docuvia/commit/407eeb4ecd3985166011a2fb5f591b5bfc9ebaf8))
- **cli:** add docuvia-* skill set with init --skills / uninstall --skills ([#50](https://github.com/dyphn1/Docuvia/issues/50)) ([cb32c2d](https://github.com/dyphn1/Docuvia/commit/cb32c2dc9143e9264f1bf18946322aa9c0326262))
- **cli:** analyze --agent-authored command surface (Part D, issue [#42](https://github.com/dyphn1/Docuvia/issues/42)) ([af3e641](https://github.com/dyphn1/Docuvia/commit/af3e641fc1d17d4429e81478efda838f6056e7cf))
- **cli:** consistent, readable text output for the remaining commands ([d429d8b](https://github.com/dyphn1/Docuvia/commit/d429d8bba7d0d67bb26130641ceddd87b1a9b7d9))
- **cli:** extend table-based output style to status, query, impact ([bedf146](https://github.com/dyphn1/Docuvia/commit/bedf146fce4f4f17fc49414d0f7ddcf5c729f3f3))
- **cli:** register Claude PreToolUse hook via project-level settings.json ([48036ab](https://github.com/dyphn1/Docuvia/commit/48036ab16782b5ffbfcfc66a5b2dedc102ec0b9e)), closes [anthropics/claude-code#24529](https://github.com/anthropics/claude-code/issues/24529)
- **cli:** rename sync command to publish (IFCE-005) ([f260d6a](https://github.com/dyphn1/Docuvia/commit/f260d6a2859fa711b4b8c6fa1755034010a98f0f))
- **cli:** render doctor diagnostics as sectioned, human/agent-readable tables ([75c852a](https://github.com/dyphn1/Docuvia/commit/75c852a834204aaea3c6cacb33325468f09ea1eb))
- **cli:** replace Markdown Agents catch-all with named Copilot/Codex/Continue/Hermes platforms ([dea8e1b](https://github.com/dyphn1/Docuvia/commit/dea8e1b01ac41c5bdc39829714825cb726fc6496))
- **cli:** support CI/CD detection and align ADRs ([a5dd7c4](https://github.com/dyphn1/Docuvia/commit/a5dd7c4b6b2ac5f3572d799166e37a9d2a49afaa))
- **contracts,ci:** enforce Virtual Contracts layer boundaries + move shared constants to contracts (issue [#30](https://github.com/dyphn1/Docuvia/issues/30)) ([9678428](https://github.com/dyphn1/Docuvia/commit/967842892dce0da6860f7c76b6dee562df288158))
- **contracts,ci:** resolve ast-core classification + Type B layer-boundary rules (issue [#30](https://github.com/dyphn1/Docuvia/issues/30)) ([fa146a6](https://github.com/dyphn1/Docuvia/commit/fa146a646938357e9e2b928c0602973fbbb12e3d))
- **contracts,core,libgit2,ui-core,cli:** analyze auto mode with tiered delta ingestion (PLAT-007 Slice 2a) ([0e66ed6](https://github.com/dyphn1/Docuvia/commit/0e66ed66411b787f3951ce06f5217832772939c6))
- **contracts,core,ui-core,cli:** implement analyze <targetPath> LLM decision extraction, close analyze.md test gaps ([269b810](https://github.com/dyphn1/Docuvia/commit/269b810f1cc8ab4dbed24d4507873eee99fa6c73))
- **contracts,llm-api,cli:** bridge to CLIProxyAPI for multi-provider LLM access (LLM-002) ([1edd630](https://github.com/dyphn1/Docuvia/commit/1edd630528992cbe40c28084f01a9e5436b6a652))
- **contracts,schema:** agent-authored L3 decision source (Part A+B, issue [#42](https://github.com/dyphn1/Docuvia/issues/42)) ([136b41e](https://github.com/dyphn1/Docuvia/commit/136b41ee8588efbeb688090b6d985ee2d0776bf5))
- **contracts,ui-core,cli,core:** docuvia hooks list/enable/disable (Part E, issue [#42](https://github.com/dyphn1/Docuvia/issues/42)) ([4a79495](https://github.com/dyphn1/Docuvia/commit/4a794957b880625453a35f4e28a05b53dce9aa36))
- **core,contracts,cli:** signal query match confidence via match_type ([3517ed1](https://github.com/dyphn1/Docuvia/commit/3517ed1c515caf20d5783e35fc3e9f5dde36de0b))
- **core,contracts,libgit2,schema,ui-core,cli:** implement L3 distribution strategy (Phase 2, item 1) ([5db3610](https://github.com/dyphn1/Docuvia/commit/5db361001e2bb35bbe1e8c95a69a78a7d9e70450))
- **core,contracts,libgit2,ui-core,cli:** flip post-commit hook to analyze behind concurrency gates (PLAT-007 Slice 2b) ([b316f2f](https://github.com/dyphn1/Docuvia/commit/b316f2f939ca03d2719a305a83f25d62c82db1bb))
- **core,lsp:** project-aware + dependency-ordered Tier B sharding (issue [#41](https://github.com/dyphn1/Docuvia/issues/41)) ([74d88cb](https://github.com/dyphn1/Docuvia/commit/74d88cbd30c488402e8b2b1f2c7270da8f14c63d))
- **core,ui-core:** implement §9m item 1 — Tier B commit-cap trigger switches to cumulative changed-bytes ([5d0022c](https://github.com/dyphn1/Docuvia/commit/5d0022c0370c6369fb8414af99c09bcd1dc6f0f8))
- **core,ui-core:** wire sync-knowledge into pre-push hook, park remote-sync auto-push (Phase 2, items 1-2) ([f381a91](https://github.com/dyphn1/Docuvia/commit/f381a91200012e373a74e1bbf1c4902e6851ffbe))
- **core:** bounded K-way cross-file concurrency for Tier B LSP batch (issue [#11](https://github.com/dyphn1/Docuvia/issues/11) follow-up) ([2fd96b9](https://github.com/dyphn1/Docuvia/commit/2fd96b976a99c35afa930a59ea044b6ca3db9f2e))
- **core:** enrich export-topology output with L2/L3 detail and edge provenance (roadmap [#5](https://github.com/dyphn1/Docuvia/issues/5)) ([949a65d](https://github.com/dyphn1/Docuvia/commit/949a65d81c7782900692bc423b858b488c51bbbe))
- **core:** forward Tier B edge resolution core via textDocument/definition (issue [#11](https://github.com/dyphn1/Docuvia/issues/11) Slice 2) ([#12](https://github.com/dyphn1/Docuvia/issues/12)) ([08a2344](https://github.com/dyphn1/Docuvia/commit/08a23444cb70da39d8a94719195716e3f05a8e59))
- **core:** forward Tier B edge resolution TS flip (issue [#11](https://github.com/dyphn1/Docuvia/issues/11) plan A, Slice 3) ([b89de1c](https://github.com/dyphn1/Docuvia/commit/b89de1cf290715a058f232e71660c285f4db0230))
- **core:** multi-process sharding for Tier B LSP batch (issue [#11](https://github.com/dyphn1/Docuvia/issues/11), Slice 4) ([0a9de9d](https://github.com/dyphn1/Docuvia/commit/0a9de9dff8c1cd6bf027cf5f3ad9c921ba794b22))
- **core:** persist AST call-site source positions (forward resolution Slice 1) ([bd7d3c9](https://github.com/dyphn1/Docuvia/commit/bd7d3c946092e648c5ddb09b340d5188b948bbf8)), closes [#11](https://github.com/dyphn1/Docuvia/issues/11)
- **core:** surface L3 why data in review/impact output ([492e93b](https://github.com/dyphn1/Docuvia/commit/492e93bae00d74d996ef9d9d4eb354abeeaed55d)), closes [#4](https://github.com/dyphn1/Docuvia/issues/4)
- doctor graph-health checks, impact coverage note, CI graph job (issues [#134](https://github.com/dyphn1/Docuvia/issues/134)-139) ([b365743](https://github.com/dyphn1/Docuvia/commit/b365743a74ed526f567fd7cd465cd649724af6b3)), closes [#134-139](https://github.com/dyphn1/Docuvia/issues/134-139)
- **graph:** qualify node_key by containment (GRPH-006) ([7e99979](https://github.com/dyphn1/Docuvia/commit/7e99979d7ec80076f5b46e0f0ace6746567c4616))
- **graph:** resolve Rust/Go/C++ node_key containment (GRPH-006 follow-up) ([9baf6e6](https://github.com/dyphn1/Docuvia/commit/9baf6e6107bf2bbb2d1cbcb2bdbad495fd199522))
- **lint:** enforce cyclomatic complexity budget (max 10) via ESLint ([f0c4a1b](https://github.com/dyphn1/Docuvia/commit/f0c4a1b8511299bacacb557ae00ceceaa2c7516f))
- **lsp:** add --lsp-timeout flag, 0 = never time out (fixes csharp-ls hang) ([2903417](https://github.com/dyphn1/Docuvia/commit/2903417316d57c657497afb7b81d75de6f0b5017))
- **lsp:** add C/C++ LSP support with clangd ([be0c4bd](https://github.com/dyphn1/Docuvia/commit/be0c4bd1eae709465296fcdc345ef14ce3c00718))
- **lsp:** add C# LSP support with csharp-ls ([528e1fb](https://github.com/dyphn1/Docuvia/commit/528e1fbd5f92d7444eb71afb8bddb13ea5e2fc99))
- **lsp:** add Go LSP support with gopls ([b867394](https://github.com/dyphn1/Docuvia/commit/b867394e336189ccaba0ff71bc19015f2fcabf3d))
- **lsp:** add Java LSP support with jdtls ([f896b0c](https://github.com/dyphn1/Docuvia/commit/f896b0cf3943035f9f6919cfdd6fa2f6c5504972))
- **lsp:** add per-language provider registry and Python LSP support ([ebc33b4](https://github.com/dyphn1/Docuvia/commit/ebc33b492182929f4b80e403a6f1fda316d024e5))
- **lsp:** add PHP LSP support with intelephense ([f42182e](https://github.com/dyphn1/Docuvia/commit/f42182e40920713394cbdebc742621763a87f993))
- **lsp:** add Ruby LSP support with ruby-lsp ([1a90134](https://github.com/dyphn1/Docuvia/commit/1a90134cd08a653665d7978270d8bb6f23004e02))
- **lsp:** add Rust LSP support with rust-analyzer ([4a92c41](https://github.com/dyphn1/Docuvia/commit/4a92c41d623a82848d8634d77f4597cd09158dd6))
- **mcp,ui-core:** add query/impact/applyDecision MCP tools ([#49](https://github.com/dyphn1/Docuvia/issues/49), [#47](https://github.com/dyphn1/Docuvia/issues/47)) ([1d2c5a4](https://github.com/dyphn1/Docuvia/commit/1d2c5a48917ccab1e027b8d0bc3e708d0230e8b8))
- **mcp:** add docuvia_query/impact/status/detect_changes read-path tools ([#190](https://github.com/dyphn1/Docuvia/issues/190)) ([0e9efa4](https://github.com/dyphn1/Docuvia/commit/0e9efa4fffa272c4d9c42e35b99d29d070ba6404))
- **release:** add semantic-release pipeline, npm publish config, backfilled CHANGELOG (issue [#191](https://github.com/dyphn1/Docuvia/issues/191)) ([4092682](https://github.com/dyphn1/Docuvia/commit/4092682030ece34734a2782a92cdd09676a3c6e8))
- **schema,contracts,ui-core,cli:** persist analyze <targetPath> L3 decisions with provenance (PLAT-007 Slice 1) ([871c961](https://github.com/dyphn1/Docuvia/commit/871c961d8638f76d28c4c1ecd6c99ed08136e76b))
- **storage:** implement STOR-001 cross-clone reconciliation (Phase 3) ([551f574](https://github.com/dyphn1/Docuvia/commit/551f574a378fc6f34a0d8735b8404f37b18478db))
- **storage:** implement STOR-005 node identity + STOR-001/002 hydration pipeline (Phases 0-2) ([e997af2](https://github.com/dyphn1/Docuvia/commit/e997af2252f29598e4051a4671538f2a12fb83da))
- **sync-knowledge:** make git push/fetch network timeout configurable, default to none ([2b1ec1a](https://github.com/dyphn1/Docuvia/commit/2b1ec1a22fc60718cf0903a902a962942053ad12))
- **ui-core,cli,core:** stage-and-flush for commit-l3-write (Part F, issue [#42](https://github.com/dyphn1/Docuvia/issues/42)) ([9b8b159](https://github.com/dyphn1/Docuvia/commit/9b8b159c2b04c5fa434220e36ad15bded9f38ef3))
- **ui-core,cli:** add --tier-c-all flag to drain entire Tier C queue in one run (issue [#145](https://github.com/dyphn1/Docuvia/issues/145)) ([4a20577](https://github.com/dyphn1/Docuvia/commit/4a2057728116351a7eac83ca76fbe90844c2e281))
- **ui-core,cli:** surface Tier B processing coverage in status and doctor ([7314553](https://github.com/dyphn1/Docuvia/commit/731455338e23570ec72ef44e9048801192979a77))
- **ui-core:** agent-authored L3 write path (Part C, issue [#42](https://github.com/dyphn1/Docuvia/issues/42)) ([c1b6484](https://github.com/dyphn1/Docuvia/commit/c1b6484fb8105718d3e63dc476c6d8136099a2c4))
- **workflow:** implement early-exit optimization and overwrite protection ([8673d8c](https://github.com/dyphn1/Docuvia/commit/8673d8c3d11fee79eff80a13602dfbe821565d72))

### Performance Improvements

- **ast:** cache Language.load() per wasmPath in the AST worker ([32ab66a](https://github.com/dyphn1/Docuvia/commit/32ab66a53358c7ee14852a7a52b2f160ae43aa9a)), closes [#2](https://github.com/dyphn1/Docuvia/issues/2)
- **core:** pipeline per-file references requests in Tier B LSP batch (issue [#11](https://github.com/dyphn1/Docuvia/issues/11)) ([3bc58cb](https://github.com/dyphn1/Docuvia/commit/3bc58cba1c837e91e2bbde3d58747dad15685280))
- **plugins-ast:** compile a functions query for TS/JS instead of a fallback tree walk ([ca732e0](https://github.com/dyphn1/Docuvia/commit/ca732e0657e5b8586170c496e69c4b050945b3d6)), closes [#3](https://github.com/dyphn1/Docuvia/issues/3)
- **ui-core:** hydrate from knowledge branch before delta ingestion (roadmap [#11](https://github.com/dyphn1/Docuvia/issues/11)) ([f2f44d3](https://github.com/dyphn1/Docuvia/commit/f2f44d3017ad48a2eb99c729db987656e0dbc7f6))

## [0.0.x] — initial public baseline (backfilled)

Backfilled from the roadmap and ADR record (2026-07 → 2026-08); the project shipped continuously
during this window without tags or a changelog. New entries above are generated automatically by
semantic-release from conventional commits.

### Added

- **Knowledge graph core** — tree-sitter AST ingestion, FTS5 query, SQLite storage, git-history-driven change detection (`lib/core`, `lib/ast-core`, `lib/plugins-ast`).
- **Tiered background knowledge evolution** (PLAT-007) — Tier A snapshot, Tier B LSP cross-file edge escalation, Tier C queued decisions.
- **CLI commands** — `init`, `analyze`, `query`, `impact`, `review`, `status`, `doctor`, `hooks`, `snapshot`, `hydrate`, `export-topology`, `publish`, `sync-knowledge`, `uninstall`.
- **MCP server** — `docuvia_query` / `docuvia_impact` / `docuvia_status` / `docuvia_detect_changes` read-path tools plus `docuvia_applyDecision` staging (#49, #47, #190), with behavioral descriptions that steer agent invocation.
- **Agent-authored L3 write path** — `analyze <file> --agent-authored --stage` persists agent-supplied architectural decisions into the graph (2026-08-15).
- **Per-behavior hook lifecycle** — `docuvia hooks list/enable/disable/check` (2026-08-15).
- **Shared `--format` flag with `json` output** across `query`/`impact`/`review`/`detect-changes` (#52, 2026-08-18).
- **`docuvia-*` skill set** — four task-routed skill files installed via `docuvia init --skills` / removed via `uninstall --skills` (PR #176, IFCE-007).
- **L3 distribution strategy & sync-knowledge scheduling** (2026-07-21) — see `phase2-l3-distribution.md`, `phase2-sync-knowledge-scheduling.md`.
- **Multi-platform agent integration installers** — Claude Code, Cursor, GitHub Copilot, Codex, Continue, Hermes.

### Changed

- `sync` renamed to `publish`; `sync-knowledge` unchanged (IFCE-005, 2026-07-28).
- L3 "why" rationale now surfaced in `review`/`impact` output (2026-07-28).
- Richer `export-topology` output (2026-07-28).
- `query`/`impact` results carry `matchType: "exact" | "keyword" | "neighbor"` confidence signals; empty results mean unknown, not zero (#22, 2026-08-05).

### Fixed

- Race between foreground `query` reads and background `analyze` writes (Race C, 2026-07-28).
- Hydrate-then-delta optimization avoids full rehydration when possible (2026-07-28).
- Test resilience: poll rust-analyzer `documentSymbol` instead of fixed sleeps; centralized git-local fixtures + fs-race retries (#187, #188).

### Infrastructure

- CI runs the platform-sensitive test gate on both ubuntu and windows runners.
- Knowledge-graph PR comment rendering targeted at humans, not agents (#200).
