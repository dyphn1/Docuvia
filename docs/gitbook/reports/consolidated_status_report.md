# Consolidated Verification & Audit Report

**Date**: 2026-07-03

## 1. Overview

This report consolidates the findings from various Phase 1-6 verification reports and the project audit conducted in early July 2026. All identified implementation gaps have been cross-referenced with the current codebase state.

## 2. Fully Resolved Items (Audit Findings)

The findings from `audit-report-2026-07-02.md` have been manually verified as **fully addressed** in the codebase:

- **High**: Database indexes for foreign keys (e.g., `commitIdIdx`, `l2NodeIdIdx`) have been properly declared in the schemas under `lib/db/src/schema/pg/`.
- **Medium**: 3A structure comments (`// Arrange`, `// Act`, `// Assert`) have been added to `artifacts/vscode-client/src/tests/phase1.test.ts`. Missing mermaid diagrams were successfully added to the respective ADRs.
- **Low**: Date/Status headers have been applied across all ADRs.

---

## 3. Unresolved Issues & Architectual Drift (⚠️ WARN)

The following issues represent discrepancies between the design specs/ADRs and the actual code implementation. **They remain unresolved in the codebase and require active fixing.**

### 3.1. SVN Integration: Diffs Misplaced & Omitted

- **Status**: ⏸️ Pending (Paused by User)
- **Target Files**: `lib/core/src/services/ingestion-pipeline.ts`, `lib/core/src/services/svn-client.ts`
- **Description of Failure**:
  The `commits` table has a dedicated `diff` column, but it is completely unused for SVN.
  1. `getSvnLog` in `svn-client.ts` does not fetch SVN diffs, causing a silent loss of diff information.
  2. In `ingestion-pipeline.ts`, the code concatenates the available diff to the commit `message` (`const fullMessage = c.diff ? \`\${c.message}\n\n\${c.diff}\` : c.message;`) and truncates the entire block to 4000 characters. This misuses the `message`field and leaves the`diff`column empty for SVN. (Note: Git diff extraction was successfully fixed to utilize the`diff` column).
- **Required Action**: Modify `getSvnLog` to properly fetch and populate `c.diff`. Update `ingestion-pipeline.ts` for SVN to store `c.message.slice(0, 4000)` in the `message` column and `c.diff.slice(0, 4000)` exclusively in the `diff` column.

### 3.2. Cross-Project Linking

- **Status**: ✅ Done (Soft Links Implemented)
- **Target Files**: `artifacts/api-server/src/services/generate.service.ts`
- **Description of Fix**:
  Implemented dynamic cross-project "soft linking" via global L1 tags. `extractSieveDecisions` now queries `l2_node_l1_tags` to identify other projects that share the same global tags, retrieving their L2 Node context. This context is injected directly into the LLM `systemPrompt` at generation time, avoiding any hardcoded foreign keys. If a tag is removed, the link immediately vanishes.

### 3.3. Conceptual Edge Divergence from ADR-018

- **Status**: ⚠️ WARN (Unresolved)
- **Description of Failure**:
  Link generation attempts to use an undefined, generic `SIMILAR_LINK` edge type instead of the explicitly mandated 4D graph edge types (`IMPLEMENTS`, `EXPLAINS`, `EVOLVED_INTO`) from ADR-018. It entirely lacks temporal properties (commit SHA, diff summary) on edges, bidirectional validation (`HAS_RULE`), and self-healing re-anchoring logic for when commits are altered.
- **Required Action**: Refactor edge creation to use ADR-018 mandated types. Implement bidirectional `HAS_RULE` checks and temporal tracking properties on edges.

### 3.4. LLM Abstraction Layer is OpenAI-Only

- **Status**: ⚠️ WARN (Known Trade-off)
- **Target Files**: `lib/core/src/services/generate.service.ts`
- **Description of Failure**:
  The implementation strictly hardcodes the `OpenAI` client interface without a multi-provider abstraction fallback. Retry handling is undifferentiated, and streaming endpoints are missing.
- **Required Action**: This is a known architectural limitation (per ADR-004). If multi-provider support (Anthropic, Gemini, etc.) becomes required in the roadmap, a generic `LlmProvider` abstraction layer must be built.
