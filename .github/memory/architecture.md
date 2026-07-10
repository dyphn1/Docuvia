# Architecture & Design Memory

## 🛡️ Core Architectural Invariants (The Spirit)

1. **Pure Orchestrators & POP (Protocol-Oriented Programming)**
   - Core services (`AnalyzeService`, etc.) MUST be thin orchestrators. Extract business logic into highly cohesive, SRP-compliant modules. Avoid "God Objects".
2. **Strict MVC & Thin Presentation**
   - API routes, VS Code commands, and CLI handlers are STRICTLY presentation layers.
   - NO direct DB/ORM access or heavy logic here. Delegate all execution to `@workspace/core`.
3. **Local-First & Git-Isomorphic**
   - The knowledge graph prioritizes Git-native file writes (`.jsonl`, `.md`) over SQLite to maintain true isomorphism with the repository state.
4. **Single Source of Truth (SSOT)**
   - **APIs**: `lib/api-spec/openapi.yaml`. NEVER hand-edit React Query or Zod hooks. Rely on `codegen`.
   - **Database**: `lib/db/src/schema/` (PostgreSQL/Drizzle). NEVER manually create DB types.
5. **Multi-Root Resilience**
   - NEVER use `workspaceFolders[0]`. Pass explicit URIs and use multi-root state maps to avoid global singleton traps in VS Code.

## 🧭 Navigation

- **DO NOT rely on hardcoded paths.** The codebase evolves rapidly.
- Use **GitNexus** (`impact`, `query`, `context`) to locate modules, trace execution flows, and assess blast radius BEFORE editing.
