# Docuvia — Implementation Phases

> Universal VCS Knowledge Graph Engine  

---

## Phase 1 | Foundation

**Goal:** Establish the system skeleton and ensure a consistent base for all subsequent modules.

### 1.1 Project Structure
- Monorepo or modular directory layout
- CI/CD pipeline setup (GitHub Actions)
- Unified logging, error handling, and config management

### 1.2 Data Model Design
- Define core schemas: `Project`, `Commit`, `Document`, `KnowledgeNode`
- Select and initialize databases (suggested: SQLite / PostgreSQL for metadata + Qdrant / Chroma for vectors)

### 1.3 LLM Abstraction Layer
- Unified LLM interface across providers (OpenAI / Anthropic / Google / Ollama)
- Per-project model switching support
- Default: `gemma3:12b` via Ollama

---

## Phase 2 | Input Layer

**Goal:** Extract raw data from all supported sources and feed it into the knowledge construction pipeline.

### 2.1 Git Integration
- Fetch commit history via GitHub API or local `git log`
- Parse commit messages + diffs
- Remote URL as canonical project identity

### 2.2 SVN Integration
- Extract via `svn log` + `svn diff`
- Normalize to unified commit format

### 2.3 Document Parsers
- PDF (`pdfplumber` / `pypdf`)
- Word (`.docx` → structured text)
- PPTX (per-slide text + speaker notes)
- Markdown / TXT (direct parse)

### 2.4 Build Artifact Parsers
- Map files (symbol address → module mapping)
- FV/FD layout (firmware volume configuration)
- Compile logs (dependencies, warnings)

---

## Phase 3 | Knowledge Construction Layer

**Goal:** Transform raw data into structured three-tier knowledge nodes.

### 3.1 Commit Filter
- Convention-based rules to surface high-signal commits (target: ~60% signal rate)
- Filter out chore, merge, and auto-generated commits
- Configurable per-project rules

### 3.2 L1 Tagger — Universal Taxonomy
- AI generates candidate L1 tags into a global tag pool
- New projects inherit and extend the existing pool
- Human-anchored; inconsistent repeated tagging is flagged for review

### 3.3 L2 Extractor — Package / Module / Component
- Extract L2 nodes from commit paths and diff structure
- Map L2 nodes to their corresponding L1 tags

### 3.4 L3 Generator — Rules, Decisions & Rationale
- Input: diff + commit context + linked documents
- Output: implementation rules, technical decisions, change rationale
- Most LLM-intensive layer — recommended to use a stronger model (70B+)

---

## Phase 4 | Knowledge Graph

**Goal:** Build a dual-index structure that supports both semantic queries and dependency analysis.

### 4.1 Vector Index
- Embed L1/L2/L3 nodes and store in vector database
- Enables semantic search: *"What does this PCD do?"*

### 4.2 Graph Index
- Model inter-node dependencies (module A depends on module B)
- Enables impact analysis: *"What breaks if I replace this module?"*
- Powered by NetworkX or a lightweight graph DB (e.g., Kuzu)

### 4.3 Cross-Project Linking
- AI detects common nodes across projects
- Human-confirmed cross-project dynamic links
- Bidirectional linking (Obsidian-style, AI-assisted)

---

## Phase 5 | Query Layer & MCP Tools

**Goal:** Expose the knowledge base as agent-callable tool endpoints.

### 5.1 Agentic RAG
- Agent autonomously selects query strategy (vector vs. graph)
- Multi-turn querying with self-correction
- Intent-driven routing

### 5.2 MCP Tool Endpoints
- `search_knowledge(query, project?)` — semantic search
- `get_dependencies(module)` — dependency lookup
- `impact_analysis(module)` — impact traversal
- `get_decision_record(commit_hash)` — fetch L3 decision record
- `list_projects()` — list all project nodes

### 5.3 Natural Language Interface (Optional)
- Lightweight CLI or Web UI for non-agent users

---

## Phase 6 | Human-in-the-Loop

**Goal:** Establish an iterative AI-generates → human-reviews → corrections-feed-back cycle.

### 6.1 Review Interface
- Display AI-generated L1/L2/L3 candidate nodes
- Surface "high-confidence" vs. "needs review" items
- Support batch review workflows

### 6.2 Feedback Loop
- Human corrections written back to improve prompts or fine-tuning data
- Noise detection: inconsistent repeated tagging → auto-flagged for human review

### 6.3 Template Management
- Built-in templates: L1 taxonomy, L2 module docs, L3 decision records
- All templates inheritable and overridable at the project level

---

## Phase 7 | Enhancements & Ecosystem

**Goal:** Deepen capabilities and extend integrations once the core system is stable.

### 7.1 Incremental Updates
- Watch for new commits and trigger knowledge construction only on deltas
- Avoid full re-indexing on every update

### 7.2 Export & Sharing
- Export knowledge base as Markdown / JSON
- Cross-team knowledge node subscription mechanism

### 7.3 External Integrations
- IDE plugin (VS Code extension)
- Slack / Teams bot for knowledge queries
- GitHub PR review with automatic knowledge association

---

## Phase Overview

| Phase | Name | Core Deliverable | Order |
|-------|------|-----------------|-------|
| 1 | Foundation | Project skeleton, data models, LLM abstraction | ① |
| 2 | Input Layer | Git / SVN / document parsers | ② |
| 3 | Knowledge Construction | L1 / L2 / L3 generation pipeline | ③ |
| 4 | Knowledge Graph | Vector + graph dual index | ④ |
| 5 | Query Layer / MCP | Agent-callable tool endpoints | ⑤ |
| 6 | Human-in-the-Loop | Review UI + feedback loop | ⑥ |
| 7 | Enhancements | Incremental updates, external integrations | ⑦ |

---

*Document version: v0.1 — Early Architecture Phase*  
*Last updated: 2026-05-11*
