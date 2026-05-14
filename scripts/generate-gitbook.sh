#!/bin/bash

# 01-quick-start.md
cat << 'EOF' > docs/gitbook/01-quick-start.md
# Chapter 1: Quick Start

Welcome to Docuvia! This guide covers the basic setup required to run the Universal VCS Knowledge Graph Engine.

## 1.1 Prerequisites
- **Node.js**: Version 24+
- **pnpm**: Required (npm/yarn will be blocked by the preinstall script).
- **PostgreSQL**: Required for production environments.
- **Supported OS**: Windows, Linux, macOS.

## 1.2 Environment Variables
You must set up the following environment variables:
- `DATABASE_URL`: Connection string for PostgreSQL.
- `AI_INTEGRATIONS_OPENAI_BASE_URL`: Base URL for the OpenAI-compatible API.
- `AI_INTEGRATIONS_OPENAI_API_KEY`: API Key for the LLM endpoint.
- `PORT`: API server port (default 8080).

## 1.3 Installation and Startup
After cloning the repository, install dependencies using pnpm:
```bash
pnpm install
```

Start the API Server (port 8080):
```bash
pnpm --filter @workspace/api-server run dev
```

Start the Frontend application (port 18774):
```bash
pnpm --filter @workspace/kg-engine run dev
```
EOF

# 02-user-guide.md
cat << 'EOF' > docs/gitbook/02-user-guide.md
# Chapter 2: User Guide

This guide explains how to use the Docuvia user interface to manage projects, ingest code, review AI-generated knowledge nodes, and perform queries.

## 2.1 Creating Your First Project

![Project List View](./images/projects-list.png)

1. Navigate to the **Projects** page from the sidebar.
2. Click on **Add Project**.
3. Fill in the **Project Name** and the **Repository URL** (in GitHub URL format).
4. Note that the **Remote URL** acts as the canonical identity for the repository.

## 2.2 The Ingest & Generate Pipeline

![Pipeline View](./images/pipeline.png)

- **Ingest**: Extracts commits, diffs, and metadata from your Git or SVN repository.
- **Generate**: AI transforms the ingested data into structured L1, L2, and L3 knowledge nodes.
- **How to execute**: Go to the **Pipeline** page to monitor and trigger ingest/generate tasks.
- **Incremental vs. Full Update**: 
  - **Incremental** only processes new commits.
  - **Full** processes the entire repository history from scratch.

## 2.3 Viewing Knowledge Nodes

![L1 Tags View](./images/l1-tags.png)

Docuvia organizes knowledge across three layers:
- **L1 Tag Pool**: Global categorization tags used across all projects.
- **L2 Nodes**: Module, package, or component level concepts.
- **L3 Nodes**: Specific implementation rules, decision records, and technical reasoning.

## 2.4 Using the Review Queue

![Review Queue View](./images/review.png)

- AI-generated knowledge nodes are placed in the **Review Queue**.
- In the **Review** tab, inspect each proposed node.
- You can **Approve**, **Reject**, or **Defer**.
- Manual corrections act as a **Few-shot mechanism**, providing feedback to improve future AI generations.

## 2.5 Semantic Queries

![Query View](./images/query.png)

- Go to the **Query** page to ask natural language questions about your codebase.
- **Routing**: The system dynamically selects between Vector Search, Graph Traversal, or a Hybrid approach depending on your intent.
- **Examples**:
  - *"What is this PCD responsible for?"*
  - *"If I replace this module, what downstream components are affected?"*

## 2.6 Exporting the Knowledge Base
- **Supported Formats**: JSON and Markdown.
- Go to your Project settings to trigger an export for offline usage or backup.
EOF

# 03-model-configuration.md
cat << 'EOF' > docs/gitbook/03-model-configuration.md
# Chapter 3: Model Configuration

Learn how to configure different Large Language Models (LLMs) to power the knowledge extraction and querying processes.

## 3.1 Supported LLM Providers

