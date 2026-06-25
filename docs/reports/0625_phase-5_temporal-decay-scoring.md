# Verification Report: Item 3.2.2 — Decay Application on Knowledge Query Results
- **Date**: 2026-06-25
- **Phase & Item**: Phase 5 - Temporal Decay Scoring
- **Target File**: Unknown (Derived from audit)
- **Status Update Required**: ❌ ERROR / ⚠️ WARN

### Description of Failure
2. **❌ Vector search fallback**: L2 fallback (line 336) and L3 fallback (line 377) use fixed scores (0.9, 0.8) with no decay applied, violating the universal decay requirement.


3. **❌ Graph traversal**: All scoring uses fixed constants (seed: 1.0, related L2: 0.8, L3 decisions: 0.9) with no decay applied.


4. **❌ Direct lookup**: Hash match (line 513) and ILIKE match (line 547) use fixed scores (1.0, 0.8) with no decay applied.


5. **❌ Validity status bug**: Lines 500 and 535 still check for `validityStatus !== 'active'` instead of `'valid'`, breaking the direct lookup path when `includePending=false`.


6. **⚠️ Hybrid search**: Combines decayed vector results with non-decayed graph results; the merge scoring boost (`existing.score += r.score + 0.5`) can push older, non-decayed graph results above newer, decayed vector results.


7. **❌ Single-word fast-circuit**: Routes to `directLookupHandler` which applies no decay, meaning the fastest path returns results without age-based ranking.

**Design Gap**: The specification requires universal decay application so that "knowledge untouched naturally sinks to the bottom," but decay is only applied in 1 of 6 query paths (vector search with embeddings). This creates inconsistent behavior where the same query may return different rankings depending on which strategy is selected.
...


1. **❌ Inconsistent decay application**: Decay logic is duplicated where present (vector search) rather than centralized. No shared `applyDecayToResults()` utility exists.


2. **❌ Magic numbers**: Fixed scores (1.0, 0.9, 0.8) are hardcoded throughout handlers without decay adjustment.


3. **❌ Function length**: `vectorSearchHandler()` exceeds 180 lines, violating the 100-line recommended maximum.


4. **❌ Missing tests**: No unit tests for decay application in graph traversal, direct lookup, or fallback paths.

### Security Review

- **✅ Input validation**: All queries use parameterized Drizzle ORM — no SQL injection risk.
- **✅ Validity status**: Despite the 'active' vs 'valid' bug, the schema correctly defines the enum as `pending | valid | orphaned`.
- **✅ Error handling**: `classifyIntent()` has proper fallback to `vector_search` on failure.

### Critical Bug Re-Confirmation

The `vali...

### Recommended Fix
Review the warnings and implement fixes in the corresponding source files.
