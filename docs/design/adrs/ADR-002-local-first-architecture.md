# Local-First Architecture & Graceful Server Degradation

## Core Principle

Docuvia utilizes a **"Local-First, Server-Augmented"** architecture. It provides immediate, standalone value using only the VS Code Extension, seamlessly unlocking team-scale performance when connected to the API Server.

## Architecture Flow

```mermaid
flowchart TD
    Start[User Triggers Action / Search] --> Check{isServerConfigured?}
    Check -- Yes --> Server[API Server]
    Check -- No --> Local[Local Standalone Engine]

    subgraph Local Standalone Engine
        L1[Topology Scanning & Hotspots]
        L2[Keyword & Direct RAG]
        L3[Synchronous Evolution]
    end

    subgraph Central API Server
        S1[SQL Commit History Join]
        S2[4-Way Agentic RAG / PGVector]
        S3[Asynchronous Swarm Evolution]
    end

    Local --> Result[Return Context to Prompt]
    Server --> Result
```

## 1. Standalone Mode (Local-First Fallback)

- **Implementation**: Relies on [`CentralServerClient.isServerConfigured()`](file:///d:/GitHub/Docuvia/artifacts/vscode-client/src/CentralServerClient.ts#L36) returning false.
- **Architecture Recovery**: Falls back to Depth-2 topology scanning and `git log -n 100` (implemented in [`artifacts/vscode-client/src/KnowledgeStore.ts`](file:///d:/GitHub/Docuvia/artifacts/vscode-client/src/KnowledgeStore.ts)).
- **Agentic RAG**: Gracefully degrades to Keyword RAG and Direct Anchoring using `target_refs` (e.g. in [`artifacts/vscode-client/src/DocuviaCodeLensProvider.ts`](file:///d:/GitHub/Docuvia/artifacts/vscode-client/src/DocuviaCodeLensProvider.ts)).
- **Evolution**: Local garbage collection based on `last_verified_at` decay (Note: `last_verified_at` is currently not implemented).

## 2. Server-Augmented Mode (Team-Scale Ascension)

- **Heavy Computation Offloading**: API Server uses Drizzle [`commitsTable` in commits.ts](file:///d:/GitHub/Docuvia/lib/db/src/schema/commits.ts) to calculate true co-occurrence frequencies without local Git processing.
- **Full RAG**: Unlocks [`intent-router.ts`](file:///d:/GitHub/Docuvia/artifacts/api-server/src/lib/intent-router.ts) for Vector and Graph Traversal.
- **Asynchronous Evolution**: Background jobs process corrections to protect all team members.
