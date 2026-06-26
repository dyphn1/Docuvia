# Verification Report: Item 9.4.4 — E2E: LLM Pipeline Full Flow
- **Date**: 2026-06-26
- **Phase & Item**: Phase 1 - E2E LLM Pipeline
- **Target File**: `artifacts/api-server/test/integration/generate.test.ts`
- **Status Update Required**: ⚠️ WARN

### Description of Failure
1. **🔴 HIGH — No full-flow E2E test exists**: The existing `generate.test.ts` covers only the minimal happy path (2 commits, single batch, no documents, no corrections, no dedup). The full 7-step pipeline (fetch commits → fetch documents → L1 Tagger → L2/L3 Generation → L3 Dedup → Noise Detection → Cross-project links) is never tested end-to-end.

2. **🔴 HIGH — Mock fixtures are incomplete**: The MSW handler returns hardcoded responses that don't distinguish between L1/L2/L3 prompts precisely, and lacks scenario-based fixture loading.

3. **🟡 MEDIUM — Embedding mock returns degenerate 3-element vector**: `[0.1, 0.2, 0.3]` is a 3-element vector. The real embedding model returns 1536+ dimensions. Cosine similarity and dedup logic are not realistically tested.

4. **🟡 MEDIUM — Multi-batch loop (BATCH_SIZE=20) never exercised**: Only 2 commits tested. Edge cases in batch boundary handling are untested.

5. **🟡 MEDIUM — Correction examples / few-shot injection not tested**: ADR-010 swarm intelligence feature has zero test coverage.

6. **🟡 MEDIUM — Noise detection path not tested**: `runNoiseDetection()` function has no test coverage.

7. **🟡 MEDIUM — Cross-project link detection not tested**: `detectCrossProjectLinks()` has no test coverage.

8. **🟢 LOW — Duplicate MSW handler registration**: `handlers.ts` and `openai.ts` both register the same endpoint URL.

### Recommended Fix
1. Create comprehensive full-flow test with 40+ commits, documents, and correction examples.
2. Extend MSW handler for scenario-based fixtures.
3. Use realistic 1536-dimension embedding vectors in mock responses.
4. Add tests for noise detection, cross-project links, and path-rule mode.
5. Remove duplicate MSW handler registration.
