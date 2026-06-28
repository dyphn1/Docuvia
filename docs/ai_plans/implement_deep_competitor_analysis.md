# Implementation Plan: Deep Competitor Analysis & Status Breakdown

## Implementation Goals
1. Break down the current `docs/architecture/local-first-status.md` into six detailed, pillar-specific competitor analysis trackers in a new `docs/architecture/comparisons/` directory.
2. Provide a brutally strict comparison against industry leaders (GitNexus, Cursor, Sourcegraph Cody, Copilot Workspace) for each pillar, detailing advantages, deficits, fatal flaws, and immediate next steps.
3. Rewrite `docs/architecture/local-first-status.md` into a clean, top-level index that references the six new comparison trackers.

## Approach / Methodology
- **Separation of Concerns**: Isolate each architectural pillar into its own document to allow independent tracking, updates, and deep dives without cluttering the high-level architecture overview.
- **Brutal Honesty**: Ensure the competitor analysis doesn't sugarcoat Docuvia's current state. Identify concrete, actionable gaps where competitors currently outperform Docuvia.
- **Standardized Structure**: Use a uniform structure across all 6 comparison documents to ensure readability and maintainability.

## Detailed Implementation Steps
1. **Create Directory**: Ensure `docs/architecture/comparisons/` exists.
2. **Create Pillar 1 (AST & Semantic Graph)**: Create `01-ast-semantic-graph.md` comparing against GitNexus and Sourcegraph.
3. **Create Pillar 2 (Agentic RAG)**: Create `02-agentic-rag.md` comparing against Copilot Workspace.
4. **Create Pillar 3 (MCP AI Interfaces)**: Create `03-mcp-ai-interfaces.md` comparing against GitNexus.
5. **Create Pillar 4 (IDE & VS Code Client)**: Create `04-ide-vscode-client.md` comparing against Cursor.
6. **Create Pillar 5 (Data Pipeline & Sync)**: Create `05-data-pipeline-sync.md` comparing against Turborepo and GitNexus.
7. **Create Pillar 6 (CLI & Core API)**: Create `06-cli-core-api.md` comparing against GitNexus, Sourcegraph, Cursor, and Copilot Workspace.
8. **Rewrite Index**: Modify `docs/architecture/local-first-status.md` to act as a routing index for these six pillars, removing the duplicated detailed content.

## Implementation Details

### File Structures for the 6 Pillars
Each of the 6 files in `docs/architecture/comparisons/` should follow this template:
- `# [Pillar Name] Competitor Analysis`
- `## Current State` (Brief summary of Docuvia's current capability)
- `## Competitors` (Who we are comparing against)
- `## What Competitors Have That We Don't`
- `## What We Have That They Don't`
- `## Fatal Flaws`
- `## Immediate Next Steps`

### Brutal Critique Outlines

**1. `01-ast-semantic-graph.md` (vs GitNexus, Sourcegraph)**
- *What they have*: Real-time incremental tree-sitter updates without full rebuilds, deep cross-language call graph resolution, enterprise-scale indexing.
- *What we have*: Local-first SQLite schema tailored for multi-tier L1/L2/L3 abstraction tracking rather than just raw code symbols.
- *Fatal flaws*: Incomplete multi-language support, poor incremental parsing performance.
- *Next steps*: Adopt incremental AST diffing, finalize TypeScript symbol resolution.

**2. `02-agentic-rag.md` (vs Copilot Workspace)**
- *What they have*: Seamless integration of issue trackers, implicit contextual background extraction, deep multi-file planning UI.
- *What we have*: Structured L3 Decision Records anchored to commits, allowing deterministic retrieval of architectural intent.
- *Fatal flaws*: RAG retrieval often misses cross-module dependencies, lack of robust intent routing decay.
- *Next steps*: Implement robust hybrid search (vector + BM25) and intent routing temporal decay.

**3. `03-mcp-ai-interfaces.md` (vs GitNexus)**
- *What they have*: Extensive array of MCP tools for blast radius and impact analysis, deep CLI integrations.
- *What we have*: Direct API generation via OpenAPI spec, strongly typed Zod validators.
- *Fatal flaws*: Missing granular context-savings metadata in MCP responses, lack of comprehensive graph-querying MCP tools.
- *Next steps*: Build `get_impact_radius` and `semantic_search_nodes` MCP tools.

**4. `04-ide-vscode-client.md` (vs Cursor)**
- *What they have*: Native editor integration, shadow workspace for fast applies, zero-latency hover states.
- *What we have*: Extensible Webview architecture tied directly to the knowledge graph.
- *Fatal flaws*: High latency in agent responses, clunky Webview UX compared to native editor panels, no inline diff application.
- *Next steps*: Implement shadow workspace for fast diff applies, improve inline autocomplete latency.

**5. `05-data-pipeline-sync.md` (vs Turborepo, GitNexus)**
- *What they have*: Daemon-based file watching, near-instant cache invalidation, seamless remote sync.
- *What we have*: Git-isomorphic knowledge sync via the `docuvia-knowledge` orphan branch.
- *Fatal flaws*: Re-indexing large monorepos blocks the main thread, SQLite write-lock contention during heavy ingestion.
- *Next steps*: Move indexing to a background worker process, implement WAL mode properly for SQLite, optimize git diff parsing.

**6. `06-cli-core-api.md` (vs GitNexus, Sourcegraph, Cursor, Copilot Workspace)**
- *What they have*: Git-integrated dirty-tracking, fast LSP-based invalidation, profound execution flows.
- *What we have*: Unified local-first Core API, integrated L3 decision extraction.
- *Fatal flaws*: Fragile WASM loading strategies, high overhead in delta tracking.
- *Next steps*: Scale incremental sync, expand semantic graph, refine background L3 Extraction.

### Index Rewrite (`docs/architecture/local-first-status.md`)
- Keep a high-level summary of the Docuvia architecture status.
- Remove inline deep dives into specific pillars.
- Add a table of contents or distinct sections linking out to the 6 comparison trackers, summarizing the core challenge of each pillar in 1-2 sentences.

## Affected Workspace Packages
- `docs/` (sole target for file modifications)

## Architecture Diagrams
*Not applicable for this documentation task.*
