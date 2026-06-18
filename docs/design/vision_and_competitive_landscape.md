# Vision and Competitive Landscape

## The North Star
Docuvia aims to be a **Codebase Agentic OS** equipped with temporal memory and conceptual cognition. Rather than being just another tool that reads code, Docuvia empowers AI to understand:
- **Spatial (AST & Blast Radius)**: What is the exact call graph and structure of the code?
- **Temporal (History & Time)**: How did this code look in the past? What bugs were fixed, and what rules were learned from rebases?
- **Conceptual (Semantics & Docs)**: Which architectural document or PR discussion explains the rationale behind this module?

## Competitive Landscape Analysis

By comparing Docuvia with top-tier, highly mature open-source projects, we identify best-in-class architectural paradigms that shape our evolution:

### 1. Code Knowledge Graph (Spatial Accuracy)
- **`code-review-graph`**: Relies strictly on Tree-sitter (30+ languages) to generate an Abstract Syntax Tree (AST), storing exact call flows into an SQLite database without depending on raw text.
- **`graphify`**: Maps multi-modal inputs (PDFs, images, videos) into a knowledge graph alongside code and emphasizes seamless integration with AI development environments.
- **Docuvia**: Adopts the precision of AST via Tree-sitter while expanding nodes beyond pure code to include L1/L2 conceptual nodes derived from commit histories and architecture documents.

### 2. Token Efficiency Optimization
- **`code-review-graph`**: Utilizes a "Blast Radius" algorithm to isolate only the affected code fragments via local BFS graph traversal. This drastically reduces token consumption by avoiding full-repo contexts.
- **`headroom`**: Creates a proxy layer to implement Prefix Caching and Semantic Deduplication.
- **Docuvia**: Will implement local Blast Radius calculations (e.g., `/api/graph/impact`) and semantic deduplication in the Agentic RAG router (`intent-router.ts`) to intercept and compress queries before they reach expensive LLM endpoints.

### 3. Multi-Agent Collaboration
- **`GitNexus`**: Features a mature **PR Swarm Review** mechanism using 7 independent personas (risk, security, tests, etc.) that review code in parallel and synthesize a final output.
- **Docuvia**: Orchestrates specialized agents (Frontend, Backend, Schema Expert) via a state machine (`task-verifier.agent.md`) and will borrow parallel swarm review concepts to lighten the load on singular verifiers.

### 4. Frontend & Safety Guardrails
- **`tolaria`**: Utilizes a Tauri-based local-first desktop app and strictly enforces a CodeScene Ratchet Gate, blocking AI-generated code that degrades codebase health.
- **`graphify`**: Focuses on interactive visualizations (`graph.html` and Mermaid call-flows) to give human developers an immediate understanding of the graph.
- **Docuvia**: Enhances the Vite + React Dashboard (`kg-engine`) and VS Code Client to render interactive topology maps for implementation plans, ensuring Human-in-the-loop oversight and implementing rigorous health-check gates before committing AI suggestions.

## Strategic Implementation Priorities
To achieve this vision, we integrate these industry-leading strategies into a cohesive LNode Enhancement framework:
1. **AST Parser Phase**: Enforce strict extraction of code references (Tree-sitter) alongside semantic knowledge.
2. **Blast Radius Queries**: Handle dependency expansion strictly locally (via SQL BFS) to bypass massive LLM token overhead.
3. **Graphify-like Visualization**: Empower developers with visual implementation plans rendered in the frontend to validate AI decisions safely.
