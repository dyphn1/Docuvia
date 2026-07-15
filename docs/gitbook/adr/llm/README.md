# LLM (LLM) — Provider Abstraction, Tokens, Extraction

**Current Model**:
Currently, there are **no LLM invocation paths** (including `analyze <path>`). This functionality has been marked as deferred pending further implementation.

## Deferred / Unimplemented

- Bridge to CLIProxyAPI for multi-provider LLM access (Task #7)

## Decisions

| ID                                               | Decision                         | Status     | Notes                                                      |
| ------------------------------------------------ | -------------------------------- | ---------- | ---------------------------------------------------------- |
| [LLM-001](LLM-001-multi-provider-abstraction.md) | Multi-Provider Abstraction Layer | superseded | Carries forward legacy ADR-026; superseded by LLM-002      |
| [LLM-002](LLM-002-cliproxyapi-bridge.md)         | Bridge to CLIProxyAPI            | accepted   | Replaces in-house transport layer (Corresponds to Task #7) |
