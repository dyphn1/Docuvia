# 6. Runtime View

## 6.1 Scenario: Git Repository Ingestion

A developer registers a Git repository and triggers ingestion from the kg-engine UI.

- **Implementation Route**: [`artifacts/api-server/src/routes/ingest.ts`](../../artifacts/api-server/src/routes/ingest.ts) (specifically `POST /projects/:id/ingest/git`)

```mermaid
sequenceDiagram
    actor User
    participant FE as kg-engine (React)
    participant API as api-server (Express)
    participant GIT as Git CLI
    participant DB as PostgreSQL

    User->>FE: Click "Ingest" on project page
    FE->>API: POST /projects/:id/ingest/git { mode: "incremental" }
    API->>DB: SELECT lastGitIngestedAt FROM projects WHERE id = :id
    API->>GIT: spawn("git" (streamed), ["log", "--after=<cursor>", "--format=..."])
    GIT-->>API: Raw commit list (stdout)
    API->>API: scoreCommit() (filter low-signal commits)
    API->>DB: INSERT INTO commits (hash, message, diff, authoredAt, projectId)
    API-->>FE: 200 { ingested: N, skipped: M, mode: "incremental" }
    FE-->>User: Show IngestResult toast
```

---

## 6.2 Scenario: Knowledge Generation Pipeline (Commit – L1/L2/L3)

The generate pipeline transforms raw commits into [structured knowledge graph nodes](adrs/ADR-005-knowledge-abstraction-strategy.md). It is protected by an atomic optimistic concurrency lock to prevent parallel execution conflicts.

- **Implementation Route**: [`artifacts/api-server/src/routes/generate.ts`](../../artifacts/api-server/src/routes/generate.ts) (specifically `POST /projects/:id/generate`)

```mermaid
sequenceDiagram
    actor User
    participant FE as kg-engine (React)
    participant API as api-server
    participant LLM as LLM API
    participant DB as PostgreSQL

    User->>FE: Click "Generate" on pipeline page
    FE->>API: POST /projects/:id/generate
    API->>DB: UPDATE projects SET status = 'indexing' WHERE id = :id AND status IN ('active', 'error') (Atomic Lock)
    API->>DB: SELECT * FROM commits WHERE processedAt IS NULL AND projectId = :id

    Note over API,LLM: Step 1 - L1 Tagging
    API->>LLM: Classify commit message for L1 tags
    LLM-->>API: ["Security", "Build System", ...]

    Note over API,LLM: Step 2 - L2 Extraction
    API->>LLM: Extract module/package from diff + path
    LLM-->>API: L2 node candidates (name, type, embedding request)
    API->>LLM: POST /v1/embeddings for each L2 node
    LLM-->>API: Embedding vectors

    Note over API,LLM: Step 3 - L3 Generation
    API->>DB: SELECT * FROM correction_examples WHERE projectId = :id (few-shot)
    API->>LLM: Generate decision record for each L2 node (with few-shot examples)
    LLM-->>API: L3 nodes (title, content, type)
    API->>LLM: POST /v1/embeddings for each L3 node
    LLM-->>API: Embedding vectors

    Note over API,DB: Step 4 - Cross-project & Noise Detection
    API->>DB: Cosine similarity check across other projects' L2 embeddings
    API->>DB: Detect near-duplicate L1 tags
    API->>DB: INSERT INTO review_tasks (anchor/merge/reject types)
    API->>DB: UPDATE commits SET processedAt = NOW()

    API-->>FE: 200 { l1Created: N, l2Created: M, l3Created: K, reviewTasksCreated: J }
    FE-->>User: Show pipeline result
```

---

## 6.3 Scenario: [Agentic RAG](adrs/ADR-007-agentic-rag-routing.md) Query (MCP)

An AI IDE sends a natural language query via MCP. The [intent router](adrs/ADR-007-agentic-rag-routing.md) classifies it and routes to the best retrieval strategy.

- **Implementation Route**: [`artifacts/api-server/src/routes/mcp.ts`](../../artifacts/api-server/src/routes/mcp.ts)
- **Orchestration Logic**: [`artifacts/api-server/src/lib/intent-router.ts`](../../artifacts/api-server/src/lib/intent-router.ts) (`routeQuery()`)

