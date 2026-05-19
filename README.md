# Docuvia

> Universal VCS Knowledge Graph Engine: Transform years of version control history into a queryable, AI-powered knowledge base.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

## Overview

Docuvia is a universal knowledge graph engine that extracts institutional knowledge from Git/SVN repositories, specification documents, and local files. Unlike tools that only analyze static source code, Docuvia mines commit history, diffs, and build artifacts alongside spec documents to surface the *why* behind every decision — not just the *what*. 

It is designed for teams working with large, long-lived, or specialized codebases (e.g., BIOS/firmware, embedded systems) where critical knowledge is scattered, allowing AI agents to query this knowledge via MCP.

---

## Typical Use Cases

- **Firmware / BIOS teams**: Index EDK2 PCD definitions, module dependencies, and build-time-resolved structures that static analysis cannot capture.
- **Long-lived codebases**: Recover institutional knowledge buried in 10–20 years of commit history.
- **Spec-driven projects**: Link specification documents to the actual code changes they motivated.
- **Onboarding**: New engineers query the knowledge base instead of reading thousands of commits.
- **Impact analysis**: Before replacing a module, ask the agent what else will be affected.

---

## Getting Started

### Prerequisites
- **Node.js**: Version 24+
- **pnpm**: Required (npm/yarn will be blocked by the preinstall script).
- **PostgreSQL**: Required for production and local environments.
- **AI API**: An OpenAI-compatible API endpoint and API Key.

### Installation / Deployment
Currently, Docuvia is run directly from the source repository.
```bash
# Clone the repository and install dependencies
pnpm install
```

### Initial Configuration
Set up the following required environment variables:
- `DATABASE_URL`: Connection string for PostgreSQL.
- `AI_INTEGRATIONS_OPENAI_BASE_URL`: Base URL for the OpenAI-compatible API.
- `AI_INTEGRATIONS_OPENAI_API_KEY`: API Key for the LLM endpoint.
- `PORT`: API server port (default 8080).

Start the system:
```bash
pnpm --filter @workspace/api-server run dev   # Starts API Server
pnpm --filter @workspace/kg-engine run dev    # Starts Frontend UI
```
The frontend defaults to `BASE_PATH=/` and `PORT=18774`.

---

## Core Workflow & Features

### 1. Ingestion
Connect Docuvia to your Git/SVN repository or upload specification documents (PDF, Word, PPTX, Markdown). Docuvia automatically filters out low-value commits to maintain a high signal-to-noise ratio.

### 2. Knowledge Construction (Human-in-the-Loop)
Trigger the AI analysis pipeline. The AI will extract structured knowledge across three tiers (L1, L2, L3). Use the **Review Queue** UI to anchor, correct, and approve the AI's proposed tags and decision records.

### 3. Querying & Agentic RAG
Once indexed, you can query the knowledge graph via the UI or connect your own AI agents via the built-in **MCP Endpoints**. The Agentic RAG system autonomously decides whether to use vector search (for semantic queries) or graph traversal (for dependency and impact analysis).

---

## Concepts & Glossary

*(Sourced from `docs/gitbook/04-core-concepts.md`)*

| Term | Definition |
|---|---|
| `L1 Pool` | Global tags acting as high-level categorizations across your organization. |
| `L2 Nodes` | Architectural components, packages, and modules specific to a project. |
| `L3 Nodes` | Micro-level design decisions, reasoning, and implementation details. |
| `Vector Index` | Used for semantic search when querying abstract concepts. |
| `Graph Index` | Used for dependency analysis, tracking relationships, and assessing impact. |
| `Agentic RAG` | The AI autonomously selects between vector, graph, direct, and hybrid routing. |
| `MCP` | Model Context Protocol — allows external AI agents to interact with Docuvia. |

---

## Security & Privacy

- **Data Locality**: The core engine and database run on your infrastructure. 
- **LLM Privacy**: Data is only sent to the LLM endpoint you configure in `AI_INTEGRATIONS_OPENAI_BASE_URL`. Ensure you use a provider with a zero-data-retention policy for enterprise data.
- **Credentials**: Database connection strings and API keys are managed via local environment variables.

---

## FAQ & Limitations

*(Sourced from `docs/gitbook/08-known-limitations.md` and `09-faq.md`)*

- **Q: The Dashboard displays "Dashboard data unavailable" and numbers are 0.**
  - **A:** Ensure that both the API Server and Database are running correctly. Check the API Server logs for connection errors.
- **Q: The Review Queue is empty after running Generate.**
  - **A:** The LLM might be returning unparseable JSON. Check the API logs for parse errors or LLM timeout exceptions.
- **Q: Cannot connect to local Ollama model.**
  - **A:** Native Ollama integration is not officially supported yet. You must use an OpenAI-compatible proxy (like LiteLLM) to route requests.

**Known Limitations:**
- **Multi-hop Impact Traversal**: Currently only one-hop traversal is supported.
- **Cross-project node_links**: Approved cross-project links do not automatically create relationship records in the DB yet.
- **Test Suite**: Currently limited to VS Code extensions tests.

---

## Support & Community

See the full [GitBook Documentation](docs/gitbook/) for Quick Start guides, API references, and architectural roadmaps.

---

## For Developers

Want to build Docuvia from source, contribute to the engine, or understand the codebase architecture? 
Please see the AI instructions and developer guide in [`AGENTS.md`](AGENTS.md).