| Type   | Provider | Requires API Key |
|--------|----------|------------------|
| Cloud  | OpenAI-compatible API | Yes |
| Cloud  | Anthropic | Yes (Replit environment only) |
| Cloud  | Google Gemini | Yes (Replit environment only) |
| Local  | Ollama | No |

## 3.2 Setting Up API Keys and Endpoints
Configure the base URL and API key for OpenAI-compatible endpoints using environment variables:
- `AI_INTEGRATIONS_OPENAI_BASE_URL`
- `AI_INTEGRATIONS_OPENAI_API_KEY`

## 3.3 Local Models: Ollama + Gemma 3 12B
> ⚠️ **Note**: Local Ollama inference is currently on the roadmap. The codebase only implements the OpenAI-compatible API client, and the Ollama adapter is not yet available.

Future updates will support setting `OLLAMA_HOST` to allow fully local AI processing without sending data to external APIs.

## 3.4 Task-based Model Strategy
- **L1/L2 Tagging**: Recommended to use lightweight, fast models to reduce costs.
- **L3 Deep Analysis**: Recommended to use 70B+ parameter models for high-quality technical reasoning extraction.
- **Per-project Settings**: You can override model settings per project in the `llm_configs` table.
EOF

# 04-core-concepts.md
cat << 'EOF' > docs/gitbook/04-core-concepts.md
# Chapter 4: Core Concepts

Understand the architectural concepts that power the Docuvia Knowledge Graph.

## 4.1 The Three-layer Knowledge Architecture
- **L1 Pool**: Global tags acting as high-level categorizations across your organization.
- **L2 Nodes**: Architectural components, packages, and modules.
- **L3 Nodes**: Micro-level design decisions, reasoning, and implementation details.

## 4.2 Commit Filter Mechanism
- The system automatically filters out low-value commits (e.g., `chore`, `merge`, `auto-generated`) to maintain a high signal-to-noise ratio.
- The target signal rate is ~60% of all repository commits.

## 4.3 Vector Index vs. Graph Index
- **Vector Index**: Used for semantic search when querying abstract concepts.
- **Graph Index**: Used for dependency analysis, tracking relationships, and assessing impact.
- **Complementary Roles**: The system uses both simultaneously to provide accurate context.

## 4.4 Agentic RAG Query Routing
- The AI autonomously selects between 4 routing strategies: `vector`, `graph`, `direct`, and `hybrid`.
- The `intent-router.ts` service classifies user questions to determine the optimal retrieval method.

## 4.5 MCP Endpoints
The Model Context Protocol (MCP) enables external AI clients to interact with Docuvia.

![MCP View](./images/mcp.png)

Provided tools include:
- `search_knowledge`
- `get_dependencies`
- `impact_analysis`
- `get_decision_record`
- `list_projects`
- `POST /mcp/query` (Agentic RAG)
EOF

# 05-advanced-features.md
cat << 'EOF' > docs/gitbook/05-advanced-features.md
# Chapter 5: Advanced Features

Explore the advanced configurations and mechanisms in Docuvia.

## 5.1 Human-in-the-Loop Review
The platform uses a continuous iteration loop: AI Generation → Human Review → Correction Feedback. This ensures your knowledge graph remains accurate and reflects domain-specific terminology.

## 5.2 Dynamic Cross-project Links
- The AI detects common nodes across different projects using cosine similarity (threshold ≥ 0.85).
> ⚠️ **Known Limitation**: While cross-links are detected and can be approved in the review queue, the system does not yet automatically generate the `node_links` records in the database.

## 5.3 Custom Prompt Templates
- You can edit L1/L2/L3 system prompts in the **/templates** page.
- Templates support per-project overrides or reverting to global defaults.

## 5.4 Incremental Updates
- The system uses `lastGitIngestedAt` or `lastSvnRevision` cursors.
- You can switch between Full and Incremental updates via the UI to save compute costs.

## 5.5 Cross-team Subscription
- Subscribe to knowledge updates from other projects.
- Notifications are triggered for events like `new_commit`, `new_l3_node`, and `cross_link_detected`.
EOF

