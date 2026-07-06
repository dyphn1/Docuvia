# System Architecture Refactoring Plan

> **Implementation status:** This plan predates and motivated [ADR-020 (Unified Isomorphic AST Microkernel)](../adr/ADR-020-unified-isomorphic-ast-microkernel.md) and [ADR-021 (Shared Core API and Presentation Layers)](../adr/ADR-021-shared-core-api-and-presentation-layers.md). Status is intentionally **not** self-declared here — each phase below links to the roadmap entry that tracks it, so completion is confirmed by the roadmap's own Status field, not by a checkbox in this document.

## 1. Current System Architecture (Issue Identified)

The current workspace violates the **"Core-Driven Development"** principle. Some core libraries and shared domain services are tightly coupled inside specific product artifacts instead of being generalized in the `lib/` directory.

```mermaid
graph TD
    subgraph Artifacts ["📦 Artifacts (Products & Interfaces)"]
        API["api-server<br/>(Express API & Webhooks)"]
        CLI["cli<br/>(Terminal Interface)"]
        VSCode["vscode-client<br/>(VS Code Extension)"]
        Web["kg-engine<br/>(React Frontend)"]
        Sandbox["mockup-sandbox<br/>(UI Prototypes)"]
        ASTCore["ast-core ❌<br/>(Should be a Library)"]

        subgraph APIServices ["Inside API Server (Tightly Coupled)"]
            DocService["document.service.ts"]
            GitIngest["git-ingestion.service.ts"]
            Dashboard["dashboard.service.ts"]
            SyncService["sync.service.ts"]
        end
        API --- APIServices
    end

    subgraph Lib ["📚 Lib (Shared Core)"]
        Core["core<br/>(Shared Business Logic)"]
        DB["db<br/>(Drizzle Schema & Migrations)"]
        OpenAI["integrations-openai-ai-server"]

        subgraph APISpecs ["API Contracts"]
            Spec["api-spec (OpenAPI)"]
            Zod["api-zod (Validators)"]
            ReactQuery["api-client-react (Hooks)"]
        end
    end

    API --> Core
    API --> DB
    API --> ASTCore
    CLI --> Core
    VSCode --> ASTCore
```

## 2. Issues & Violations

1. **`artifacts/ast-core` Misplacement**: AST parsing and bridging is a generic foundational capability (Isomorphic AST Microkernel). Placing it inside `artifacts/` suggests it is an end-product. It must be moved to `lib/ast-core`.
2. **Fat `api-server` (Domain Logic Coupling)**: Many core domain services (e.g., `git-ingestion.service.ts`, `dashboard.service.ts`, `document.service.ts`) are currently located in `artifacts/api-server/src/services/`. According to `shared_core_api_architecture.md`, the CLI, MCP, and VS Code extensions must consume the same core logic. Keeping these in `api-server` forces other artifacts to either duplicate logic or make unnecessary network calls.

## 3. Proposed Reasonable System Architecture (Selective Composition)

We need to relocate the misplaced packages and extract business logic from the API server into the `lib/` directory.
Crucially, to prevent `lib/core` from becoming a monolithic "God Package", we must split it into foundational core interfaces and dynamic plugins/extensions.

The presentation layers (`cli`, `mcp`, `vscode-client`, `api-server`, `kg-engine`) sit at the top level. They act as "Ports/Adapters" and **selectively compose** the core architecture and plugins based on their specific use cases and runtime environments.

```mermaid
graph TD
    subgraph PresentationLayer ["📦 Artifacts (Presentation & Interfaces)"]
        direction LR
        API["api-server / mcp<br/>(HTTP & MCP Endpoints)"]
        CLI["cli<br/>(Terminal / Automation)"]
        VSCode["vscode-client<br/>(Editor Integration)"]
        Web["kg-engine<br/>(Browser UI)"]
    end

    subgraph Lib ["📚 Lib (Modular Logic & Infrastructure)"]
        Core["core ✅<br/>(Base Interfaces, Orchestrator, Events)"]
        DB["db<br/>(Schema & Persistence)"]
        AI["integrations-openai-ai-server"]

        subgraph DynamicPlugins ["🧩 Dynamic Plugins (Implementations)"]
            ASTCore["ast-core ✅<br/>(Parser Engine Base)"]
            ASTPlugins["plugins-ast / extractors<br/>(Dynamic Language Plugins)"]
            DomainPlugins["plugins-domain<br/>(Specific Domain Logic)"]
        end

        subgraph Contracts ["Contracts"]
            Spec["api-spec"]
            Zod["api-zod"]
            ReactQuery["api-client-react"]
        end
    end

    %% Dependencies - Selective Composition
    API --> |Selects| Core & DomainPlugins & DB & Contracts
    CLI --> |Selects| Core & DomainPlugins & ASTCore & DB
    VSCode --> |Selects| Core & ASTCore & ASTPlugins
    Web --> |Selects| Contracts

    DynamicPlugins -. implements .-> Core
    Core --> DB
    Core --> AI
```

## 4. Refactoring Action Plan

### Phase 1: Relocate & Split `ast-core`

Move `artifacts/ast-core` to `lib/ast-core` so it becomes the base parser engine rather than an end-product artifact, split the language-detection/dynamic-parsing pieces out into `lib/plugins-ast`, and update `package.json`/`tsconfig.json` references accordingly.

**Status:** [AST Microkernel Architecture](../roadmap/features/ast-microkernel-architecture.md) — ✅ Done · [Monorepo Directory Layout](../roadmap/features/monorepo-directory-layout.md) — ✅ Done. Filesystem check: [`lib/ast-core/`](../../../lib/ast-core/) and [`lib/plugins-ast/`](../../../lib/plugins-ast/) both exist. **Caveat:** `artifacts/ast-core/` still exists on disk, but only as a stale `dist/` build output with no `package.json`/`src/` — the source move is real, the leftover build directory just hasn't been cleaned up.

### Phase 2: Prevent `core` from becoming a God Package

Identify domain services currently in `artifacts/api-server/src/services/` that are not strictly HTTP-bound, and define foundational interfaces, dependency injection tokens, and orchestrators (like `intent-router`) in `lib/core` instead.

**Status:** [Shared Core DI Orchestrator](../roadmap/features/shared-core-di-orchestrator.md) — ✅ Done. Decision recorded in [ADR-021](../adr/ADR-021-shared-core-api-and-presentation-layers.md).

### Phase 3: Dynamic AST Plugins

Split AST plugins into `lib/plugins-ast` as dynamic, per-language implementations layered on top of the `lib/ast-core` base engine.

**Status:** [AST Plugin Architecture](../roadmap/features/ast-plugin-architecture.md) — ✅ Done.

### Phase 4: Domain Services Extraction

Extract domain services out of `artifacts/api-server` into `lib/plugins-domain`.

**Status:** [Domain Plugin Architecture](../roadmap/features/domain-plugin-architecture.md) — ✅ Done.

### Phase 5: Presentation Layer Assembly

Refactor `api-server` to use a lightweight DI container, and ensure `api-server`, `cli`, and `vscode-client` compose the `lib/plugins-ast`/`lib/plugins-domain` plugins into the `lib/core` orchestrator without duplicating logic.

**Status:** [Presentation Layer DI Composition](../roadmap/features/presentation-layer-di-composition.md) — ✅ Done. The parity rule this phase enforces is defined in [ADR-021](../adr/ADR-021-shared-core-api-and-presentation-layers.md)'s Parity and Naming Rule.