```mermaid
sequenceDiagram
    participant CLIENT as MCP Client (Cursor/Copilot)
    participant API as api-server
    participant LLM as LLM API
    participant DB as PostgreSQL

    CLIENT->>API: POST /mcp/query { query: "How does auth work?" }
    API->>LLM: Classify intent: vector | graph | direct | hybrid
    LLM-->>API: "vector"

    alt vector
        API->>LLM: POST /v1/embeddings { input: query }
        LLM-->>API: Query embedding vector
        API->>DB: Query L3 nodes & apply Temporal Decay
        DB-->>API: Top-K L3 nodes
    else graph
        API->>DB: Traverse node_links
        DB-->>API: Graph neighbourhood
    else direct
        API->>DB: Full-text search on l3_nodes.content
        DB-->>API: Direct match results
    else hybrid
        API->>API: Run vector and graph then merge and re-rank results
    end

    API-->>CLIENT: 200 { results: [...ranked nodes], strategy: "vector" }
```

---

## 6.4 Scenario: Review Task Resolution

A reviewer approves an AI-generated L3 decision, creating a [correction example](adrs/ADR-006-self-evolution-architecture.md) for future pipeline runs.

- **Implementation Route**: [`artifacts/api-server/src/routes/review_tasks.ts`](../../artifacts/api-server/src/routes/review_tasks.ts) (specifically `POST /review_tasks/:id/resolve`)

```mermaid
sequenceDiagram
    actor Reviewer
    participant FE as Review UI (kg-engine)
    participant API as api-server
    participant DB as PostgreSQL

    Reviewer->>FE: Open Review Queue
    FE->>API: GET /api/review-tasks?projectId=:id&status=pending
    API-->>FE: List of pending review_tasks

    Reviewer->>FE: Edit & Correct task, then Click "Approve"
    FE->>API: PATCH /api/review-tasks/:id { status: "approved", correctedValue: "..." }
    API->>DB: UPDATE review_tasks SET status = "approved"
    API->>DB: UPDATE l3_nodes SET content = correctedValue
    API->>DB: INSERT INTO correction_examples (originalContent, correctedContent, projectId)
    API-->>FE: 200 { id, status: "approved" }
    FE-->>Reviewer: Task removed from queue
```

---

## 6.5 Scenario: VS Code Knowledge Extraction

A developer triggers extraction from VS Code, which sends a task to the api-server's generate pipeline and stores the result in KnowledgeStore.

See [docs/design/vscode-client/command-palette/run-extraction.md](vscode-client/command-palette/run-extraction.md) for the detailed command flow.

- **VS Code Task Runner**: [`artifacts/vscode-client/src/task-runner.ts`](../../artifacts/vscode-client/src/task-runner.ts) (`runExtraction()`)
- **Implementation Route**: [`artifacts/api-server/src/routes/extensions_vscode.ts`](../../artifacts/api-server/src/routes/extensions_vscode.ts) (`POST /extensions/vscode/extract`)

```mermaid
sequenceDiagram
    actor Dev
    participant VSC as VS Code Extension
    participant KS as KnowledgeStore
    participant TR as TaskRunner
    participant API as api-server

    Dev->>VSC: Run Command: docuvia.runExtraction
    VSC->>TR: TaskRunner.runExtraction(workspaceUri)
    TR->>API: POST /extensions/vscode/extract { projectId, workspacePath }
    API->>API: Trigger generate pipeline (async)
    API-->>TR: 202 { taskId }
    TR->>TR: Poll GET /extensions/vscode/tasks/:taskId until complete
    TR->>KS: KnowledgeStore.updateFromResult(result)
    KS->>KS: Write to .docuvia/local.db
    KS-->>VSC: Emit onDidChange event
    VSC->>VSC: KnowledgeGraphTreeProvider.refresh()
    VSC-->>Dev: TreeView updated with new nodes
```

---

## 6.6 Scenario: GitHub PR Analysis

A developer opens a PR. Docuvia receives the webhook, looks up affected L2/L3 nodes, and comments on the PR with relevant knowledge graph context.

- **Implementation Route**: [`artifacts/api-server/src/routes/github_webhooks.ts`](../../artifacts/api-server/src/routes/github_webhooks.ts)
- **GitHub Client Wrapper**: [`artifacts/api-server/src/lib/github-client.ts`](../../artifacts/api-server/src/lib/github-client.ts)

