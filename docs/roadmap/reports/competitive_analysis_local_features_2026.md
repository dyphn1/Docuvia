# Competitive Analysis: Local-First Features (2026)

Based on a cross-analysis with peer tools (`GitNexus`, `code-review-graph`, `graphify`, `headroom`), Docuvia currently lacks the following local-first, zero-server capabilities. These have been slated for Milestone 4 to achieve feature parity in local-first AI agent support.

### 1. Pure Local Lightweight Deep Traversal (Zero-Server Deep Traversal)
- **Competitors**: `GitNexus` (LadybugDB), `code-review-graph` (SQLite)
- **Missing in Docuvia**: Our VS Code Client supports only lightweight topology scanning and keyword retrieval. Deep graph traversal and Swarm Evolution currently require the API Server + PostgreSQL. We need a pure local graph querying mechanism via MCP/CLI without starting the API Server.

### 2. Local Context Compression & Proxy Layer (Token Reduction)
- **Competitors**: `headroom`
- **Missing in Docuvia**: No mechanism to compress AI agent context (AST, logs, RAG chunks, conversation history) locally before sending to the LLM. We need a local Proxy/Wrapper that provides reversible compression (e.g., CCR) to save token limits on the client side.

### 3. Static Local Visualizations & Offline Exports
- **Competitors**: `graphify`
- **Missing in Docuvia**: We have a heavy React UI (`kg-engine`). We lack a lightweight, portable static HTML export (e.g., `graph.html`) and offline architecture/call-flow mermaid exports that developers can generate and view in a browser locally.

### 4. Local Self-Learning & Failure Session Mining
- **Competitors**: `headroom` (via `headroom learn`)
- **Missing in Docuvia**: Swarm Intelligence currently relies on server-side asynchronous processing of overrides. We lack a local mechanism to mine failed AI sessions, extract root causes, and immediately update local `CLAUDE.md` / `AGENTS.md` rules.

### 5. Sub-second Local Incremental Watch Mode & Git Hooks
- **Competitors**: `code-review-graph`
- **Missing in Docuvia**: Syncing relies on the `docuvia-knowledge` temporal deltas. We lack a sub-second, hash-based incremental update mechanism integrated seamlessly with local Git pre-commit hooks and real-time watch mode.

### 6. Multi-Modal & Special Engineering File Parsing
- **Competitors**: `graphify`, `code-review-graph`
- **Missing in Docuvia**: While we support PDF, Word, and PPTX via `document-parser.ts`, we lack support for Data Science engineering files like Jupyter Notebooks (`.ipynb`) and multi-modal assets (images/video).

### 7. Cross-AI Agent Shared Local Memory
- **Competitors**: `headroom`
- **Missing in Docuvia**: Our local context is deeply coupled with VS Code Copilot Chat. We lack a universal, cross-agent local shared memory store that CLI agents (Claude Code, Codex, Gemini, Cursor) can jointly use and deduplicate.
