# API Server: The 0-to-1 Handshake & Multi-tenant Synchronization

## Core Dilemma

How does the API Server discover a project for the first time without burning millions of tokens analyzing history blindly, and how does it handle team synchronization?

## The Discovery Handshake

```mermaid
sequenceDiagram
    participant Local as VS Code Client
    participant API as API Server (routes/projects.ts)
    participant Git as Orphan Branch (docuvia-knowledge)

    Local->>API: GET /api/projects/lookup?repo_url=...

    alt Project Exists
        API-->>Local: Returns Project Metadata
        Local->>Git: git fetch origin docuvia-knowledge
        Local-->>Local: Inherit Team Knowledge (0 Token, O(1))
    else New Project (0-to-1)
        API-->>Local: 404 Not Found
        Local->>Local: Trigger Local-First Onboarding
        Local->>API: POST Initial L1/L2 Drafts
        API->>API: Compare with Cross-Project Enterprise Memory
        API-->>Local: Return Bootstrap Blueprint
    end
```

### 1. Cross-Project Catalyst (The Bootstrap Blueprint)

When a new project is initialized, the Server LLM uses its global context across multiple tenants to suggest standard L1/L2 structures (e.g., standardizing `UI Components` for all React repos) before local extraction begins.

### 2. The Orphan Branch Protocol

- **Implementation**: `orphan-branch-writer.ts`.
- Massive knowledge indexes (L3 markdown files, semantic keys) are pushed to the `docuvia-knowledge` orphan branch.
- The API Server reads this branch to run asynchronous global clustering without polluting the main source code's commit history.

### 3. Conflict Resolution (The Orchestrator)

When Developers A and B push overlapping L2 definitions, the Server LLM performs a horizontal comparison and resolves the collision automatically, merging them into a unified L2 node during the background synchronization phase.