```mermaid
sequenceDiagram
    participant GH as GitHub
    participant API as api-server
    participant LLM as LLM API
    participant DB as PostgreSQL

    GH->>API: POST /github/webhooks { event: "pull_request", action: "opened" }
    API->>API: Verify HMAC-SHA256 signature (GITHUB_WEBHOOK_SECRET)
    API->>API: github-client.fetchPrCommits(pr.number)
    API->>API: github-client.fetchPrDiff(pr.number)
    API->>DB: Lookup l2_nodes matching changed file paths
    API->>DB: SELECT l3_nodes WHERE l2NodeId IN (matched nodes)
    API->>LLM: Summarize relevant L3 decisions for PR context
    LLM-->>API: PR comment text
    API->>GH: github-client.postPrComment(pr.number, commentText)
    GH-->>API: 201 Created
    API->>DB: INSERT INTO pull_requests (prNumber, projectId, analysisResult)
```

---

## 6.7 Scenario: CLI Initialization & Deep Analysis

A developer initializes Docuvia in a new repository and runs a deep analysis.

- **Implementation Route**: [`artifacts/cli/src/commands/init.ts`](../../artifacts/cli/src/commands/init.ts) and [`artifacts/cli/src/commands/analyze.ts`](../../artifacts/cli/src/commands/analyze.ts)

```mermaid
sequenceDiagram
    actor Dev
    participant CLI as docuvia CLI
    participant GIT as Git (Blob Hash)
    participant AST as AST Worker Pool
    participant DB as SQLite Local DB

    Dev->>CLI: docuvia init
    CLI->>DB: Scaffold .docuvia/local.db schema
    CLI->>CLI: Write default docuvia.json configuration
    CLI-->>Dev: Initialized successfully

    Dev->>CLI: docuvia analyze --deep
    CLI->>GIT: Extract file contents via Git Blob Hashing
    CLI->>AST: Dispatch files to WASM AST Worker Pool
    AST->>AST: Parse AST & Resolve Cross-File Call Graph Target IDs
    AST-->>CLI: Parsed Nodes & Edges (Blast Radius)
    CLI->>DB: Transactional INSERT into l2_nodes and node_links
    CLI-->>Dev: Deep analysis complete
```

---

## 6.8 Scenario: AI Agent Collaboration Workflows

To explicitly address the "Cognitive Gap" and "Knowledge Deficit", Docuvia formalizes three distinct workflow models for AI Agent interaction. It achieves this by broadcasting a unified cognitive baseline across all major AI tools via the `docuvia init-agent` command.

### 6.8.1 Context-Aware Fast Path (Local)

Used when an AI Agent (e.g. Cursor, Claude Code, Copilot, Windsurf) is exploring the codebase. The `init-agent` command automatically provisions dynamic hooks (`.claude/hooks`, `.cursor/hooks`) and static rule files (`copilot-instructions.md`, `.windsurfrules`, etc.) to intercept the agent's actions.

```mermaid
sequenceDiagram
    participant Agent as AI Coding Agent
    participant Hook as Docuvia Agent Hook
    participant CLI as Docuvia Local CLI
    participant LocalDB as Local SQLite (HEAD Index)

    Agent->>Hook: Intends to Grep/Glob/Read codebase
    Hook->>CLI: Intercept with `docuvia query "<query>" --local --format=prompt`
    CLI->>LocalDB: AST Topology + File Path Match
    LocalDB-->>CLI: Return exact L2 Module & L3 Rules
    CLI-->>Hook: High-density XML-like context prompt
    Hook-->>Agent: Inject `<docuvia_context>` into tool output
    Note over Agent,LocalDB: Fast, offline, 0 LLM Tokens used, aligns Cognitive Baseline
```

### 6.8.2 Global Semantic Search (Server)

Used when an AI Agent asks a broad, exploratory question without a specific file context (e.g., "How do we handle CORS?").

```mermaid
sequenceDiagram
    participant Agent as AI Coding Agent
    participant VSC as Docuvia VS Code Ext
    participant API as API Server
    participant DB as PostgreSQL (pgvector)

    Agent->>VSC: Ask: "How is CORS handled?"
    VSC->>API: MCP Query Request
    API->>DB: Vector Similarity Search (pgvector)
    DB-->>API: Match across all L3 decisions
    API-->>Agent: Global architectural context
    Note over Agent,DB: Leverages Server for heavy lifting
```

