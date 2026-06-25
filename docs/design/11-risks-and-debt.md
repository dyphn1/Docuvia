# 11. Risks and Technical Debt

## 11.1 Risk Register

| ID   | Risk                                                                                       | Severity    | Impact                                                                       | Mitigation / Status                                                                                                                     |
| ---- | ------------------------------------------------------------------------------------------ | ----------- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| R-01 | In-memory vector search does not scale past ~100K nodes                                    | 🟠 Medium   | Query accuracy degrades; memory usage grows linearly                         | Planned: migrate to Qdrant or [pgvector](adrs/ADR-019-pgvector-migration.md) in v2. See [ADR-019](adrs/ADR-019-pgvector-migration.md) |
| R-02 | Multi-hop graph traversal missing (one-hop only via `node_links`)                          | 🟠 Medium   | Incomplete dependency and impact analysis for complex module graphs          | BFS/DFS multi-hop traversal planned. See `docs/ai_plans/`                                                                               |
| R-03 | [Cross-project link](adrs/ADR-018-temporal-and-conceptual-bidirectional-linking.md) activation not wired (review approval does not insert `node_links` row) | 🟠 Medium   | Cross-project knowledge graph connections remain incomplete                  | Review resolution handler needs explicit `node_links` INSERT after approval                                                             |
| R-04 | No Ollama / local LLM adapter                                                              | 🟡 Low      | Self-hosting without a paid API key is blocked                               | Ollama supports OpenAI-compatible mode via `OLLAMA_HOST`; a dedicated adapter class would simplify this                                 |
| R-05 | `scoreCommit()` duplicated across `ingest.ts` and `github_webhooks.ts`                     | 🟢 Minor    | Logic drift between ingest and webhook filter over time                      | Extract to a shared utility module in `api-server/src/lib/`                                                                             |
| R-06 | Markdown export format unverified (`export.ts` returns JSON only)                          | 🟢 Minor    | Roadmap specifies JSON + Markdown export; Markdown serializer may be missing | Audit `export.ts`; add Markdown serializer if absent                                                                                    |
| R-07 | [VS Code extension](adrs/ADR-001-vscode-client-onboarding.md) has no `.vsix` build script in CI                                        | 🟡 Low      | Cannot distribute the extension via VS Code Marketplace or sideloading       | Add `vsce package` step to CI; output `.vsix` as a build artifact                                                                       |
| R-08 | Multi-root workspace bugs in [VS Code extension](adrs/ADR-001-vscode-client-onboarding.md) (`acceptL1Tags`)                            | 🔴 Critical | Data corruption in multi-root VS Code workspaces                             | See [user-journeys.md Bugs A-1, A-2, A-3](vscode-client/ui-ux/user-journeys.md) — active open bugs               |
| R-09 | `TaskRunner` always writes `l2_module_id: ""` — orphaned decisions                         | 🔴 Critical | All decisions extracted via VS Code extension are unlinked from L2 modules   | See [user-journeys.md Bug B-1](vscode-client/ui-ux/user-journeys.md) — active open bug                           |

---

## 11.2 Technical Debt Register

| ID   | Debt                                                                                                    | Type             | Priority  |
| ---- | ------------------------------------------------------------------------------------------------------- | ---------------- | --------- |
| D-01 | `scoreCommit()` code duplication between `ingest.ts` and `github_webhooks.ts`                           | Code quality     | 🟢 Low    |
| D-02 | No `.vsix` packaging step in CI                                                                         | Build automation | 🟡 Medium |
| D-03 | Static file serving for `kg-engine` not wired for production (Vite `dist/` not served by `api-server`)  | Deployment       | 🟡 Medium |
| D-04 | Test suite coverage limited (mostly route-level contract tests; unit coverage of internal services low) | Testing          | 🟡 Medium |
| D-05 | CodeLens uses line-number anchoring — drifts as file is edited                                          | Feature quality  | 🟡 Medium |
| D-06 | No CLI for natural language queries (web UI or VS Code only)                                            | Feature gap      | 🟢 Low    |
| D-07 | `prompt_templates` table exists but default fallback templates are not seeded in migrations             | Operational      | 🟡 Medium |

---

## 11.3 References

- Full Known Limitations: [Roadmap Checklist](../roadmap/roadmap_checklist.md)
- VS Code extension active bugs: [docs/design/vscode-client/ui-ux/user-journeys.md](vscode-client/ui-ux/user-journeys.md)
- ADR-019 (pgvector migration): [adrs/ADR-019-pgvector-migration.md](adrs/ADR-019-pgvector-migration.md)
- ADR-004 (LLM adapter): [09-architectural-decisions.md](09-architectural-decisions.md#adr-004-openai-compatible-llm-interface-only)
