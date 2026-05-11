# Docuvia — Universal VCS Knowledge Graph Engine

> Transform years of version control history into a queryable, AI-powered knowledge base.

---

## Overview

Docuvia is a universal knowledge graph engine that extracts institutional knowledge from Git/SVN repositories, specification documents, and local files — then makes it queryable by AI agents via MCP.

Unlike tools that only analyze static source code, Docuvia mines **commit history, diffs, and build artifacts** alongside spec documents (PDF, Word, PPTX) to surface the *why* behind every decision — not just the *what*.

Designed for teams working with large, long-lived, or specialized codebases (such as BIOS/firmware, embedded systems, or proprietary frameworks) where critical knowledge is scattered across 18 years of commits and internal documentation.

---

## Key Features

### Knowledge Construction
- Extracts structured knowledge from Git/SVN commit history (message + diff)
- Ingests specification documents: PDF, Word, PPTX, Markdown
- Supports local files and folders as supplementary input sources
- Filters commits by convention rules to surface high-quality "solution" entries
- Three-tier knowledge hierarchy: **L1** (universal taxonomy) → **L2** (package/module/component) → **L3** (implementation rules, decisions, rationale)

### Knowledge Graph
- Global L1 tag pool shared across projects — new projects inherit and extend
- Cross-project dynamic linking and referencing (like Obsidian, but AI-assisted)
- Dual indexing: **vector search** for semantic queries, **graph traversal** for dependency and impact analysis
- AI-detected cross-project common nodes, human-confirmed

### Human-in-the-Loop
- AI generates, humans anchor and correct
- Iterative labeling workflow: AI proposes → human reviews → corrections feed back into next cycle
- Noise surfaces naturally via inconsistent repeated tagging, flagged for human review

### Agentic Query Layer
- All knowledge exposed as **MCP tools** for AI agents
- **Agentic RAG**: agent autonomously decides query strategy (vector vs. graph), depth, and whether to re-query
- Supports natural language queries: "What does this PCD do?", "What breaks if I replace this module?"

### Flexible LLM Support
- **Cloud providers**: OpenAI, Anthropic, Google, and others via API Key
- **Local inference**: Ollama (no API key required)
- Default model: **Gemma 3 12B** (balanced capability and weight for documentation tasks)
- Upgradeable per project: lightweight model for L1/L2 tagging, powerful model for L3 deep analysis

### Project Structure
- Each project has its own L1/L2/L3 knowledge space
- Remote repo URL as canonical identity — multiple local clones resolve to the same node
- Loose files and folders exist as independent entities, linked manually or by AI suggestion
- Projects can export, reference, and dynamically link to other projects

### Built-in AI Agent Toolkit
- Default skills, agents, and instruction sets included out of the box
- Default document templates for L1 taxonomy, L2 module docs, L3 decision records
- All defaults inheritable and overridable at the project level

---

## Supported Input Sources

| Source | Type | Notes |
|---|---|---|
| Git repository (remote) | Primary node | Local clones resolve to remote URL |
| SVN repository | Primary node | Commit + diff history extracted |
| Local folder | Supplementary | Independent entity, linkable |
| Local file | Supplementary | PDF, Word, PPTX, Markdown, TXT |
| Build artifacts | Supplementary | Map files, FV/FD layout, compile logs |

---

## Typical Use Cases

- **Firmware / BIOS teams**: Index EDK2 PCD definitions, module dependencies, and build-time-resolved structures that static analysis cannot capture
- **Long-lived codebases**: Recover institutional knowledge buried in 10–20 years of commit history
- **Spec-driven projects**: Link specification documents to the actual code changes they motivated
- **Onboarding**: New engineers query the knowledge base instead of reading thousands of commits
- **Impact analysis**: Before replacing a module, ask the agent what else will be affected

---

## Architecture Summary

```
Input Layer
├── Git / SVN Repos  (remote URL as canonical ID)
├── Local Files / Folders  (independent, linkable)
└── Build Artifacts  (post-compile knowledge)
        ↓
Knowledge Construction Layer
├── Commit Filter  (convention-based, ~60% signal rate)
├── L1 Tagger      (global pool, AI-assisted + human anchor)
├── L2 Extractor   (package / module / component)
└── L3 Generator   (diff + context → rules, rationale, decisions)
        ↓
Knowledge Graph
├── Vector Index   (semantic search)
└── Graph Index    (dependency / impact traversal)
        ↓
Query Layer
├── Agentic RAG    (self-correcting, intent-driven routing)
└── MCP Tools      (agent-callable endpoints)
```

---

## LLM Configuration

| Mode | Provider | Setup |
|---|---|---|
| Cloud | OpenAI / Anthropic / Google / others | Paste API Key in settings |
| Local | Ollama | Set Ollama endpoint URL |

Default model: `gemma3:12b` via Ollama
Recommended upgrade for deep analysis: any 70B+ cloud model

---

## Project vs. Tool Settings

| Setting | Scope | Overridable |
|---|---|---|
| Default skills & agents | Tool-wide | Yes, per project |
| Document templates | Tool-wide | Yes, per project |
| L1 global tag pool | Tool-wide | Extend per project |
| LLM provider & model | Tool-wide | Yes, per project |
| Cross-project links | Project | Manual or AI-suggested |

---

## Status

> Early architecture phase. Contributions and feedback welcome.