### 6.8.3 Git-Isomorphic Knowledge Evolution

Used when a developer commits code, seamlessly updating the knowledge graph via Event Sourcing.

```mermaid
sequenceDiagram
    actor Dev
    participant Git as Local Git Repo
    participant Hook as Git Hook (post-commit)
    participant VSC as Local SQLite / Branch
    participant Server as Server (PostgreSQL)

    Dev->>Git: `git commit -m "fix CORS"`
    Git->>Hook: Trigger post-commit hook
    Hook->>VSC: Extract AST Delta
    VSC->>VSC: Append JSON Delta to `docuvia-knowledge`
    VSC->>VSC: Update Local SQLite (HEAD Index)
    Note over VSC, Server: Async Background Sync
    Server->>VSC: `git fetch docuvia-knowledge`
    Server->>Server: Project new events into PostgreSQL
```

---

## 6.9 Scenario: Hybrid Impact Analysis (AST + LSP Escalation)

When an AI Agent calls the `docuvia_impact` MCP tool, Docuvia uses a **Hybrid Approach** to provide fast and accurate analysis. It queries the fast `local.db` (SQLite) AST index first for O(1) lookups. If the confidence is low or deep verification (exact execution flows and taint analysis) is explicitly requested, it escalates to an on-demand background LSP client (`LspEnrichmentService`).

- **Query Routing**: [`artifacts/api-server/src/services/query-service.ts`](../../artifacts/api-server/src/services/query-service.ts) (`getImpact()` with `escalateToLsp` flag)
- **LSP Integration**: [`lib/core/src/services/lsp-enrichment-service.ts`](../../lib/core/src/services/lsp-enrichment-service.ts)

```mermaid
sequenceDiagram
    participant Agent as AI Agent (MCP Client)
    participant MCP as Docuvia MCP (docuvia_impact)
    participant AST as SQLite (local.db)
    participant LSP as LspEnrichmentService
    participant Server as Language Server / VS Code

    Agent->>MCP: Call docuvia_impact { target, escalate: true }
    MCP->>AST: Fast O(1) Lookup (AST References)
    AST-->>MCP: Surface-level dependents

    opt If escalate == true or low confidence
        MCP->>LSP: request exact execution flow / taint analysis
        LSP->>Server: textDocument/references (LSP)
        Server-->>LSP: Deep scope resolution & types
        LSP-->>MCP: Enriched exact impact paths
    end

    MCP->>MCP: Merge AST and LSP results
    MCP-->>Agent: Comprehensive Impact Analysis
```

---

## References

- [docs/design/vscode-client/command-palette/run-extraction.md](vscode-client/command-palette/run-extraction.md) – Full VS Code extraction flow
- [docs/design/vscode-client/chat-participant/slash-commands.md](vscode-client/chat-participant/slash-commands.md) – Chat participant command flows
- [08-crosscutting-concepts.md](08-crosscutting-concepts.md#81-domain-model) – Domain model for L1/L2/L3 entities

## Runtime Architecture Flow

```mermaid
flowchart TD
    subgraph Client Layer
        VSC[VS Code Extension\nLocal First / SQLite]
        Web[kg-engine\nReact + Vite Dashboard]
    end

    subgraph API Server Layer
        API[Express API Server\nNode.js 24]
        Router[Intent Router\nAgentic RAG]
        Parser[Document/Artifact Parsers]
    end

    subgraph Data & AI Layer
        DB[(PostgreSQL\nDrizzle ORM + pg_trgm)]
        LLM[OpenAI-Compatible\nAI Server]
        Git[(Git Orphan Branch\ndocuvia-knowledge)]
    end

    %% VS Code flows
    VSC <-->|REST / Sync| API
    VSC <-->|MCP Protocol| API

    %% Web UI flows
    Web <-->|REST / Orval Hooks| API

    %% API internal flows
    API --> Router
    API --> Parser
    Router <-->|SQL / Vector Search| DB
    Router <-->|Prompt Synthesis| LLM
    API <-->|Async Worker Sync| Git
```
