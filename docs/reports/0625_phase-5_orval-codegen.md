# Verification Report: Item 6.1.2 — Orval codegen → Zod validators + React Query hooks
- **Date**: 2026-06-25
- **Phase & Item**: Phase 5 - Orval Codegen
- **Target File**: Unknown (Derived from audit)
- **Status Update Required**: ❌ ERROR / ⚠️ WARN

### Description of Failure
1. **🔴 Server routes define inline Zod schemas instead of using generated ones.** At least 8 route files define their own `z.object({...})` schemas:
   - `integrations.ts`: `IntegrationInputSchema`, `IntegrationUpdateSchema`
   - `llm_config.ts`: `LlmConfigInputSchema`
   - `extensions_vscode.ts`: `VscodeQuerySchema`, `VscodeCreateDecisionSchema`
   - `search.ts`: `SearchSchema`, `FeedbackSchema`
   - `l2_nodes.ts`: `NodeLinkInputSchema`
   - `mcp.ts`: `mcpQueryBodySchema`
   - `templates.ts`: `...


2. **🟡 Codegen cannot run in current environment.** Running `pnpm --filter @workspace/api-spec run codegen` fails with `orval: command not found` because `node_modules` is not installed for the api-spec package. This is an environment issue (not a code issue), but it means the codegen pipeline hasn't been exercised recently.


3. **🟡 No CI enforcement of codegen freshness.** There is no CI step that verifies the generated files are in sync with `openapi.yaml`. A spec change could be committed without running codegen, and CI would not catch it.

**Round 1 Verdict: WARN** — The codegen pipeline architecture is excellent. Orval is properly configured, generated files are comprehensive and correctly structured, hook count matches operationId count, and the custom fetch wrapper is well-engineered. However, multiple server ...


1. **🔴 Inline Zod schemas duplicate spec-defined types.** The following routes define their own Zod schemas for types that likely exist in the OpenAPI spec:
   - `search.ts`: `SearchSchema`, `FeedbackSchema` — spec defines `SearchInput`, `SearchFeedbackInput`
   - `l2_nodes.ts`: `NodeLinkInputSchema` — spec defines `NodeLinkInput`
   - `templates.ts`: `TemplateUpdateSchema` — spec likely defines template update types
   - `documents.ts`: `AffiliateBodySchema` — spec defines `AffiliateDocumentInp...


2. **🟡 Extensions VS Code routes use raw Zod exclusively.** `extensions_vscode.ts` defines `VscodeQuerySchema` and `VscodeCreateDecisionSchema` inline, even though the spec defines `VscodeQueryInput` and `VscodeCreateDecisionInput`. This is a code quality concern — the VS Code extension endpoints should use the generated validators.


3. **🟡 MCP route uses inline schema.** `mcp.ts:230` defines `mcpQueryBodySchema` inline, but the spec defines `McpQueryInput`.


1. **🔴 Replace inline Zod schemas with generated ones.** The following route files should import Zod validators from `@workspace/api-zod` instead of defining them inline:
   - `search.ts` → use `SearchInput`, `SearchFeedbackInput` from spec
   - `l2_nodes.ts` → use `NodeLinkInput` from spec
   - `templates.ts` → use template update types from spec
   - `documents.ts` → use `AffiliateDocumentInput` from spec
   - `generate.ts` → use `GenerateInput` from spec
   - `integrations.ts` → use integrati...


2. **🟡 Add CI check for codegen freshness.** Implement a CI step that runs `pnpm --filter @workspace/api-spec run codegen` and verifies no generated files changed (i.e., `git diff --exit-code`). This ensures the generated files are always in sync with the spec.


3. **🟡 Add a pre-commit hook for codegen.** Consider adding a git pre-commit hook that runs codegen when `openapi.yaml` changes, ensuring developers never forget to regenerate.

### Recommended Fix
Review the warnings and implement fixes in the corresponding source files.
