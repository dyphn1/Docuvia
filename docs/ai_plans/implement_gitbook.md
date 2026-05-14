# Implementation Plan: Docuvia GitBook Documentation

## Implementation Goals
- Create a structured GitBook documentation suite for the Docuvia project based on the provided Table of Contents.
- Ensure the content accurately reflects the current system capabilities as defined in the `README.md` and `AGENT.md`.
- Ensure all generated documentation content is in Traditional Chinese (as requested in the TOC).

## Approach / Methodology
1. Create a new `docs/gitbook/` directory to house all the GitBook markdown files.
2. Generate a `SUMMARY.md` file which serves as the navigation structure for GitBook.
3. Create individual markdown files for each main section of the TOC, detailing the system's capabilities, architecture, and configuration comprehensively based on existing project knowledge.
4. Translate technical system concepts (L1/L2/L3 nodes, Agentic RAG, MCP tools, Knowledge Generation Pipeline, Drizzle ORM schemas) into user-friendly explanations.

## Detailed Implementation Steps
1. **Initialize GitBook Directory**:
   - Create directory `docs/gitbook/`.
2. **Create `SUMMARY.md`**:
   - Map out the navigation tree linking to the individual chapter files.
3. **Draft Chapter 1: 快速開始 (Quick Start)**
   - Target file: `docs/gitbook/01-quick-start.md`
   - Content: System requirements (Node.js 24+, pnpm, PostgreSQL), Installation & Setup (`pnpm install`, env vars like `DATABASE_URL`, `AI_INTEGRATIONS_OPENAI_BASE_URL`), and First Execution (running API and frontend).
4. **Draft Chapter 2: 使用者指南 (User Guide)**
   - Target file: `docs/gitbook/02-user-guide.md`
   - Content: Connecting Git/SVN repos, triggering ingestion (manual via UI or auto via GitHub Webhooks), explanation of generated artifacts (L1 tags, L2 nodes, L3 decisions), querying the knowledge base (semantic search, MCP, dashboard).
5. **Draft Chapter 3: 模型設定 (Model Configuration)**
   - Target file: `docs/gitbook/03-model-configuration.md`
   - Content: Supported models (OpenAI-compatible endpoints, Anthropic, Gemini, Ollama via Replit), how to switch models per project via `llm_configs`, local model setup (Gemma 3 local via Ollama configuration), Cloud vs. Local recommendations.
6. **Draft Chapter 4: 核心概念 (Core Concepts)**
   - Target file: `docs/gitbook/04-core-concepts.md`
   - Content: How the system parses repositories (Git commits, diffs, L1/L2/L3 pipeline, document ingestion, build artifacts), structured knowledge graph explanation (Vector Index + Graph Index), AI-assisted human-in-the-loop workflow.
7. **Draft Chapter 5: 進階設定 (Advanced Configuration)**
   - Target file: `docs/gitbook/05-advanced-configuration.md`
   - Content: Customizing document templates (L1/L2/L3 prompts override per project), setting up cross-team subscriptions, webhook configurations (Slack/Teams).
8. **Draft Chapter 6: API / CLI 參考 (Reference)**
   - Target file: `docs/gitbook/06-reference.md`
   - Content: API routes summary (Express endpoints, MCP tools), CLI commands (`pnpm run build`, `typecheck`, `codegen`, `push`).
9. **Draft Chapter 7: 常見問題 (FAQ & Troubleshooting)**
   - Target file: `docs/gitbook/07-faq.md`
   - Content: Debugging database connections, handling LLM API errors, resolving pipeline noise.

## Implementation Details
- **Directory**: `docs/gitbook/`
- **Files**:
  - `docs/gitbook/SUMMARY.md`
  - `docs/gitbook/01-quick-start.md`
  - `docs/gitbook/02-user-guide.md`
  - `docs/gitbook/03-model-configuration.md`
  - `docs/gitbook/04-core-concepts.md`
  - `docs/gitbook/05-advanced-configuration.md`
  - `docs/gitbook/06-reference.md`
  - `docs/gitbook/07-faq.md`
- **Language**: Traditional Chinese (for the content of the documentation).

## Affected Workspaces
- N/A (Documentation only, under `docs/`)
