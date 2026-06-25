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

- **VS Code Task Runner**: [`artifacts/vscode-client/src/TaskRunner.ts`](../../artifacts/vscode-client/src/TaskRunner.ts) (`runExtraction()`)
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
    KS->>KS: Write l2_modules.yaml + l3_decisions/*.yaml to .docuvia/
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
