# Verification Report: Item 1.1.5/1.1.6 — LLM Abstraction Layer
- **Date**: 2026-06-26
- **Phase & Item**: Phase 1 - LLM Abstraction Layer
- **Target File**: `lib/integrations-openai-ai-server/src/client.ts`
- **Status Update Required**: ⚠️ WARN

### Description of Failure
1. **🟡 MEDIUM — No generic LLM interface**: All code directly imports OpenAI-specific client. There is no `LlmProvider` interface or factory pattern. Adding a new provider requires touching every file that imports `openai`.

2. **🟡 MEDIUM — Per-project model switching is incomplete**: Only `generate.ts` and `metabolism.ts` use the per-project model. Embedding, intent routing, image generation, and audio all use hardcoded models regardless of project config.

3. **🟡 MEDIUM — `provider` field in `llm_configsTable` is stored but never consumed**: The `provider` column exists in the DB schema but no code reads or acts on it. Changing `provider` to "anthropic" in the DB would have zero effect.

4. **🟡 MEDIUM — LLM proxy is a mock**: `llm-proxy.ts` is wired at `/proxy/v1` but returns mock responses. It is never called by the generate pipeline.

5. **🟡 MEDIUM — `llm_config` routes lack authentication middleware**: Any caller can read or modify LLM config for any project.

6. **🟢 LOW — Stale ADR reference**: Checklist references "ADR-004-openai-compatible-llm-interface-only.md" but ADR-004 is "git-isomorphic-graph.md".

### Recommended Fix
1. Define a `LlmProvider` interface with `chat()`, `embed()`, `generateImage()` methods.
2. Implement a factory pattern to select the LLM client based on the `provider` field.
3. Extend per-project model switching to embedding, intent routing, image generation, and audio.
4. Add authentication middleware to `llm_config` routes.
5. Fix the stale ADR reference in the checklist.