# 06-integrations.md
cat << 'EOF' > docs/gitbook/06-integrations.md
# Chapter 6: Integrations

Connect Docuvia with your existing development workflows.

## 6.1 GitHub PR Integration
- Setup a Webhook pointing to your Docuvia instance.
- **PR Analysis Flow**: Automatically associates incoming code changes with existing L2/L3 impact nodes.
- View the analysis results on the **/pull-requests** page.

## 6.2 Slack / Teams Bot
- Configure Webhook URLs in the **/integrations** page.
- Supports alerts for knowledge base updates, review queue thresholds, and system errors.
- Use the UI to send a test payload.

## 6.3 VS Code Extension
> ⚠️ **Note**: The Server-side API for IDE integration is complete, but the actual VS Code extension (`.vsix`) has not been packaged and published yet.
EOF

# 07-reference.md
cat << 'EOF' > docs/gitbook/07-reference.md
# Chapter 7: API and MCP Reference

Technical specifications for APIs and protocol endpoints.

## 7.1 MCP Tool Endpoints
- **search_knowledge**: Accepts natural language string; returns relevant L2/L3 nodes.
- **get_dependencies**: Accepts a node ID; returns up/downstream nodes.
- **impact_analysis**: Accepts node IDs; returns potential breaking changes.
- **get_decision_record**: Retrieves historical architectural decisions.
- **list_projects**: Returns all tracked repositories.

## 7.2 REST API Overview
- `/projects`: CRUD operations for repositories.
- `/ingest` & `/generate`: Trigger pipeline jobs.
- `/review_tasks`: Manage the human-in-the-loop review queue.
- `/export`: Download JSON or Markdown knowledge bases.
EOF

# 08-known-limitations.md
cat << 'EOF' > docs/gitbook/08-known-limitations.md
# Chapter 8: Known Limitations

Please be aware of the following current limitations in the system.

| Feature | Severity | Description |
|---------|----------|-------------|
| Multi-hop Impact Traversal | 🟠 Medium | Currently only one-hop traversal is supported; multi-layer dependency analysis is not yet implemented. |
| Cross-project node_links | 🟠 Medium | Approved cross-project links do not automatically create relationship records in the DB. |
| Ollama / Local Inference | 🟡 Low | Only the OpenAI-compatible API is implemented; no dedicated Ollama adapter yet. |
| VS Code Extension | 🟡 Low | Server API exists, but the `.vsix` client package is missing. |
| Multi-Provider Adapters | 🟡 Low | Anthropic and Gemini adapters are strictly limited to the Replit platform environment. |
| Test Suite | 🟡 Low | Only `extensions_vscode.test.ts` exists; other endpoints lack automated tests. |
EOF

# 09-faq.md
cat << 'EOF' > docs/gitbook/09-faq.md
# Chapter 9: FAQ & Troubleshooting

Common issues and how to resolve them.

### The Dashboard displays "Dashboard data unavailable" and numbers are 0.
Ensure that both the API Server and Database are running correctly. Check the API Server logs for connection errors.

### Creating a Project returns HTTP 500 Internal Server Error.
Verify that the `DATABASE_URL` is set correctly and the database schema has been initialized via migrations.

### The Review Queue is empty after running Generate.
The LLM might be returning unparseable JSON. Check the API logs for `JSON.parse` errors or LLM timeout exceptions.

### The Query page returns no results.
Ensure that vector embeddings have been generated for your nodes. Verify your OpenAI integration is working and `AI_INTEGRATIONS_OPENAI_API_KEY` is valid.

### Cannot connect to local Ollama model.
As noted in the Known Limitations, Ollama is not officially supported yet. You must use an OpenAI-compatible proxy (like LiteLLM) to route requests to Ollama.
EOF

rm docs/gitbook/05-advanced-configuration.md
rm docs/gitbook/06-reference.md
rm docs/gitbook/07-faq.md
