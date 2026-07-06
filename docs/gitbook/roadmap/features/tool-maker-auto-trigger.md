# Tool Maker Auto-Trigger

- **Status**: 🔲 TODO
- **Phase**: Phase 6: Architecture Hardening & Security
- **Evidence / Verification Target**: No trigger code found in `lib/core` or `artifacts` for auto-generating deterministic parsing scripts from LLM-discovered patterns

## Implementation Details

This feature tracks the "Tool Maker" concept from [ADR-006](../../adr/ADR-006-self-evolution-architecture.md#4-tool-maker-integration): when the AST Microkernel cannot resolve a domain-specific pattern and falls back to the LLM, a sufficiently deterministic new rule should be able to trigger a Tool Maker agent that generates a dedicated, lightweight local parsing script (e.g. a regex/heuristic scanner) to permanently offload that pattern from the LLM back to local compute.

The automated trigger mechanism does not exist yet — there is no code path that detects a "deterministic enough" correction and spawns a Tool Maker run.

## Testing & Verification

- Not yet applicable — no implementation to verify.
