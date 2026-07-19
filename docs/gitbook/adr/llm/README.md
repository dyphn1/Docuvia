# LLM (LLM) — Provider Abstraction, Tokens, Extraction

**Current Model**:
All LLM traffic goes through the LLM-002 CLIProxyAPI bridge — no other endpoint integrations are
considered. `analyze <targetPath>` (focused decision extraction, persisted to `l3_nodes`) and the
Tier C budgeted async queue ([PLAT-007](../platform/PLAT-007-tiered-background-knowledge-evolution.md))
both invoke it. An embedded in-process model remains a documented seam, not built — see
[Roadmap & Open Items](../../analysis/roadmap-and-open-items.md).

## Decisions

| ID                                               | Decision                         | Status     | Notes                                                      |
| ------------------------------------------------ | -------------------------------- | ---------- | ---------------------------------------------------------- |
| [LLM-001](LLM-001-multi-provider-abstraction.md) | Multi-Provider Abstraction Layer | superseded | Carries forward legacy ADR-026; superseded by LLM-002      |
| [LLM-002](LLM-002-cliproxyapi-bridge.md)         | Bridge to CLIProxyAPI            | accepted   | Replaces in-house transport layer (Corresponds to Task #7) |
